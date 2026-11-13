import type { SessionEvent } from "./events.ts";

/** 合并 SDK 的累计快照，不再把正文作为 delta 追加。缺失字段保留，显式空值替换。 */
export function mergeEventSnapshots(previous: SessionEvent | undefined, incoming: SessionEvent): SessionEvent {
	if (!previous) return incoming;
	if (previous.metadata?.event_status === "completed" && incoming.metadata?.event_status === "in_progress")
		return previous;
	const defined = Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== undefined));
	const merged = {
		...previous,
		...defined,
		...(incoming.metadata ? { metadata: { ...previous.metadata, ...incoming.metadata } } : {}),
	} as SessionEvent;
	return JSON.stringify(merged) === JSON.stringify(previous) ? previous : merged;
}
