import {
	deriveApprovalState,
	KitError,
	mergeEventSnapshots,
	type SessionEvent,
	threadIdOf,
} from "@openagentpack/kit-sdk/protocol";
import type { ProviderGateway } from "../gateway/types.ts";
import type { EventBufferRegistry } from "./event-buffer.ts";
import { readSessionHistory } from "./session-streams.ts";
import { reconcileUnorderedSnapshot, sameSnapshot, snapshotConflict } from "./snapshot-reconciliation.ts";

const isMainStatus = (event: SessionEvent) => event.type === "session_status" && !threadIdOf(event);
const isApprovalEvent = (event: SessionEvent) =>
	isMainStatus(event) || event.type === "tool_approval_request" || event.type === "tool_approval_response";

function latestApprovalStatus(
	history: SessionEvent[],
	before: SessionEvent[],
	live: SessionEvent[],
	latestBefore?: SessionEvent,
) {
	const beforeIds = new Set(before.map((event) => event.event_id));
	const statuses = history.filter(isMainStatus);
	const newStatuses = statuses.filter((event) => !beforeIds.has(event.event_id));
	const latestLive = live.findLast(isMainStatus);
	if (!newStatuses.length) return latestLive ?? latestBefore ?? statuses.at(-1);
	// 新历史状态须在所有已知状态之后，不能将漏回放的旧身份提升为当前状态。
	const firstNew = statuses.findIndex((event) => !beforeIds.has(event.event_id));
	if (statuses.slice(firstNew).some((event) => beforeIds.has(event.event_id))) throw snapshotConflict();
	const newest = newStatuses.at(-1)!;
	if (latestLive && latestLive.event_id !== newest.event_id) throw snapshotConflict();
	return newest;
}

function reconcileApprovalHistory(
	history: SessionEvent[],
	before: SessionEvent[],
	live: SessionEvent[],
	latestBefore?: SessionEvent,
) {
	const historicalIds = new Set(history.map((event) => event.event_id));
	if (before.some((event) => !event.event_id || !historicalIds.has(event.event_id))) throw snapshotConflict();
	const versions = new Map<string, SessionEvent[]>();
	const events = new Map<string, SessionEvent>();
	for (const event of [...before, ...live]) {
		if (!event.event_id) throw snapshotConflict();
		const known = versions.get(event.event_id) ?? [];
		known.push(event);
		versions.set(event.event_id, known);
		events.set(event.event_id, mergeEventSnapshots(events.get(event.event_id), event));
	}
	for (const event of history) {
		if (!event.event_id) throw snapshotConflict();
		const known = events.get(event.event_id);
		// 历史重现已观察过的快照时，保留同一 SSE 连接上可证实的后续更新。
		if (known && versions.get(event.event_id)?.some((version) => sameSnapshot(version, event))) continue;
		events.set(event.event_id, known ? reconcileUnorderedSnapshot(known, event) : event);
	}

	const latest = latestApprovalStatus(history, before, live, latestBefore);
	const latestStatus = latest?.event_id ? events.get(latest.event_id) : latest;
	return { approvals: deriveApprovalState([...events.values()], latestStatus), latestStatus };
}

/** 查询不修改共享缓存；保留查询前已知的更新次序，并协调查询期间的实时变化。 */
export async function readSessionApprovalSnapshot(
	gateway: ProviderGateway,
	buffers: EventBufferRegistry,
	sessionId: string,
	signal?: AbortSignal,
) {
	if (signal?.aborted) throw new DOMException("已取消", "AbortError");
	const buffer = buffers.get(sessionId);
	const before = buffer?.events.filter(isApprovalEvent) ?? [];
	const latestBefore = buffer?.latestStatus;
	const live: SessionEvent[] = [];
	let bytes = 0;
	let overflow = false;
	const unsubscribe = buffers.subscribe(sessionId, (change) => {
		if (signal?.aborted || !change || overflow || !isApprovalEvent(change.event)) return;
		bytes += new TextEncoder().encode(JSON.stringify(change.event)).byteLength;
		if (live.length >= 1024 || bytes > 8 * 1024 * 1024) {
			overflow = true;
			return;
		}
		live.push(change.event);
	});
	let rejectAbort: ((reason: unknown) => void) | undefined;
	const aborted = signal
		? new Promise<never>((_, reject) => {
				rejectAbort = reject;
			})
		: undefined;
	const onAbort = () => {
		// 即使 Provider 忽略 signal，也立即释放共享缓存监听及本地等待。
		unsubscribe();
		rejectAbort?.(new DOMException("已取消", "AbortError"));
	};
	signal?.addEventListener("abort", onAbort, { once: true });
	if (signal?.aborted) onAbort();
	try {
		const pending = readSessionHistory(gateway, sessionId, signal);
		const history = await (aborted ? Promise.race([pending, aborted]) : pending);
		if (signal?.aborted) throw new DOMException("已取消", "AbortError");
		if (overflow) throw new KitError("provider_error", "审批刷新期间事件过多，请重新查询", { retryable: true });
		return {
			...reconcileApprovalHistory(history.filter(isApprovalEvent), before, live, latestBefore),
			events: history,
		};
	} finally {
		signal?.removeEventListener("abort", onAbort);
		unsubscribe();
	}
}

/** 审批 API 保持原合同；删除协调同时检查同一快照里的主会话状态。 */
export async function readApprovalState(
	gateway: ProviderGateway,
	buffers: EventBufferRegistry,
	sessionId: string,
	signal?: AbortSignal,
) {
	return (await readSessionApprovalSnapshot(gateway, buffers, sessionId, signal)).approvals;
}
