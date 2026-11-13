import { type SessionEvent, sessionStatusOf, stopReasonOf } from "@openagentpack/kit-sdk/protocol";
import type { UsageLimitRequest } from "../store/usage-limits.ts";
import type { EventBuffer } from "./event-buffer.ts";

const ended = new Set(["idle", "terminated", "archived", "completed", "failed", "stopped"]);
const statusValues = (event: SessionEvent) => [event.event_id, sessionStatusOf(event), stopReasonOf(event)?.type];
const statusValue = (event: SessionEvent) => JSON.stringify(statusValues(event));

export function eventEnded(event?: SessionEvent) {
	return Boolean(event && ended.has(sessionStatusOf(event) ?? "") && stopReasonOf(event)?.type !== "requires_action");
}

function statusCursor(event: SessionEvent, buffer?: EventBuffer) {
	if (!buffer?.latestStatus || statusValue(buffer.latestStatus) !== statusValue(event)) return;
	const position = event.event_id ? buffer.positions.get(event.event_id) : undefined;
	return position === undefined ? undefined : buffer.latest.get(position);
}

/** 只持久化状态身份、状态值和内存变更游标，不保存事件正文。 */
export function statusMarker(event?: SessionEvent, buffer?: EventBuffer) {
	return event ? JSON.stringify([...statusValues(event), statusCursor(event, buffer) ?? null]) : "[]";
}

function sequenceInEpoch(cursor: unknown, epoch: string) {
	if (typeof cursor !== "string" || !cursor.startsWith(`${epoch}:`)) return null;
	const sequence = Number(cursor.slice(epoch.length + 1));
	return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : null;
}

export function requestFinished(
	events: SessionEvent[],
	status: SessionEvent | undefined,
	request: Pick<UsageLimitRequest, "event_ids" | "previous_status">,
	buffer?: EventBuffer,
) {
	if (!status || !eventEnded(status)) return false;
	const ids = JSON.parse(request.event_ids ?? "[]") as string[];
	if (!ids.every((id) => events.some((event) => event.event_id === id))) return false;
	const previous = request.previous_status === null ? null : (JSON.parse(request.previous_status) as unknown[]);
	// 本轮状态快照可能创建在用户消息之前，再原位更新为结束；数组位置不是更新时间。
	if (previous && JSON.stringify(previous.slice(0, 3)) !== statusValue(status)) return true;
	// 旧请求缺少发送前摘要时，仅保留新事件创建顺序能证实的路径，不把旧状态的原位更新当新事件。
	if (!previous && ids.length) {
		const statusPosition = events.findIndex((event) => event.event_id === status.event_id);
		if (ids.every((id) => events.findIndex((event) => event.event_id === id) < statusPosition)) return true;
	}
	if (!buffer || !previous) return false;
	const before = sequenceInEpoch(previous[3], buffer.epoch);
	const completed = sequenceInEpoch(statusCursor(status, buffer), buffer.epoch);
	if (before === null || completed === null || completed <= before) return false;
	// 跨轮完全复用同一状态身份和值时，只接受同一缓冲世代中晚于本轮回显的主状态更新。
	return ids.every((id) => {
		const position = buffer.positions.get(id);
		const accepted = sequenceInEpoch(position === undefined ? undefined : buffer.latest.get(position), buffer.epoch);
		if (accepted !== null && accepted > before && completed > accepted) return true;
		// 用户回显也可能同 ID 更新；结束之后的快照更新不能抹掉已知的首次回显顺序。
		return buffer.changes.some((change) => {
			const sequence = sequenceInEpoch(change.cursor, buffer.epoch);
			return change.event.event_id === id && sequence !== null && sequence > before && sequence < completed;
		});
	});
}
