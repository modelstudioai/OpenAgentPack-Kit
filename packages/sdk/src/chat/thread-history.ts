import { KitError, mergeEventSnapshots, type SessionEvent, stableEventId } from "../protocol/index.ts";

export interface ThreadEventEntry {
	event: SessionEvent;
	revision: number;
	/** 已由独立线程分页覆盖，续页先后可由 Provider 游标证明。 */
	history?: boolean;
}
const invalidOrder = () => new KitError("provider_error", "子 Agent 历史与实时事件缺少可验证的顺序，请重试");
export function eventTime(event: SessionEvent): number | undefined {
	const time = Date.parse(event.created_at ?? "");
	return Number.isFinite(time) ? time : undefined;
}
/** 两个来源各自有序；分页来源证明页间先后，未覆盖的实时区段才借助创建时间。 */
function mergeDisjoint(left: ThreadEventEntry[], right: ThreadEventEntry[], older: boolean): ThreadEventEntry[] {
	const result: ThreadEventEntry[] = [];
	let a = 0,
		b = 0;
	while (a < left.length && b < right.length) {
		if (left[a]!.history) {
			result.push(older ? right[b++]! : left[a++]!);
			continue;
		}
		const first = eventTime(left[a]!.event),
			second = eventTime(right[b]!.event);
		if (first === undefined || second === undefined || first === second) throw invalidOrder();
		result.push(first < second ? left[a++]! : right[b++]!);
	}
	return [...result, ...left.slice(a), ...right.slice(b)];
}

/** 保留 Provider 各页/流内顺序；共有 event_id 是跨来源锚点，更新仍按请求修订号合并。 */
export function mergeThreadHistory(
	existing: ThreadEventEntry[],
	incoming: SessionEvent[],
	started: number,
	older = false,
): ThreadEventEntry[] {
	const positions = new Map(existing.map((entry, index) => [stableEventId(entry.event), index]));
	const page = new Map<string, ThreadEventEntry>();
	for (const event of incoming) {
		const id = stableEventId(event);
		const known = existing[positions.get(id) ?? -1];
		const history = mergeEventSnapshots(page.get(id)?.event, structuredClone(event));
		page.set(id, {
			event:
				known && known.revision > started
					? mergeEventSnapshots(history, known.event)
					: mergeEventSnapshots(known?.event, history),
			revision: known?.revision ?? started,
			history: true,
		});
	}
	const rows = [...page.values()];
	const result: ThreadEventEntry[] = [];
	let left = 0,
		right = 0;
	for (let index = 0; index < rows.length; index++) {
		const entry = rows[index]!;
		const anchor = positions.get(stableEventId(entry.event));
		if (anchor === undefined) continue;
		if (anchor < left) throw invalidOrder();
		result.push(...mergeDisjoint(existing.slice(left, anchor), rows.slice(right, index), older), entry);
		left = anchor + 1;
		right = index + 1;
	}
	return [...result, ...mergeDisjoint(existing.slice(left), rows.slice(right), older)];
}
