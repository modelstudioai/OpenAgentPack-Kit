import {
	type AttachmentRef,
	composeSkillDirective,
	KitError,
	type ToolApprovalDecision,
	ToolApprovalDecisionSchema,
} from "../protocol/index.ts";
import type { ChatProvider } from "../providers/contract.ts";
import { type ChatMultiAgent, createMultiAgentRuntime } from "./multi-agent.ts";
import { type BackoffOptions, createBackoff, sleep } from "./reconnect.ts";
import { createSessionStore, type SessionSnapshot, type SessionStore } from "./session-store.ts";

export interface ChatSnapshot extends SessionSnapshot {
	multiAgent: ChatMultiAgent;
}

export interface ChatSendOptions {
	clientMessageId?: string;
	attachments?: AttachmentRef[];
	skills?: string[];
}

/** 乐观气泡与服务端发送层共用同一 compose（ADR-0016）：气泡投影按协议 token 显示，回显前后视觉一致。 */
function optimisticSkillText(text: string, options: ChatSendOptions): string {
	return options.skills?.length ? composeSkillDirective(text, options.skills) : text;
}

/** 正文保持输入原文（含 /name 标记），skills 授权名单并列上送，服务端负责 token 转换。 */
function sendRequestBody(text: string, clientMessageId: string, options: ChatSendOptions) {
	return {
		text,
		client_message_id: clientMessageId,
		...(options.skills?.length ? { skills: options.skills } : {}),
		...(options.attachments?.length ? { attachments: options.attachments } : {}),
	};
}

export interface ChatController {
	store: SessionStore;
	getSnapshot(): ChatSnapshot;
	subscribe(listener: () => void): () => void;
	/** 返回回放结束的 ready；订阅持续到 dispose 或不可恢复错误。 */
	connect(): Promise<void>;
	send(text: string, options?: ChatSendOptions): Promise<void>;
	stop(): Promise<void>;
	refreshApprovals(): Promise<void>;
	submitApproval(decision: ToolApprovalDecision): Promise<void>;
	dispose(): void;
	readonly connected: boolean;
}

/** 无 React 的连接与请求编排；网络结果不明的写操作绝不自动重发。 */
export function createChatController(
	client: ChatProvider,
	sessionId: string,
	options: { backoff?: BackoffOptions } = {},
): ChatController {
	const store = createSessionStore(sessionId, { transformMessage: client.transformMessage?.bind(client) });
	const listeners = new Set<() => void>();
	let snapshot: ChatSnapshot;
	let publishThreads: () => void = () => undefined;
	const multiAgent = createMultiAgentRuntime(client, sessionId, () => publishThreads());
	function publish() {
		const agentView = multiAgent.getSnapshot();
		snapshot = {
			...store.getSnapshot(),
			multiAgent: agentView,
			threads: Object.fromEntries(agentView.threads.map((thread) => [thread.id, thread.messages])),
		};
		for (const listener of listeners) listener();
	}
	publishThreads = publish;
	const unsubscribeStore = store.subscribe(publish);
	publish();
	const abort = new AbortController();
	let disposed = false;
	let loop: Promise<void> | null = null;
	let connected = false;
	// 原始 SSE 适配器可能没有传输 cursor，使用本地修订号识别查询期间的事件变化。
	let streamRevision = 0;
	const waiters = new Set<{ resolve: () => void; reject: (reason: unknown) => void }>();
	const submissions = new Set<string>();
	const cancelled = () => new KitError("conflict", "会话连接已关闭");
	const assertCurrent = () => {
		if (disposed) throw cancelled();
	};
	function settle(error?: unknown) {
		for (const waiter of waiters) error ? waiter.reject(error) : waiter.resolve();
		waiters.clear();
	}

	function streamOptions(backoff: ReturnType<typeof createBackoff>) {
		return {
			after: store.getSnapshot().lastCursor,
			signal: abort.signal,
			onReset: () => {
				if (disposed) return;
				streamRevision++;
				multiAgent.reset();
				store.beginReplay();
			},
			onEvent: (event: Parameters<SessionStore["applyEvent"]>[0], cursor?: string) => {
				if (disposed) return;
				multiAgent.observe(event);
				if (store.applyEvent(event, cursor) === "applied") streamRevision++;
			},
			onReady: (info: { cursor?: string | null }) => {
				if (disposed) return;
				streamRevision++;
				store.finishReplay(info.cursor);
				multiAgent.ready();
				store.clearStreamError();
				store.setConnection("connected");
				connected = true;
				backoff.reset();
				settle();
			},
			onDone: () => {
				if (!disposed) store.onStreamDone();
			},
		};
	}
	async function recover(error: unknown, backoff: ReturnType<typeof createBackoff>): Promise<boolean> {
		connected = false;
		if (disposed) return false;
		const failure =
			error instanceof KitError
				? error
				: new KitError("provider_error", error instanceof Error ? error.message : "事件连接失败", { retryable: true });
		store.onStreamError({ code: failure.code, message: failure.message });
		store.setConnection("reconnecting");
		const delay = failure.retryable ? backoff.next() : null;
		if (delay === null) {
			store.setConnection("disconnected");
			settle(failure);
			return false;
		}
		await sleep(delay, abort.signal).catch(() => undefined);
		return !disposed;
	}
	async function runLoop() {
		const backoff = createBackoff(options.backoff);
		let attempt = 0;
		while (!disposed) {
			store.setConnection(attempt++ ? "reconnecting" : "connecting");
			try {
				await client.stream(sessionId, streamOptions(backoff));
				connected = false;
				store.setConnection("disconnected");
				settle(new KitError("conflict", "会话订阅已经结束"));
				return;
			} catch (error) {
				if (!(await recover(error, backoff))) return;
			}
		}
	}

	function connect(): Promise<void> {
		if (disposed) return Promise.reject(cancelled());
		if (connected) return Promise.resolve();
		const ready = new Promise<void>((resolve, reject) => waiters.add({ resolve, reject }));
		if (!loop)
			loop = runLoop().finally(() => {
				loop = null;
				connected = false;
			});
		return ready;
	}
	async function refreshApprovalsChecked(): Promise<boolean> {
		assertCurrent();
		const revision = streamRevision;
		const response = await client.toolApprovals(sessionId);
		assertCurrent();
		if (revision !== streamRevision) return false;
		for (const approval of response.requests)
			store.setApprovalStatus(approval.batch_id, approval.call_id, approval.status ?? "pending");
		store.setApprovals(response);
		return true;
	}
	async function refreshApprovals(): Promise<void> {
		await refreshApprovalsChecked();
	}
	function approvalFor(decision: ToolApprovalDecision) {
		return store
			.getSnapshot()
			.approvals.find((item) => item.batch_id === decision.batch_id && item.call_id === decision.call_id);
	}
	function approvalFingerprint(approval: ReturnType<typeof approvalFor>): string | undefined {
		if (!approval) return;
		return JSON.stringify([
			approval.request_event_id,
			approval.name,
			approval.tool_type,
			approval.server_label,
			approval.session_thread_id,
			approval.arguments,
		]);
	}
	function validateDecision(decision: ToolApprovalDecision, reviewed: string | undefined) {
		const approval = approvalFor(decision);
		if (!approval?.actionable || approval.status !== "pending") throw new KitError("conflict", "审批已过期或已经处理");
		if (reviewed !== undefined && approvalFingerprint(approval) !== reviewed)
			throw new KitError("conflict", "工具参数已经变化，请重新查看并确认");
	}
	async function reconcileDecision(decision: ToolApprovalDecision, error: unknown) {
		if (disposed) return;
		store.setApprovalStatus(
			decision.batch_id,
			decision.call_id,
			error instanceof KitError && error.status === 409 ? "stale" : "uncertain",
		);
		await refreshApprovals().catch(() => undefined);
	}

	return {
		store,
		getSnapshot: () => snapshot,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		connect,
		get connected() {
			return connected;
		},
		async send(text, sendOptions = {}) {
			await connect();
			assertCurrent();
			if (!store.getSnapshot().canSend) throw new KitError("conflict", "当前会话尚未就绪或正在等待工具审批");
			const clientMessageId = sendOptions.clientMessageId ?? `cm_${Math.random().toString(36).slice(2)}`;
			const pending = store.beginTurn({
				text: optimisticSkillText(text, sendOptions),
				clientMessageId,
				...(sendOptions.attachments?.length ? { attachments: sendOptions.attachments } : {}),
			});
			try {
				const result = await client.sendMessage(sessionId, sendRequestBody(text, clientMessageId, sendOptions));
				assertCurrent();
				store.acknowledgePending(pending.messageId, result.event_ids, pending.generation);
			} catch (error) {
				if (!disposed) store.setPendingStatus(pending.messageId, "failed", pending.generation);
				throw error;
			}
		},
		async stop() {
			assertCurrent();
			store.markStopping();
			try {
				await client.interrupt(sessionId);
				assertCurrent();
			} catch (error) {
				if (!disposed) store.clearStopping();
				throw error;
			}
		},
		refreshApprovals,
		async submitApproval(input) {
			const decision = ToolApprovalDecisionSchema.parse(input);
			const key = JSON.stringify([decision.batch_id, decision.call_id]);
			if (submissions.has(key)) throw new KitError("conflict", "该审批正在提交");
			submissions.add(key);
			let posted = false;
			const reviewed = approvalFingerprint(approvalFor(decision));
			try {
				await connect();
				const revision = streamRevision;
				const refreshed = await refreshApprovalsChecked();
				assertCurrent();
				if (!refreshed || revision !== streamRevision)
					throw new KitError("conflict", "审批状态已经变化，请刷新后重新查看并确认");
				validateDecision(decision, reviewed);
				store.setApprovalStatus(decision.batch_id, decision.call_id, "submitting");
				posted = true;
				await client.submitToolApproval(sessionId, decision);
				assertCurrent();
				store.setApprovalStatus(decision.batch_id, decision.call_id, "submitted");
			} catch (error) {
				if (posted) await reconcileDecision(decision, error);
				throw error;
			} finally {
				submissions.delete(key);
			}
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			connected = false;
			abort.abort();
			multiAgent.dispose();
			unsubscribeStore();
			settle(cancelled());
			store.setConnection("disconnected");
		},
	};
}
