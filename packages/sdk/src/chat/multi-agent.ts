import { textOf, transformSessionEvent } from "../messages/merge.ts";
import type { ChatMessage } from "../messages/types.ts";
import {
	type EventsPage,
	eventDataOf,
	isTurnEndEvent,
	KitError,
	mergeEventSnapshots,
	type SessionEvent,
	type SessionThreadSummary,
	stableEventId,
	threadIdOf,
} from "../protocol/index.ts";
import type { ChatProvider } from "../providers/contract.ts";

export interface ChatAgentThread {
	id: string;
	name: string;
	/** 卡头任务摘要：主 Agent 派发给该线程的文本（thread_message_sent 等），无则缺省。 */
	task?: string;
	status: string | null;
	/** 卡头耗时用：created 取摘要或首个事件；ended 只在终态给状态事件时间，运行中缺省。 */
	createdAt?: string;
	endedAt?: string;
	messages: ChatMessage[];
	loading: boolean;
	error: string | null;
	nextPageToken: string | null;
	historyAvailable: boolean;
	loaded: boolean;
}
export interface ChatMultiAgent {
	selectedThreadId: string | null;
	threads: ChatAgentThread[];
	loading: boolean;
	error: string | null;
	selectThread(id: string | null): void;
	refreshThreads(): Promise<void>;
	loadThreadEvents(id: string, options?: { more?: boolean; retry?: boolean }): Promise<void>;
}

import { eventTime, mergeThreadHistory, type ThreadEventEntry as RecordEntry } from "./thread-history.ts";

interface ThreadState {
	id: string;
	ordinal: number;
	summary?: SessionThreadSummary;
	eventName?: string;
	eventStatus?: string;
	statusEvent?: SessionEvent;
	statusRevision: number;
	nameRevision: number;
	nameTime?: number;
	failedMore?: boolean;
	entries: RecordEntry[];
	loading: boolean;
	error: string | null;
	loaded: boolean;
	cursor: string | null;
	pages: Set<string>;
	request?: AbortController;
}
const failure = (error: unknown) => (error instanceof Error ? error.message : "子 Agent 查询失败");
const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
const child = (value: unknown) => (typeof value === "string" && value.startsWith("sthr_") ? value : undefined);

/** 卡头展示名：去掉云端的 Agents/ 前缀（如 Agents/template_xxx），coordinator 是主 Agent 角色名。 */
const displayName = (raw: string) => (raw.trim() === "coordinator" ? "主 Agent" : raw.trim().replace(/^Agents\//, ""));

/** 卡头任务摘要：主 Agent 派发文本取 thread_message_sent，回退 to/from coordinator 的协作消息。 */
const taskTextOf = (entries: RecordEntry[]): string | undefined => {
	for (const { event } of entries) {
		if (event.type !== "thread_message_sent" && event.type !== "thread_message_received") continue;
		if (event.type === "thread_message_received" && text(event.metadata?.from_agent_name) !== "coordinator") continue;
		const body = textOf(event)?.trim();
		if (body) return body;
	}
	return undefined;
};

/** 子线程查询是独立的展示资料源，不写主会话 ledger、审批、phase 或续传 cursor。 */
export function createMultiAgentRuntime(provider: ChatProvider, sessionId: string, changed: () => void) {
	const threads = new Map<string, ThreadState>();
	const ordinals = new Map<string, number>();
	const transform = provider.transformMessage?.bind(provider) ?? transformSessionEvent;
	let selectedThreadId: string | null = null;
	let loading = false;
	let error: string | null = null;
	let listRequest: AbortController | undefined;
	let revision = 0;
	let disposed = false;
	let replaying = false;
	let replayGeneration = 0;
	let snapshot: ChatMultiAgent;
	const ensure = (id: string) => {
		let thread = threads.get(id);
		if (!thread) {
			if (!ordinals.has(id)) ordinals.set(id, ordinals.size + 1);
			thread = {
				ordinal: ordinals.get(id)!,
				id,
				entries: [],
				loading: false,
				error: null,
				loaded: false,
				cursor: null,
				pages: new Set(),
				statusRevision: 0,
				nameRevision: 0,
			};
			threads.set(id, thread);
		}
		return thread;
	};
	const completeTerminal = (messages: ChatMessage[], status: string | null): ChatMessage[] => {
		if (status !== "idle" && status !== "terminated") return messages;
		for (const message of messages) if (message.status === "streaming") message.status = "done";
		return messages;
	};
	function project(thread: ThreadState): ChatMessage[] {
		let messages: ChatMessage[] = [];
		for (const { event } of thread.entries) {
			// thread_created 在主线程渲染成卡；子线程自身的投影不重复消费它。
			if (event.type === "thread_created") continue;
			messages = transform({ messages, event: structuredClone(event), identity: stableEventId(event) }).messages;
		}
		return completeTerminal(messages, thread.eventStatus ?? thread.summary?.status ?? null);
	}
	const isoTime = (time?: number) => (time === undefined ? undefined : new Date(time).toISOString());
	const threadView = (thread: ThreadState): ChatAgentThread => {
		const status = thread.eventStatus ?? thread.summary?.status ?? null;
		return {
			id: thread.id,
			name:
				displayName(thread.eventName ?? thread.summary?.agent_name ?? thread.summary?.agent.name ?? "") ||
				`子 Agent ${thread.ordinal}`,
			task: taskTextOf(thread.entries),
			status,
			createdAt:
				thread.summary?.created_at ?? isoTime(thread.entries[0] ? eventTime(thread.entries[0].event) : undefined),
			endedAt:
				status === "idle" || status === "terminated"
					? (isoTime(thread.statusEvent ? eventTime(thread.statusEvent) : undefined) ?? thread.summary?.updated_at)
					: undefined,
			messages: project(thread),
			loading: thread.loading,
			error: thread.error,
			nextPageToken: thread.cursor,
			historyAvailable: !!provider.listThreadEvents,
			loaded: thread.loaded,
		};
	};
	function publish() {
		snapshot = {
			selectedThreadId,
			loading,
			error,
			threads: [...threads.values()].map(threadView),
			selectThread,
			refreshThreads,
			loadThreadEvents,
		};
		if (!replaying && !disposed) changed();
	}
	function selectThread(id: string | null) {
		if (disposed || (id !== null && !threads.has(id))) return;
		selectedThreadId = id;
		publish();
		if (id) void loadThreadEvents(id);
	}
	const active = (request: AbortController) => !disposed && !request.signal.aborted;
	function acceptSummaries(summaries: SessionThreadSummary[], started: number) {
		for (const summary of summaries) {
			if (summary.session_id !== sessionId || !child(summary.id))
				throw new KitError("provider_error", "子 Agent 列表与会话不匹配");
			const thread = ensure(summary.id);
			thread.summary = summary;
			if (thread.statusRevision <= started) {
				thread.eventStatus = undefined;
				thread.statusEvent = undefined;
				thread.statusRevision = ++revision;
			}
			if (summaryReplacesName(thread, summary, started)) {
				thread.eventName = undefined;
				thread.nameRevision = ++revision;
			}
		}
	}
	async function readThreads(request: AbortController, started: number) {
		const seen = new Set<string>();
		let pageToken: string | undefined;
		do {
			const page = await provider.listThreads!(sessionId, { limit: 100, pageToken, signal: request.signal });
			if (!active(request)) return;
			acceptSummaries(page.data, started);
			pageToken = page.next_page_token ?? undefined;
			if (pageToken && seen.has(pageToken)) throw new KitError("provider_error", "子 Agent 列表分页游标重复");
			if (pageToken) seen.add(pageToken);
		} while (pageToken);
	}
	async function refreshThreads() {
		if (disposed || !provider.listThreads || listRequest || replaying) return;
		const request = new AbortController();
		listRequest = request;
		loading = true;
		error = null;
		publish();
		try {
			await readThreads(request, revision);
		} catch (cause) {
			if (active(request)) error = failure(cause);
		} finally {
			if (listRequest === request) {
				listRequest = undefined;
				loading = false;
				publish();
			}
		}
	}
	function finishRequest(thread: ThreadState, request: AbortController) {
		if (thread.request !== request) return;
		thread.request = undefined;
		thread.loading = false;
		publish();
	}
	const canLoad = (thread: ThreadState | undefined, more: boolean): thread is ThreadState =>
		!!thread && !disposed && !replaying && !!provider.listThreadEvents && !thread.loading && (!more || !!thread.cursor);
	async function loadThreadEvents(id: string, options: { more?: boolean; retry?: boolean } = {}) {
		const thread = threads.get(id);
		const more = !!(options.retry ? thread?.failedMore : options.more);
		if (!canLoad(thread, more)) return;
		const request = new AbortController();
		const started = revision;
		const cursor = more ? (thread.cursor ?? undefined) : undefined;
		thread.request = request;
		thread.loading = true;
		thread.error = null;
		publish();
		try {
			const page = await provider.listThreadEvents!(sessionId, id, {
				limit: 50,
				pageToken: cursor,
				signal: request.signal,
			});
			if (active(request)) {
				acceptHistory(thread, page, started, more);
			}
		} catch (cause) {
			if (active(request)) {
				thread.error = failure(cause);
				thread.failedMore = more;
			}
		} finally {
			finishRequest(thread, request);
		}
	}
	function acceptHistory(thread: ThreadState, page: EventsPage, started: number, more: boolean) {
		mergeThreadPage(thread, page, started, more);
		if (!more) observeHistoryMetadata(thread, page.data, started);
	}
	function observeReference(ref: unknown, name: unknown, time: number | undefined): boolean {
		const id = child(ref);
		if (!id) return false;
		const fresh = !threads.has(id);
		const thread = ensure(id);
		const nextName = text(name) ?? thread.eventName;
		const changed = fresh || thread.eventName !== nextName;
		thread.eventName = nextName;
		if (changed) {
			thread.nameRevision = ++revision;
			thread.nameTime = time;
		}
		return changed;
	}
	function observeReferences(event: SessionEvent): boolean {
		const meta = event.metadata ?? {};
		const sent = observeReference(meta.to_session_thread_id, meta.to_agent_name, eventTime(event));
		const received = observeReference(meta.from_session_thread_id, meta.from_agent_name, eventTime(event));
		return sent || received;
	}
	function observeOwned(thread: ThreadState, event: SessionEvent) {
		const data = eventDataOf(event) ?? {},
			meta = event.metadata ?? {};
		const name = text(meta.agent_name) ?? text(data.agent_name);
		if (name) {
			thread.eventName = name;
			thread.nameTime = eventTime(event);
			thread.nameRevision = ++revision;
		}
		const status = threadStatus(event);
		if (status) {
			thread.eventStatus = status;
			thread.statusEvent = event;
			thread.statusRevision = ++revision;
		}
		const key = stableEventId(event);
		const known = thread.entries.find((entry) => stableEventId(entry.event) === key);
		const next = { event: mergeEventSnapshots(known?.event, structuredClone(event)), revision: ++revision };
		if (known) Object.assign(known, next);
		else thread.entries.push(next);
	}
	function observeHistoryMetadata(thread: ThreadState, events: SessionEvent[], started: number) {
		const latest = events.findLast((event) => !!threadStatus(event));
		if (latest && canApplyHistoryStatus(thread, latest, started)) {
			thread.eventStatus = threadStatus(latest);
			thread.statusEvent = latest;
			thread.statusRevision = ++revision;
		}
		if (thread.nameRevision > started) return;
		const named = events.findLast((event) => text(event.metadata?.agent_name) || text(eventDataOf(event)?.agent_name));
		if (named) {
			thread.eventName = text(named.metadata?.agent_name) ?? text(eventDataOf(named)?.agent_name);
			thread.nameRevision = ++revision;
		}
	}
	function observe(event: SessionEvent) {
		if (disposed) return;
		const id = threadIdOf(event);
		let discovered = observeReferences(event);
		if (id) {
			discovered ||= !threads.has(id);
			observeOwned(ensure(id), event);
		}
		if (id || discovered) publish();
		// 回合收尾补拉一次列表摘要：子线程可能从未发 thread_status，完成态与耗时只能从摘要兜底。
		if (threads.size > 0 && !replaying && isTurnEndEvent(event)) void refreshThreads();
		if (discovered && !replaying) void refreshThreads();
	}
	function reset() {
		replayGeneration++;
		replaying = true;
		listRequest?.abort();
		listRequest = undefined;
		loading = false;
		error = null;
		for (const thread of threads.values()) thread.request?.abort();
		threads.clear();
		revision++;
	}
	function ready() {
		const generation = replayGeneration;
		replaying = false;
		publish();
		void refreshThreads().then(() => {
			if (disposed || replaying || generation !== replayGeneration) return;
			if (selectedThreadId && !threads.has(selectedThreadId)) {
				selectedThreadId = null;
				publish();
			}
			if (selectedThreadId) void loadThreadEvents(selectedThreadId);
		});
	}
	function dispose() {
		replayGeneration++;
		disposed = true;
		listRequest?.abort();
		for (const thread of threads.values()) thread.request?.abort();
	}
	publish();
	return { getSnapshot: () => snapshot, observe, reset, ready, dispose };
}

function threadStatus(event: SessionEvent): string | undefined {
	if (event.type !== "thread_created" && event.type !== "thread_status") return;
	const data = eventDataOf(event) ?? {};
	return text(data.status) ?? text(data.thread_status) ?? text(event.metadata?.status);
}
function canApplyHistoryStatus(thread: ThreadState, event: SessionEvent, started: number): boolean {
	if (thread.statusRevision > started) return false;
	if (thread.statusEvent?.event_id === event.event_id && event.event_id) return true;
	const current = thread.statusEvent ? eventTime(thread.statusEvent) : Date.parse(thread.summary?.updated_at ?? "");
	const incoming = eventTime(event);
	return !Number.isFinite(current) || (incoming !== undefined && incoming > current!);
}
function mergeThreadPage(thread: ThreadState, page: EventsPage, started: number, more: boolean) {
	const next = page.next_page_token;
	if (more && next && (next === thread.cursor || thread.pages.has(next)))
		throw new KitError("provider_error", "子 Agent 事件分页游标重复");
	if (page.data.some((event) => threadIdOf(event) !== thread.id))
		throw new KitError("provider_error", "事件不属于所选子 Agent");
	thread.entries = mergeThreadHistory(thread.entries, page.data, started, more);
	if (more && thread.cursor) thread.pages.add(thread.cursor);
	if (!thread.loaded || more) thread.cursor = next;
	thread.loaded = true;
}

function summaryReplacesName(thread: ThreadState, summary: SessionThreadSummary, started: number): boolean {
	if (thread.nameRevision > started || !(summary.agent_name || summary.agent.name)) return false;
	if (!thread.eventName) return true;
	return thread.nameTime !== undefined && Date.parse(summary.updated_at) > thread.nameTime;
}
