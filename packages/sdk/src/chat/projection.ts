import type { ChatMessage, MessagePart, MessageTransformer } from "../messages/types.ts";
import {
	type ArtifactDescriptor,
	type AttachmentRef,
	type SessionEvent,
	sessionStatusOf,
	stopReasonOf,
	threadIdOf,
} from "../protocol/index.ts";
export type TurnPhase = "idle" | "running" | "requires_action" | "stopping" | "failed" | "interrupted";

export interface EventEntry {
	identity: string;
	event: SessionEvent;
	sequence: number;
	updated: number;
	transport?: TransportPosition;
	firstTransport?: TransportPosition;
}
interface TransportPosition {
	epoch: string;
	sequence: number;
}
/** 仅 Kit 内部解释自有 cursor；公开 API 和 SDK 均将其作为不透明字符串传递。 */
export function transportPosition(cursor?: string): TransportPosition | undefined {
	if (!cursor) return;
	const colon = cursor.lastIndexOf(":");
	if (colon < 1) return;
	const value = cursor.slice(colon + 1);
	if (!/^\d+$/.test(value)) return;
	const sequence = Number(value);
	if (!Number.isSafeInteger(sequence)) return;
	return { epoch: cursor.slice(0, colon), sequence };
}
function compareOrder(
	a: { sequence: number; transport?: TransportPosition },
	b: { sequence: number; transport?: TransportPosition },
): number {
	if (a.transport && b.transport && a.transport.epoch === b.transport.epoch)
		return a.transport.sequence - b.transport.sequence;
	return a.sequence - b.sequence;
}
export function compareEventUpdates(a: EventEntry, b: EventEntry): number {
	return compareOrder({ sequence: a.updated, transport: a.transport }, { sequence: b.updated, transport: b.transport });
}
export interface OptimisticOverlay {
	message: ChatMessage;
	generation: number;
	after: number;
	knownUserIds: Set<string>;
	providerEventIds: Set<string>;
	sequence: number;
}

function matchesEcho(overlay: OptimisticOverlay, entry: EventEntry): boolean {
	if (entry.event.role !== "user" || overlay.knownUserIds.has(entry.identity)) return false;
	if (entry.event.event_id && overlay.providerEventIds.has(entry.event.event_id)) return true;
	const clientId = entry.event.metadata?.client_message_id;
	return typeof clientId === "string" && clientId === overlay.message.clientMessageId;
}

/** 附件分片的稳定 id 只由 file_id 决定：乐观气泡与回显替换、历史重建之间复用同一 DOM。 */
export function attachmentParts(files: AttachmentRef[]): MessagePart[] {
	const seen = new Set<string>();
	const parts: MessagePart[] = [];
	for (const file of files) {
		if (!file.file_id || seen.has(file.file_id)) continue;
		seen.add(file.file_id);
		parts.push({ type: "attachment", id: `attachment:${file.file_id}`, file });
	}
	return parts;
}
function filesOfMessage(message: ChatMessage): AttachmentRef[] {
	return message.parts
		.filter((part): part is Extract<MessagePart, { type: "attachment" }> => part.type === "attachment")
		.map((part) => part.file);
}

/** 把附件分片前置进用户消息；同一 file_id 只保留一份，回显合并与历史映射重叠时天然去重。 */
function prependAttachments(message: ChatMessage, files: AttachmentRef[]) {
	const existing = new Set(filesOfMessage(message).map((file) => file.file_id));
	const additions = files.filter((file) => !existing.has(file.file_id));
	if (additions.length) message.parts.unshift(...attachmentParts(additions));
}

/** 未确认回显的乐观消息按插入位置渲染；已确认的把附件分片留给对应位置的事件合并。 */
function splitOverlays(entries: EventEntry[], overlays: OptimisticOverlay[]) {
	const pending = new Map<number, ChatMessage[]>();
	const matchedFiles = new Map<number, AttachmentRef[]>();
	for (const overlay of overlays) {
		const position = entries.findIndex((entry) => matchesEcho(overlay, entry));
		if (position >= 0) {
			const files = filesOfMessage(overlay.message);
			if (files.length) matchedFiles.set(position, [...(matchedFiles.get(position) ?? []), ...files]);
			continue;
		}
		const at = Math.min(overlay.after, entries.length);
		pending.set(at, [...(pending.get(at) ?? []), structuredClone(overlay.message)]);
	}
	return { pending, matchedFiles };
}
function eventPhase(event: SessionEvent, previous: TurnPhase): TurnPhase {
	if (event.type === "message" || event.type === "reasoning") {
		if (event.role !== "user" && event.metadata?.event_status === "completed") return previous;
		return "running";
	}
	if (event.type === "error") return "failed";
	if (event.type !== "session_status") return previous;
	return statusPhase(event, previous);
}
function statusPhase(event: SessionEvent, previous: TurnPhase): TurnPhase {
	const status = sessionStatusOf(event);
	const reason = stopReasonOf(event)?.type;
	if (["running", "busy", "in_progress"].includes(status ?? "")) return "running";
	if (status === "failed") return "failed";
	if (status === "idle" && reason === "requires_action") return "requires_action";
	if (status === "idle" && (reason === "interrupted" || reason === "cancelled")) return "interrupted";
	return ["idle", "completed", "terminated", "deleted", "archived"].includes(status ?? "") ? "idle" : previous;
}
function finalizeMessages(messages: ChatMessage[], phase: TurnPhase) {
	if (!["idle", "failed", "interrupted"].includes(phase)) return;
	for (const message of messages)
		if (message.status === "streaming")
			message.status = phase === "idle" ? "done" : (phase as "failed" | "interrupted");
}
export function projectPhase(entries: EventEntry[], overlays: OptimisticOverlay[]) {
	const observations = entries
		.filter((entry) => !threadIdOf(entry.event))
		.map((entry) => ({
			sequence: entry.event.type === "session_status" ? entry.updated : entry.sequence,
			transport: entry.event.type === "session_status" ? entry.transport : entry.firstTransport,
			event: entry.event,
			overlay: undefined as OptimisticOverlay | undefined,
		}));
	for (const overlay of overlays)
		if (!entries.some((entry) => matchesEcho(overlay, entry)))
			observations.push({ sequence: overlay.sequence, transport: undefined, event: { type: "message" }, overlay });
	observations.sort(compareOrder);
	let phase: TurnPhase = "idle";
	let providerStatus: string | null = null;
	for (const observation of observations) {
		if (observation.overlay) {
			phase = observation.overlay.message.status === "failed" ? "failed" : "running";
			continue;
		}
		providerStatus = sessionStatusOf(observation.event) ?? providerStatus;
		phase = eventPhase(observation.event, phase);
	}
	return { phase, providerStatus };
}
function mergeAttachments(target: { messages: ChatMessage[] }, files: AttachmentRef[], identity: string) {
	if (!files.length) return;
	const produced = target.messages.at(-1);
	if (produced?.id === identity && produced.role === "user") prependAttachments(produced, files);
}
/** 按 Provider 投递顺序调用其展示规则重建消息；事件身份保持稳定，不按时间戳重新排序。 */
export function projectEvents(
	entries: EventEntry[],
	overlays: OptimisticOverlay[],
	transformMessage: MessageTransformer,
	messageFiles?: ReadonlyMap<string, AttachmentRef[]>,
) {
	let messages: ChatMessage[] = [];
	const threads: Record<string, ChatMessage[]> = {};
	const artifacts = new Map<string, ArtifactDescriptor>();
	const { pending, matchedFiles } = splitOverlays(entries, overlays);
	const { phase, providerStatus } = projectPhase(entries, overlays);
	let lastEventId: string | null = null;
	function addPending(position: number) {
		for (const message of pending.get(position) ?? []) {
			messages.push(message);
		}
	}
	for (const [position, { identity, event }] of entries.entries()) {
		addPending(position);
		const thread = threadIdOf(event);
		// thread_created 由主消息流渲染成子 Agent 卡；其余子线程归属事件进各自分组，不污染主流。
		const toMain = !thread || event.type === "thread_created";
		const target = toMain ? messages : (threads[thread] ?? []);
		const result = transformMessage({ messages: target, event: structuredClone(event), identity });
		if (toMain) messages = result.messages;
		else threads[thread] = result.messages;
		// 附件展示不在 provider 事件里：回显替换时继承乐观分片，历史重建按本地关联索引补齐。
		mergeAttachments(result, [...(matchedFiles.get(position) ?? []), ...(messageFiles?.get(identity) ?? [])], identity);
		for (const artifact of result.artifacts ?? [])
			artifacts.set(artifact.file_id, { ...artifacts.get(artifact.file_id), ...artifact });
		if (event.event_id) lastEventId = event.event_id;
	}
	addPending(entries.length);
	finalizeMessages(messages, phase);
	return { messages, threads, artifacts: [...artifacts.values()], phase, providerStatus, lastEventId };
}
