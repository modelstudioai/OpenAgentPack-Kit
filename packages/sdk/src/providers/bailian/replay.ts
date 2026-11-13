import { KitError, mergeEventSnapshots, type SessionEvent, sessionStatusOf, threadIdOf } from "../../protocol/index.ts";

const invalid = () => new KitError("provider_error", "事件历史缺少可验证的身份、顺序或会话状态");
function timestamp(event: SessionEvent): number | undefined {
	if (!event.created_at) return;
	const value = Date.parse(event.created_at);
	return Number.isFinite(value) ? value : undefined;
}

/** 保留消息首次身份顺序及实时状态更新顺序，不把历史重叠帧提升为新观察。 */
export class BailianReplay {
	private events: SessionEvent[] = [];
	private index = new Map<string, number>();
	private historicalIds = new Set<string>();
	private lastBufferedPosition = -1;
	private buffered: SessionEvent[] = [];
	private bufferedMessages = new Map<string, number>();

	addHistory(event: SessionEvent) {
		if (!event.event_id || this.index.has(event.event_id)) throw invalid();
		this.index.set(event.event_id, this.events.length);
		this.historicalIds.add(event.event_id);
		this.events.push(event);
	}

	addBuffered(event: SessionEvent) {
		if (!event.event_id) throw invalid();
		// 新消息按首次出现的位置保存最新累计快照，等后续快照补齐起始帧缺失的创建时间。
		// 状态的每次观察和已有历史的冲突检查仍保留原顺序，不能一起规约为最后一条。
		if (!this.historicalIds.has(event.event_id) && (event.type === "message" || event.type === "reasoning")) {
			const position = this.bufferedMessages.get(event.event_id);
			if (position !== undefined) {
				const previous = this.buffered[position]!;
				const next = mergeEventSnapshots(previous, event);
				// 创建时间只补缺失，不能把后续快照的时间当作版本号而移动消息。
				this.buffered[position] =
					previous.created_at === undefined ? next : { ...next, created_at: previous.created_at };
				return;
			}
			this.bufferedMessages.set(event.event_id, this.buffered.length);
		}
		this.buffered.push(event);
	}

	private replayBuffered(event: SessionEvent) {
		if (!event.event_id) throw invalid();
		const position = this.index.get(event.event_id);
		if (position !== undefined) {
			const previous = this.events[position]!;
			const next = mergeEventSnapshots(previous, event);
			const completes =
				previous.metadata?.event_status === "in_progress" && event.metadata?.event_status === "completed";
			// created_at 标识创建时间，不是同 ID 更新的版本号。无水位时拒绝无法排序的状态覆盖。
			if (this.historicalIds.has(event.event_id) && !completes && JSON.stringify(previous) !== JSON.stringify(next))
				throw invalid();
			if (next !== previous && next.type === "session_status" && !this.historicalIds.has(event.event_id)) {
				// 状态更新发生在当前流位置；原创建时间不能定位它相对后续历史的位置。
				if (this.events.slice(this.lastBufferedPosition + 1).some((item) => this.historicalIds.has(item.event_id!)))
					throw invalid();
				this.index.set(event.event_id, this.events.length);
				this.lastBufferedPosition = this.events.length;
				this.events.push(next);
			} else {
				this.events[position] = next;
				this.lastBufferedPosition = Math.max(this.lastBufferedPosition, position);
			}
			return;
		}
		const insert = this.insertionPosition(event);
		this.events.splice(insert, 0, event);
		this.index = new Map(this.events.map((item, i) => [item.event_id!, i]));
		this.lastBufferedPosition = insert;
	}

	/** 时间只定位新身份相对历史的位置；同一实时流自身已经有顺序。 */
	private insertionPosition(event: SessionEvent) {
		let insert = this.events.length;
		if (!this.historicalIds.size) return insert;
		const time = timestamp(event);
		if (time === undefined) throw invalid();
		for (let i = 0; i < this.events.length; i++) {
			const item = this.events[i]!;
			if (!this.historicalIds.has(item.event_id!)) continue;
			const other = timestamp(item);
			if (other === undefined || other === time) throw invalid();
			if (other > time && insert === this.events.length) insert = i;
		}
		if (insert <= this.lastBufferedPosition) throw invalid();
		return insert;
	}

	finish(): SessionEvent[] {
		const buffered = this.buffered;
		this.buffered = [];
		this.bufferedMessages.clear();
		for (const event of buffered) this.replayBuffered(event);
		const known = new Set([
			"idle",
			"running",
			"busy",
			"in_progress",
			"failed",
			"completed",
			"terminated",
			"deleted",
			"archived",
		]);
		for (const event of this.events)
			if (event.type === "session_status" && !threadIdOf(event) && !known.has(sessionStatusOf(event) ?? ""))
				throw invalid();
		// 完整空历史表示新会话；非空记录必须提供可判定的主会话状态，避免恢复后误开放发送。
		if (
			this.events.length &&
			!this.events.some(
				(event) =>
					!threadIdOf(event) &&
					(sessionStatusOf(event) !== undefined ||
						(["message", "reasoning"].includes(event.type) && event.metadata?.event_status === "in_progress")),
			)
		)
			throw invalid();
		return this.events;
	}
}
