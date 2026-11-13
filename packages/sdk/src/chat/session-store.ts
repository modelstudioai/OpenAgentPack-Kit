import { transformSessionEvent } from "../messages/merge.ts";
import type { ChatMessage, MessageStatus, MessageTransformer } from "../messages/types.ts";
import {
	type ArtifactDescriptor,
	type AttachmentRef,
	deriveApprovalState,
	type MessageFileAssociation,
	mergeEventSnapshots,
	type SessionEvent,
	stableEventId,
	type ToolApproval,
	type ToolApprovalsResponse,
	threadIdOf,
} from "../protocol/index.ts";

import {
	attachmentParts,
	compareEventUpdates,
	type EventEntry as Entry,
	type OptimisticOverlay as Overlay,
	projectEvents,
	type TurnPhase,
	transportPosition,
} from "./projection.ts";

export type { TurnPhase } from "./projection.ts";
export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";
export type ChatToolApproval = Omit<ToolApproval, "status"> & {
	status: "pending" | "submitting" | "submitted" | "uncertain" | "stale";
};
export interface SessionStoreOptions {
	transformMessage?: MessageTransformer;
}
export interface SessionSnapshot {
	sessionId: string | null;
	providerStatus: string | null;
	turnRunning: boolean;
	phase: TurnPhase;
	connection: ConnectionState;
	canSend: boolean;
	messages: ChatMessage[];
	threads: Record<string, ChatMessage[]>;
	artifacts: ArtifactDescriptor[];
	approvals: ChatToolApproval[];
	lastEventId: string | null;
	lastCursor: string | null;
	streamError: { code: string; message: string } | null;
}

function empty(sessionId: string | null): SessionSnapshot {
	return {
		sessionId,
		providerStatus: null,
		turnRunning: false,
		phase: "idle",
		connection: "disconnected",
		canSend: false,
		messages: [],
		threads: {},
		artifacts: [],
		approvals: [],
		lastEventId: null,
		lastCursor: null,
		streamError: null,
	};
}
export interface SessionStore {
	subscribe(listener: () => void): () => void;
	getSnapshot(): SessionSnapshot;
	reset(sessionId: string | null): void;
	beginTurn(input: { text: string; clientMessageId?: string; attachments?: AttachmentRef[] }): {
		messageId: string;
		generation: number;
	};
	/** 会话详情的「消息↔附件」关联索引；刷新或重开后据此为历史用户气泡补附件分片。 */
	setMessageFiles(entries: MessageFileAssociation[]): void;
	acknowledgePending(messageId: string, eventIds: string[], generation: number): void;
	setPendingStatus(messageId: string, status: MessageStatus, generation: number): void;
	applyEvent(event: SessionEvent, cursor?: string): "applied" | "duplicate";
	beginReplay(): void;
	finishReplay(cursor?: string | null): void;
	setConnection(connection: ConnectionState): void;
	setApprovals(response: ToolApprovalsResponse): void;
	setApprovalStatus(batchId: string, callId: string, status: ChatToolApproval["status"]): void;
	markStopping(): void;
	clearStopping(): void;
	onStreamDone(): void;
	onStreamError(error: { code: string; message: string }): void;
	clearStreamError(): void;
	notify(): void;
	generation(): number;
}

const running = (phase: TurnPhase) => phase === "running" || phase === "requires_action" || phase === "stopping";
const approvalKey = (approval: Pick<ToolApproval, "batch_id" | "call_id">) =>
	JSON.stringify([approval.batch_id, approval.call_id]);

/** JSON 对象的字段顺序不代表快照版本；数组顺序仍保留其业务含义。 */
function snapshotFingerprint(event: SessionEvent): string {
	return JSON.stringify(event, (_key, value: unknown) => {
		if (value && typeof value === "object" && !Array.isArray(value))
			return Object.fromEntries(
				Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
			);
		return value;
	});
}

/** 私有有序 ledger 持有 SDK 快照；UI 是可重建投影，乐观消息保存在独立 overlay。 */
export function createSessionStore(
	initialSessionId: string | null = null,
	options: SessionStoreOptions = {},
): SessionStore {
	const transformMessage = options.transformMessage ?? transformSessionEvent;
	let state = empty(initialSessionId);
	let generation = 0;
	let sequence = 0;
	let entries: Entry[] = [];
	let index = new Map<string, number>();
	let replay: Entry[] | null = null;
	let replayIndex = new Map<string, number>();
	let overlays: Overlay[] = [];
	let messageFiles = new Map<string, AttachmentRef[]>();
	let approvalOverride: ToolApprovalsResponse | null = null;
	const approvalStatuses = new Map<string, ChatToolApproval["status"]>();
	const listeners = new Set<() => void>();
	const emit = () => {
		for (const listener of listeners) listener();
	};
	const patch = (next: Partial<SessionSnapshot>) => {
		state = { ...state, ...next };
		state.turnRunning = running(state.phase);
		state.canSend =
			state.connection === "connected" &&
			!state.turnRunning &&
			!["terminated", "deleted", "archived"].includes(state.providerStatus ?? "");
		emit();
	};

	function project() {
		const projected = projectEvents(entries, overlays, transformMessage, messageFiles);
		const latestStatus = entries
			.filter((entry) => entry.event.type === "session_status" && !threadIdOf(entry.event))
			.sort((a, b) => compareEventUpdates(b, a))[0]?.event;
		const approvalState =
			approvalOverride ??
			deriveApprovalState(
				entries.map((entry) => entry.event),
				latestStatus,
			);
		const approvals = approvalState.requests.map((approval) => ({
			...approval,
			status:
				approval.status === "submitted"
					? ("submitted" as const)
					: (approvalStatuses.get(approvalKey(approval)) ?? approval.status ?? "pending"),
		}));
		let phase = approvalState.requires_action ? ("requires_action" as const) : projected.phase;
		if (state.phase === "stopping" && running(phase)) phase = "stopping";
		patch({ ...projected, approvals, phase });
	}
	function observeEntry(
		identity: string,
		event: SessionEvent,
		known: Entry | undefined,
		transport: Entry["transport"],
	): Entry {
		const updated =
			known && snapshotFingerprint(known.event) === snapshotFingerprint(event) ? known.updated : ++sequence;
		return {
			identity,
			event,
			sequence: known?.sequence ?? updated,
			updated,
			transport,
			firstTransport: known?.firstTransport ?? transport,
		};
	}
	function upsert(target: Entry[], targetIndex: Map<string, number>, event: SessionEvent, cursor?: string): boolean {
		const identity = event.event_id || (cursor ? `transport:${cursor}` : stableEventId(event));
		const position = targetIndex.get(identity);
		const previousEntry = position === undefined ? undefined : target[position];
		const previous = previousEntry?.event;
		const next = mergeEventSnapshots(previous, structuredClone(event));
		if (previous === next) return false;
		const transport = transportPosition(cursor) ?? previousEntry?.transport;
		// reset 只重建 Provider 集合，不把已观察的历史提升为乐观发送之后的新状态。
		// 正文仍使用本次回放的权威快照；这里只继承相同身份的首次位置与未变化快照的观察次序。
		const known = previousEntry ?? (target === replay ? entries[index.get(identity) ?? -1] : undefined);
		const entry = observeEntry(identity, next, known, transport);
		if (position === undefined) {
			targetIndex.set(identity, target.length);
			target.push(entry);
		} else target[position] = entry;
		return true;
	}

	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSnapshot: () => state,
		reset(sessionId) {
			generation++;
			entries = [];
			index.clear();
			replay = null;
			replayIndex.clear();
			overlays = [];
			messageFiles = new Map();
			approvalOverride = null;
			approvalStatuses.clear();
			state = empty(sessionId);
			emit();
		},
		beginTurn({ text, clientMessageId, attachments }) {
			generation++;
			const message: ChatMessage = {
				id: `optimistic:${generation}:${Math.random().toString(36).slice(2)}`,
				role: "user",
				parts: [...attachmentParts(attachments ?? []), { type: "text", text }],
				status: "pending",
				clientMessageId,
			};
			overlays.push({
				message,
				generation,
				after: entries.length,
				sequence: ++sequence,
				providerEventIds: new Set(),
				knownUserIds: new Set(entries.filter((entry) => entry.event.role === "user").map((entry) => entry.identity)),
			});
			project();
			return { messageId: message.id, generation };
		},
		acknowledgePending(messageId, eventIds, gen) {
			if (gen !== generation) return;
			const overlay = overlays.find((item) => item.message.id === messageId);
			if (!overlay) return;
			overlay.providerEventIds = new Set(eventIds);
			project();
		},
		setPendingStatus(messageId, status, gen) {
			if (gen !== generation) return;
			const overlay = overlays.find((item) => item.message.id === messageId);
			if (!overlay) return;
			overlay.message = { ...overlay.message, status };
			project();
		},
		setMessageFiles(entries) {
			const map = new Map<string, AttachmentRef[]>();
			for (const entry of entries)
				for (const eventId of entry.event_ids) {
					const files = map.get(eventId);
					map.set(eventId, files ? [...files, ...entry.files] : entry.files);
				}
			messageFiles = map;
			project();
		},
		applyEvent(event, cursor) {
			const changed = upsert(replay ?? entries, replay ? replayIndex : index, event, cursor);
			if (cursor && !replay) state = { ...state, lastCursor: cursor };
			if (!changed) return "duplicate";
			approvalOverride = null;
			if (!replay) project();
			return "applied";
		},
		beginReplay() {
			replay = [];
			replayIndex = new Map();
		},
		finishReplay(cursor) {
			if (replay) {
				entries = replay;
				index = replayIndex;
				replay = null;
				replayIndex = new Map();
				approvalOverride = null;
			}
			if (cursor !== undefined) state = { ...state, lastCursor: cursor };
			project();
		},
		setConnection(connection) {
			patch({ connection });
		},
		setApprovals(response) {
			approvalOverride = response;
			project();
		},
		setApprovalStatus(batchId, callId, status) {
			approvalStatuses.set(approvalKey({ batch_id: batchId, call_id: callId }), status);
			project();
		},
		markStopping() {
			patch({ phase: "stopping" });
		},
		clearStopping() {
			state = { ...state, phase: "running" };
			project();
		},
		onStreamDone() {
			patch({ connection: "disconnected" });
		},
		onStreamError(streamError) {
			patch({ streamError });
		},
		clearStreamError() {
			if (state.streamError) patch({ streamError: null });
		},
		notify() {
			state = { ...state };
			emit();
		},
		generation: () => generation,
	};
}
export { ensureAssistant } from "../messages/merge.ts";
