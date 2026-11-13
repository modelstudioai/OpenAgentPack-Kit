import { isDeepStrictEqual } from "node:util";
import { KitError, mergeEventSnapshots, type SessionEvent } from "@openagentpack/kit-sdk/protocol";

export function snapshotConflict(): KitError {
	return new KitError("provider_error", "历史与实时快照的更新顺序无法确认，请重新连接后刷新");
}

export function sameSnapshot(previous: SessionEvent, incoming: SessionEvent): boolean {
	return isDeepStrictEqual(previous, mergeEventSnapshots(previous, incoming));
}

/** 独立 HTTP/SSE 读取没有共同版本号；只有相同快照或明确的生命周期推进可比较。 */
export function reconcileUnorderedSnapshot(previous: SessionEvent, incoming: SessionEvent): SessionEvent {
	const merged = mergeEventSnapshots(previous, incoming);
	if (isDeepStrictEqual(previous, merged)) return previous;
	if (previous.metadata?.event_status === "in_progress" && incoming.metadata?.event_status === "completed")
		return merged;
	throw snapshotConflict();
}

function latestBufferedSnapshots(buffered: SessionEvent[]) {
	const bufferedLatest = new Map<string, { event: SessionEvent; position: number }>();
	for (const [position, event] of buffered.entries()) {
		if (event.event_id)
			bufferedLatest.set(event.event_id, {
				event: mergeEventSnapshots(bufferedLatest.get(event.event_id)?.event, event),
				position,
			});
	}
	return bufferedLatest;
}

/** 先验证整个恢复视图，不能发布一半历史后才发现同 ID 状态冲突。 */
export function reconcileInitialSnapshots(history: SessionEvent[], buffered: SessionEvent[]): SessionEvent[] {
	const events = [...history];
	const latest = new Map(history.map((event) => [event.event_id, event]));
	const historicalIds = new Set(latest.keys());
	const bufferedLatest = latestBufferedSnapshots(buffered);
	for (const [position, event] of buffered.entries()) {
		if (!event.event_id) {
			events.push(event);
			continue;
		}
		const previous = latest.get(event.event_id);
		const historical = historicalIds.has(event.event_id);
		const last = bufferedLatest.get(event.event_id)!;
		// 已知实时顺序中的最终 completed 可消除较早 partial 与历史之间的歧义。
		if (historical && last.position !== position) continue;
		const next =
			previous && historical ? reconcileUnorderedSnapshot(previous, last.event) : mergeEventSnapshots(previous, event);
		if (next === previous) continue;
		events.push(next);
		latest.set(event.event_id, next);
	}
	return events;
}
