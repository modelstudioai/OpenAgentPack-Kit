import { randomUUID } from "node:crypto";
import { mergeEventSnapshots, type SessionEvent, threadIdOf } from "@openagentpack/kit-sdk/protocol";

export interface EventChange {
	event: SessionEvent;
	cursor: string;
}
export interface EventBuffer {
	sessionId: string;
	epoch: string;
	sequence: number;
	events: SessionEvent[];
	positions: Map<string, number>;
	changes: EventChange[];
	latest: Map<number, string>;
	listeners: Set<(change?: EventChange) => void>;
	closed: boolean;
	latestStatus?: SessionEvent;
}

/** 最新快照索引与有界传输日志分离：相同 event_id 的新版本也有独立续传位置。 */
export function createEventBufferRegistry(options: { maxChanges?: number } = {}) {
	const buffers = new Map<string, EventBuffer>();
	const maxChanges = options.maxChanges ?? 1024;
	return {
		get: (id: string) => buffers.get(id),
		ensure(sessionId: string): EventBuffer {
			let buffer = buffers.get(sessionId);
			if (!buffer) {
				buffer = {
					sessionId,
					epoch: randomUUID(),
					sequence: 0,
					events: [],
					positions: new Map(),
					changes: [],
					latest: new Map(),
					listeners: new Set(),
					closed: false,
				};
				buffers.set(sessionId, buffer);
			}
			return buffer;
		},
		reset(sessionId: string) {
			const buffer = this.ensure(sessionId);
			buffer.epoch = randomUUID();
			buffer.sequence = 0;
			buffer.events = [];
			buffer.positions.clear();
			buffer.latest.clear();
			buffer.changes = [];
			buffer.closed = false;
			buffer.latestStatus = undefined;
			return buffer;
		},
		append(sessionId: string, incoming: SessionEvent): EventChange | undefined {
			const buffer = this.ensure(sessionId);
			const position = incoming.event_id ? buffer.positions.get(incoming.event_id) : undefined;
			const previous = buffer.events[position ?? -1];
			const event = mergeEventSnapshots(previous, incoming);
			if (previous === event) return;
			const index = position ?? buffer.events.length;
			buffer.events[index] = event;
			if (event.type === "session_status" && !threadIdOf(event)) buffer.latestStatus = event;
			if (event.event_id) buffer.positions.set(event.event_id, index);
			const cursor = `${buffer.epoch}:${++buffer.sequence}`;
			const change = { event, cursor };
			buffer.latest.set(index, cursor);
			buffer.changes.push(change);
			if (buffer.changes.length > maxChanges) buffer.changes.shift();
			for (const listener of buffer.listeners) listener(change);
			return change;
		},
		seed(sessionId: string, events: SessionEvent[]) {
			for (const event of events) this.append(sessionId, event);
			return this.ensure(sessionId);
		},
		cursor(sessionId: string): string | null {
			const buffer = this.ensure(sessionId);
			return buffer.sequence ? `${buffer.epoch}:${buffer.sequence}` : null;
		},
		replay(sessionId: string, after?: string): { reset: boolean; changes: EventChange[] } {
			const buffer = this.ensure(sessionId);
			if (after) {
				const colon = after.lastIndexOf(":");
				const sequence = Number(after.slice(colon + 1));
				const first = buffer.sequence - buffer.changes.length;
				if (
					after.slice(0, colon) === buffer.epoch &&
					Number.isSafeInteger(sequence) &&
					sequence >= first &&
					sequence <= buffer.sequence
				) {
					return {
						reset: false,
						changes: buffer.changes.filter(
							(change) => Number(change.cursor.slice(change.cursor.lastIndexOf(":") + 1)) > sequence,
						),
					};
				}
			}
			return {
				reset: true,
				changes: buffer.events.map((event, index) => ({ event, cursor: buffer.latest.get(index) as string })),
			};
		},
		subscribe(sessionId: string, listener: (change?: EventChange) => void): () => void {
			const buffer = this.ensure(sessionId);
			buffer.listeners.add(listener);
			return () => {
				buffer.listeners.delete(listener);
			};
		},
		notify(sessionId: string) {
			for (const listener of this.ensure(sessionId).listeners) listener();
		},
		close(sessionId: string) {
			this.ensure(sessionId).closed = true;
			this.notify(sessionId);
		},
		drop(sessionId: string) {
			buffers.delete(sessionId);
		},
		size: () => buffers.size,
	};
}
export type EventBufferRegistry = ReturnType<typeof createEventBufferRegistry>;
