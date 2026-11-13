import {
	type AttachmentRef,
	type CatalogMemoryStore,
	composeSkillDirective,
	deriveApprovalState,
	KitError,
	type SessionSummary,
	type SseFrame,
	stableEventId,
	type ToolApprovalDecision,
} from "@openagentpack/kit-sdk/protocol";
import type { GatewaySendInput, GatewaySessionInfo, ProviderGateway } from "../gateway/types.ts";
import type { SessionDeletionStore } from "../store/session-deletions.ts";
import type { SessionDirectoryQuery } from "../store/session-directory.ts";
import type { DebugSessionTarget, SessionIndex } from "../store/sessions.ts";
import { DEFAULT_MOUNT_PREFIX, resolveMounts } from "./attachments.ts";
import type { EventBufferRegistry } from "./event-buffer.ts";
import { createEventBufferRegistry } from "./event-buffer.ts";
import type { MemberUsageService } from "./member-usage.ts";
import type { Metrics } from "./metrics.ts";
import { createSessionDeletion } from "./session-deletion.ts";
import { createSessionMutations } from "./session-mutations.ts";
import { projectSessionRuntime } from "./session-runtime.ts";
import { createSessionStreams, readSessionHistory } from "./session-streams.ts";
import { createToolApprovals } from "./tool-approvals.ts";
import { statusMarker } from "./usage-limit-completion.ts";
import type { UsageLimitService } from "./usage-limits.ts";

export interface SessionServiceDeps {
	gateway: ProviderGateway;
	buffers: EventBufferRegistry;
	sessionIndex: SessionIndex;
	pingIntervalMs?: number;
	/** 建会话时等待附件扫描可用的上限；超时返回可重试的 409（默认 20s）。 */
	fileScanTimeoutMs?: number;
	metrics?: Metrics;
	memberUsage?: MemberUsageService;
	usageLimits?: UsageLimitService;
	deletionStore?: SessionDeletionStore;
	deletionTimeoutMs?: number;
	deletionPollMs?: number;
}

function sessionResources(memoryStores: CatalogMemoryStore[] = [], vaultIds: string[] = [], environmentId?: string) {
	return {
		...(environmentId ? { environmentId } : {}),
		...(memoryStores.length ? { memoryStores } : {}),
		...(vaultIds.length ? { vaultIds } : {}),
	};
}

function debugRuntime(target: DebugSessionTarget) {
	if (target.source !== "template") return { remoteAgentId: target.remote_agent_id };
	return {
		remoteAgentId: target.remote_agent_id,
		remoteAgentVersion: target.agent_version,
		remoteEnvironmentId: target.remote_environment_id,
		memoryStores: target.memory_stores,
		vaultIds: target.vault_ids,
	};
}

/**
 * 会话服务：建会话、发消息、历史分页、SSE 帧流、artifact 下载代理。
 * SSE 语义见 docs/protocol.md：ready → 回放 → 实时 → done；ping 保活；
 * 静默断流由客户端 ping 超时判定，服务端不发假 done。
 */
export function createSessionService(deps: SessionServiceDeps) {
	const { gateway, buffers, sessionIndex, metrics } = deps;
	const pingIntervalMs = deps.pingIntervalMs ?? 15_000;
	const fileScanTimeoutMs = deps.fileScanTimeoutMs ?? 20_000;
	let activeStreams = 0;
	const streams = createSessionStreams(gateway, buffers, pingIntervalMs, {
		// 状态回落（含订阅水合的历史终态）只同步 status：last_event_at 是侧栏「最近」排序依据，
		// 点开回看不得推进它；归档是显式操作，事件回放/水合也不得把已归档行改回 idle。
		onStatus: (sessionId, status) => {
			if (sessionIndex.get(sessionId)?.summary.status !== "archived") sessionIndex.setStatus(sessionId, status);
		},
	});
	const approvals = createToolApprovals(gateway, buffers, deps.usageLimits?.runApproval);
	const mutations = createSessionMutations((id) => !!deps.deletionStore?.get(id));
	const deleteSession =
		deps.memberUsage && deps.deletionStore
			? createSessionDeletion({
					...deps,
					memberUsage: deps.memberUsage,
					deletionStore: deps.deletionStore,
					timeoutMs: deps.deletionTimeoutMs,
					pollMs: deps.deletionPollMs,
				})
			: undefined;

	/**
	 * 附件必须先过 provider 扫描才能绑定会话：未就绪就建会话会被 provider 拒（错误还很难懂）。
	 * 有界等待 → 超时抛 409 `conflict`（retryable），由客户端按 `retryable` 重试，而不是把
	 * provider 的原始报错甩给用户。实测扫描 15~20s（docs/research/bailian-session-file-mount.md）。
	 */
	async function waitForFilesReady(files: AttachmentRef[]): Promise<void> {
		const deadline = Date.now() + fileScanTimeoutMs;
		const pending = new Map(files.map((f) => [f.file_id, "checking"]));
		while (pending.size > 0) {
			for (const fileId of [...pending.keys()]) {
				const info = await gateway.fileStatus(fileId);
				if (info.available) pending.delete(fileId);
				else pending.set(fileId, info.status ?? "checking");
			}
			if (pending.size === 0) return;
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				const detail = [...pending.entries()].map(([id, status]) => `${id}(${status})`).join(", ");
				throw new KitError("conflict", `附件仍在处理中，请稍后重试：${detail}`, { retryable: true });
			}
			await new Promise((resolve) => setTimeout(resolve, Math.min(500, remaining)));
		}
	}

	/**
	 * running 回合即使订阅者离开也由共享泵继续跟踪到终态并回写索引；这里只对没有上游泵的
	 * 存量 running 行按 Provider 详情兜底对账（如服务重启前的遗留值）。映射规则与事件侧
	 * indexStatusOf 一致；详情不可查询/状态未知/超时静默保留原值，同一会话 60 秒内不重复探测，
	 * Provider 仍为 running 时不写。
	 */
	const STALE_RUNNING_MS = 2 * 60_000;
	const RECONCILE_RECHECK_MS = 60_000;
	const RECONCILE_TIMEOUT_MS = 3_000;
	const reconcileCheckedAt = new Map<string, number>();
	const reconcileInflight = new Map<string, Promise<boolean>>();

	function detailStatusOf(info: GatewaySessionInfo): string | null {
		if (info.status === "running" || info.status === "rescheduling") return "running";
		if (info.status === "idle") return info.stop_reason?.type === "requires_action" ? "requires_action" : "idle";
		return info.status === "failed" ? "failed" : null;
	}

	async function reconcileOne(sessionId: string): Promise<boolean> {
		const inflight = reconcileInflight.get(sessionId);
		if (inflight) return inflight;
		const run = (async () => {
			reconcileCheckedAt.set(sessionId, Date.now());
			try {
				const timeout = new Promise<null>((resolve) => {
					const timer = setTimeout(() => resolve(null), RECONCILE_TIMEOUT_MS);
					timer.unref();
				});
				const info = await Promise.race([gateway.getSession(sessionId), timeout]);
				if (!info) return false;
				const next = detailStatusOf(info);
				if (!next || next === "running") return false;
				const history = createEventBufferRegistry();
				history.seed(sessionId, await readSessionHistory(gateway, sessionId));
				if (projectSessionRuntime(history.ensure(sessionId), undefined).status === "running") return false;
				return sessionIndex.setStatusIfRunning(sessionId, next);
			} catch {
				return false;
			} finally {
				reconcileInflight.delete(sessionId);
			}
		})();
		reconcileInflight.set(sessionId, run);
		return run;
	}

	async function reconcileStaleRunning(sessions: SessionSummary[]): Promise<boolean> {
		const now = Date.now();
		const stale = sessions.filter(
			(s) =>
				s.status === "running" &&
				!streams.isTracking(s.session_id) &&
				s.last_event_at !== undefined &&
				now - Date.parse(s.last_event_at) >= STALE_RUNNING_MS &&
				now - (reconcileCheckedAt.get(s.session_id) ?? 0) >= RECONCILE_RECHECK_MS,
		);
		if (!stale.length) return false;
		const results = await Promise.all(stale.map((s) => reconcileOne(s.session_id)));
		return results.some(Boolean);
	}

	/**
	 * 运行时挂载的路径解析：与创建时挂载共用 `/mnt/session/uploads` 前缀，并把会话已有
	 * 挂载路径并入去重集合，避免同名覆盖（重名自动 `-2`）。解析后等待扫描就绪。
	 */
	async function prepareMounts(sessionId: string, attachments: AttachmentRef[]): Promise<AttachmentRef[]> {
		const existing = new Set(sessionIndex.get(sessionId)?.files.flatMap((f) => (f.mount_path ? [f.mount_path] : [])));
		const mounts = resolveMounts(attachments, DEFAULT_MOUNT_PREFIX, existing);
		if (mounts.length) await waitForFilesReady(mounts);
		return mounts;
	}

	/**
	 * 挂载跟随消息发送（实测 2026-11-02，docs/research/bailian-session-file-mount.md）：
	 * 先把附件逐个挂进运行中 sandbox，再执行发送；成功后并入本地索引（provider 不回显
	 * 运行时挂载，`GET /sessions/:id` 无 resource 记录），**发送失败自动卸载回滚**，
	 * 避免留下无消息对应的孤儿挂载。`bound` 是已随建会话挂载的附件：不重复挂载、失败
	 * 不回滚（绑定制早于本条消息），但同样随消息落关联——新建会话首条消息的附件卡靠它。
	 */
	async function sendWithMounts(
		sessionId: string,
		mounts: AttachmentRef[],
		run: () => Promise<{ event_ids: string[] }>,
		bound: AttachmentRef[] = [],
	): Promise<{ event_ids: string[] }> {
		if (!mounts.length && !bound.length) return run();
		const mounted: { resourceId: string; file: AttachmentRef }[] = [];
		try {
			for (const file of mounts) {
				const result = await gateway.mountSessionResource(sessionId, {
					fileId: file.file_id,
					mountPath: file.mount_path as string,
				});
				mounted.push({ resourceId: result.resourceId, file: { ...file, mount_path: result.mountPath } });
			}
			const result = await run();
			sessionIndex.appendFiles(
				sessionId,
				mounted.map((m) => m.file),
			);
			// 附件↔消息按发送响应 event_ids 落关联：provider 不回显运行时挂载，刷新后
			// 历史气泡的附件展示只能靠这条本地索引（event_ids 与乐观气泡 ack 匹配同一来源）。
			if (result.event_ids.length)
				sessionIndex.appendMessageFiles(sessionId, {
					event_ids: result.event_ids,
					files: [...bound, ...mounted.map((m) => m.file)],
				});
			return result;
		} catch (error) {
			await Promise.allSettled(mounted.map((m) => gateway.unmountSessionResource(sessionId, m.resourceId)));
			throw error;
		}
	}

	/**
	 * 建会话后逐个运行时挂载（创建载荷不带文件，实测创建时 file_resource 不物化）。
	 * 挂载失败视为建会话失败：回滚已挂载资源、删除刚建的 provider 会话，避免留下无附件会话。
	 */
	async function mountAfterCreate(sessionId: string, mounts: AttachmentRef[]): Promise<AttachmentRef[]> {
		const mounted: { resourceId: string; file: AttachmentRef }[] = [];
		try {
			for (const file of mounts) {
				const result = await gateway.mountSessionResource(sessionId, {
					fileId: file.file_id,
					mountPath: file.mount_path as string,
				});
				mounted.push({ resourceId: result.resourceId, file: { ...file, mount_path: result.mountPath } });
			}
		} catch (error) {
			await Promise.allSettled(mounted.map((m) => gateway.unmountSessionResource(sessionId, m.resourceId)));
			await gateway.deleteSession(sessionId).catch(() => undefined);
			throw error;
		}
		return mounted.map((m) => m.file);
	}

	return {
		async create(
			input: {
				subjectId: string;
				title?: string;
				files?: AttachmentRef[];
			} & (
				| {
						purpose?: "experience";
						agentSlug: string;
						remoteAgentId: string;
						remoteAgentVersion?: number;
						remoteEnvironmentId?: string;
						memoryStores?: CatalogMemoryStore[];
						vaultIds?: string[];
				  }
				| { purpose: "admin_debug"; debug: DebugSessionTarget }
			),
		) {
			// 挂载路径在此解析并落库：provider 事后查不到绑定关系，本地索引是唯一可回显的来源
			const mounts = input.files?.length ? resolveMounts(input.files) : [];
			if (mounts.length) await waitForFilesReady(mounts);
			const target = input.purpose === "admin_debug" ? debugRuntime(input.debug) : input;
			const info = await gateway.createSession({
				agentId: target.remoteAgentId,
				...(target.remoteAgentVersion !== undefined ? { agentVersion: target.remoteAgentVersion } : {}),
				...(input.title ? { title: input.title } : {}),
				...sessionResources(target.memoryStores, target.vaultIds, target.remoteEnvironmentId),
			});
			// 文件不进创建载荷（实测 2026-11-03：创建时 file_resource 回显成功但沙箱不物化），
			// 改在建会话后走运行时挂载（实测可见），失败即建会话失败。
			const files = await mountAfterCreate(info.session_id, mounts);
			sessionIndex.create({
				...input,
				sessionId: info.session_id,
				...(files.length ? { files } : {}),
			});
			metrics?.count("kit_sessions_created_total", { gateway: gateway.mode });
			return { ...info, ...(files.length ? { files } : {}) };
		},
		/** 准入在订阅就绪与审批校验之后等待完成，发送前不得放过异步用量检查。 */
		async send(
			sessionId: string,
			input: GatewaySendInput & { attachments?: AttachmentRef[]; skills?: string[] },
			beforeSend?: () => void | Promise<void>,
		) {
			return mutations.run(sessionId, () =>
				streams.use(sessionId, async () => {
					if (
						deriveApprovalState(buffers.get(sessionId)?.events ?? [], buffers.get(sessionId)?.latestStatus)
							.requires_action
					)
						throw new KitError("conflict", "请先处理工具审批");
					const { attachments, skills, ...rest } = input;
					const buffer = buffers.ensure(sessionId);
					const previousStatus = statusMarker(buffer.latestStatus, buffer);
					const knownUserIds = new Set(
						buffer.events
							.filter((event) => event.role === "user")
							.map((event) => event.event_id || stableEventId(event)),
					);
					const after = buffer.events.length;
					const sequence = buffer.sequence + 1;
					// 技能指令头在 mock/live 共用的发送路径合成（ADR-0016）：只转换 skills 授权名单内的标记。
					const sendInput = skills?.length ? { ...rest, text: composeSkillDirective(rest.text, skills) } : rest;
					// 客户端对首条消息会同时传建会话 files 与消息 attachments：已绑定的只落关联，不重复挂载。
					const requested = attachments ?? [];
					const stored = sessionIndex.get(sessionId)?.files ?? [];
					const bound = stored.filter((f) => requested.some((r) => r.file_id === f.file_id));
					const boundIds = new Set(bound.map((f) => f.file_id));
					const mounts = await prepareMounts(
						sessionId,
						requested.filter((f) => !boundIds.has(f.file_id)),
					);
					const send = () => gateway.sendMessage(sessionId, sendInput);
					const sendWithoutLimits = async () => {
						await beforeSend?.();
						return send();
					};
					const result = await sendWithMounts(
						sessionId,
						mounts,
						() =>
							deps.usageLimits ? deps.usageLimits.runSend(sessionId, sendInput, beforeSend, send) : sendWithoutLimits(),
						bound,
					);
					streams.acceptTurn(sessionId, {
						eventIds: result.event_ids,
						previousStatus,
						knownUserIds,
						after,
						sequence,
						...(rest.clientMessageId ? { clientMessageId: rest.clientMessageId } : {}),
					});
					sessionIndex.touch(sessionId);
					return result;
				}),
			);
		},
		async interrupt(sessionId: string) {
			await mutations.run(sessionId, () => gateway.interrupt(sessionId));
		},
		async delete(sessionId: string) {
			return mutations.exclusive(sessionId, async (drain) => {
				if (deleteSession) return deleteSession(sessionId, drain);
				await drain;
				await gateway.deleteSession(sessionId);
				sessionIndex.remove(sessionId);
			});
		},
		async archive(sessionId: string) {
			return mutations.run(sessionId, async () => {
				await gateway.archiveSession(sessionId);
				sessionIndex.setStatus(sessionId, "archived");
			});
		},
		/** 读取当前身份的会话索引；先对过期 running 行做 Provider 对账，保证侧栏兜底状态可信。 */
		listAgents(subjectId: string) {
			return sessionIndex.listAgentsForSubject(subjectId);
		},
		async listPage(subjectId: string, query: SessionDirectoryQuery = {}) {
			const page = sessionIndex.pageForSubject(subjectId, query);
			if (await reconcileStaleRunning(page.data)) return sessionIndex.pageForSubject(subjectId, query);
			return page;
		},
		async list(subjectId: string, options: { agentSlug?: string; limit?: number } = {}) {
			const sessions = sessionIndex.listForSubject(subjectId, options);
			if (await reconcileStaleRunning(sessions)) return sessionIndex.listForSubject(subjectId, options);
			return sessions;
		},
		events(sessionId: string, options: { afterId?: string; pageToken?: string; limit?: number } = {}) {
			return gateway.listEvents(sessionId, options);
		},
		threads(sessionId: string, options: { pageToken?: string; limit?: number; signal?: AbortSignal } = {}) {
			return gateway.listThreads(sessionId, options);
		},
		threadEvents(
			sessionId: string,
			threadId: string,
			options: { pageToken?: string; limit?: number; signal?: AbortSignal } = {},
		) {
			return gateway.listThreadEvents(sessionId, threadId, options);
		},
		toolApprovals(sessionId: string) {
			return streams.use(sessionId, () => approvals.list(sessionId));
		},
		respondToolApproval(sessionId: string, decision: ToolApprovalDecision) {
			return mutations.run(sessionId, () => streams.use(sessionId, () => approvals.respond(sessionId, decision)));
		},
		download(fileId: string) {
			return gateway.downloadFile(fileId);
		},
		async upload(input: { filename: string; bytes: Uint8Array; mimeType?: string }) {
			const info = await gateway.uploadFile(input);
			metrics?.count("kit_uploads_total", { gateway: gateway.mode });
			return info;
		},

		async *openStream(
			sessionId: string,
			options: { after?: string; signal?: AbortSignal } = {},
		): AsyncGenerator<SseFrame> {
			activeStreams += 1;
			metrics?.gauge("kit_sse_streams_active", activeStreams);
			try {
				yield* streams.frames(sessionId, options);
			} finally {
				activeStreams -= 1;
				metrics?.gauge("kit_sse_streams_active", activeStreams);
			}
		},
	};
}
export type SessionService = ReturnType<typeof createSessionService>;
