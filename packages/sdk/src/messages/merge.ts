import {
	type ArtifactDescriptor,
	artifactsOf,
	bucketOf,
	eventDataOf,
	isTurnEndEvent,
	type SessionEvent,
	sessionStatusOf,
	stableEventId,
	stopReasonOf,
	threadIdOf,
} from "../protocol/index.ts";
import type { ChatMessage, MessagePart, MessageTransformInput, MessageTransformResult } from "./types.ts";

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function textOf(event: SessionEvent): string {
	return (event.content ?? []).map((block) => (typeof block.text === "string" ? block.text : "")).join("");
}

export function currentAssistant(messages: ChatMessage[]): ChatMessage | undefined {
	const last = messages.at(-1);
	return last?.role === "assistant" && last.status === "streaming" ? last : undefined;
}

/** 仅创建展示消息；稳定 id 由首个事件的身份决定。 */
export function ensureAssistant(
	messages: ChatMessage[],
	threadId?: string,
	createdAt?: string,
	eventId?: string,
): ChatMessage {
	const existing = currentAssistant(messages);
	if (existing) return existing;
	const message: ChatMessage = {
		id: `assistant:${eventId ?? messages.length}`,
		role: "assistant",
		parts: [],
		status: "streaming",
		threadId,
		createdAt,
	};
	messages.push(message);
	return message;
}

function lifecycle(event: SessionEvent): "streaming" | "done" | "failed" | "interrupted" {
	const status = record(event.metadata).event_status;
	if (status === "failed" || event.is_error) return "failed";
	if (status === "interrupted" || status === "cancelled" || status === "canceled") return "interrupted";
	if (status === "completed" || status === "done") return "done";
	return "streaming";
}

function appendBlock(message: ChatMessage, kind: "text" | "reasoning", text: string, id: string, event: SessionEvent) {
	const previous = message.parts.at(-1);
	if (previous?.type === kind) {
		previous.text += text;
		if (previous.type === "reasoning") previous.status = lifecycle(event);
		return;
	}
	message.parts.push(
		kind === "text"
			? { type: kind, text, id }
			: { type: kind, text, id, status: lifecycle(event), startedAt: event.created_at },
	);
}

function appendContent(message: ChatMessage, event: SessionEvent, kind: "text" | "reasoning", eventId: string) {
	for (const [index, block] of (event.content ?? []).entries()) {
		const id = `${eventId}:content:${index}`;
		if (block.type === "text" && typeof block.text === "string") appendBlock(message, kind, block.text, id, event);
		else message.parts.push({ type: "unknown", id, label: block.type, value: structuredClone(block) });
	}
}

type ToolPart = Extract<MessagePart, { type: "tool" }>;
function findTool(message: ChatMessage, toolId: string, name: string, legacyOutput: boolean): ToolPart | undefined {
	const matching = message.parts.find((part): part is ToolPart => part.type === "tool" && part.toolId === toolId);
	if (matching || !legacyOutput) return matching;
	const candidates = message.parts.filter(
		(part): part is ToolPart => part.type === "tool" && part.name === name && part.status === "running",
	);
	return candidates.length === 1 ? candidates[0] : undefined;
}
function toolOutput(event: SessionEvent, data: Record<string, unknown>, metadata: Record<string, unknown>): unknown {
	if (data.output !== undefined) return data.output;
	if (metadata.tool_output !== undefined) return metadata.tool_output;
	return textOf(event);
}
function toolIdentity(event: SessionEvent, eventId: string) {
	const metadata = record(event.metadata),
		data = eventDataOf(event) ?? {};
	const callId = metadata.call_id ?? data.call_id;
	return { metadata, data, callId, toolId: typeof callId === "string" && callId ? callId : eventId };
}
function mergeTool(message: ChatMessage, event: SessionEvent, eventId: string) {
	const { metadata, data, callId, toolId } = toolIdentity(event, eventId);
	const outputEvent = event.type.endsWith("_output") || event.type === "tool_result";
	const name = String(metadata.tool_name ?? data.name ?? event.type);
	let part = findTool(message, toolId, name, outputEvent && !callId);
	if (!part) {
		part = {
			type: "tool",
			id: `tool:${threadIdOf(event) ?? "main"}:${toolId}`,
			toolId,
			name,
			status: "running",
			startedAt: event.created_at,
		};
		message.parts.push(part);
	}
	if (metadata.tool_name !== undefined || data.name !== undefined || !outputEvent) part.name = name;
	const input = metadata.tool_input !== undefined ? metadata.tool_input : data.arguments;
	if (input !== undefined) part.input = structuredClone(input);
	if (outputEvent) {
		part.output = structuredClone(toolOutput(event, data, metadata));
		part.status = event.is_error || data.is_error === true ? "error" : "done";
		part.endedAt = event.created_at;
	}
}
function threadCompletionStatus(event: SessionEvent): "done" | "failed" | undefined {
	const data = eventDataOf(event) ?? {};
	const status = data.status ?? data.thread_status ?? event.metadata?.status;
	if (status === "failed") return "failed";
	if (status === "idle" || status === "terminated") return "done";
	return;
}
function completionStatus(event: SessionEvent): "done" | "failed" | "interrupted" | undefined {
	if (event.type === "thread_status") return threadCompletionStatus(event);
	if (event.type !== "session_status") return;
	const status = sessionStatusOf(event),
		reason = stopReasonOf(event)?.type;
	if (status === "idle" && reason === "requires_action") return;
	if (status === "failed") return "failed";
	if (status === "idle" && (reason === "interrupted" || reason === "cancelled")) return "interrupted";
	if (isTurnEndEvent(event) || ["idle", "completed", "terminated", "deleted", "archived"].includes(status ?? ""))
		return "done";
}
function completeMessages(target: ChatMessage[], event: SessionEvent): boolean {
	const final = completionStatus(event);
	if (!final) return false;
	for (const message of target) {
		if (message.status !== "streaming") continue;
		message.status = final;
		for (const part of message.parts) if (part.type === "reasoning" && part.status === "streaming") part.status = final;
	}
	return true;
}
function userMessage(target: ChatMessage[], event: SessionEvent, identity: string): ChatMessage {
	const clientId = record(event.metadata).client_message_id;
	const message: ChatMessage = {
		id: identity,
		role: "user",
		parts: [],
		status: "done",
		threadId: threadIdOf(event),
		createdAt: event.created_at,
		...(typeof clientId === "string" ? { clientMessageId: clientId } : {}),
	};
	target.push(message);
	appendContent(message, event, "text", identity);
	return message;
}
function assistantContent(message: ChatMessage, event: SessionEvent, identity: string) {
	switch (bucketOf(event.type)) {
		case "message":
			appendContent(message, event, "text", identity);
			if (lifecycle(event) === "failed" || lifecycle(event) === "interrupted") message.status = lifecycle(event);
			break;
		case "reasoning":
			appendContent(message, event, "reasoning", identity);
			break;
		case "tool":
			mergeTool(message, event, identity);
			break;
		case "error":
			message.status = "failed";
			message.parts.push({ type: "status", id: `${identity}:error`, text: event.message ?? event.code ?? "执行出错" });
			break;
		default:
			message.parts.push({
				type: "unknown",
				id: `${identity}:unknown`,
				label: event.type,
				value: structuredClone(event.content ?? event.metadata ?? {}),
			});
	}
}
function appendArtifacts(
	message: ChatMessage,
	event: SessionEvent,
	onArtifact?: (artifact: ArtifactDescriptor) => void,
) {
	for (const artifact of artifactsOf(event)) {
		const existing = message.parts.find(
			(part): part is Extract<MessagePart, { type: "artifact" }> =>
				part.type === "artifact" && part.artifact.file_id === artifact.file_id,
		);
		if (existing) existing.artifact = { ...existing.artifact, ...artifact };
		else message.parts.push({ type: "artifact", id: `artifact:${artifact.file_id}`, artifact });
		onArtifact?.(artifact);
	}
}
/** 单次纯投影中的一步；快照更新由 ledger 重放，不能把同 ID 累计正文再次追加。 */
export function mergeEvent(
	target: ChatMessage[],
	event: SessionEvent,
	hooks: { onArtifact?: (artifact: ArtifactDescriptor) => void },
	identity = stableEventId(event),
): { turnEnded: boolean; matchedPending: string | null } {
	const bucket = bucketOf(event.type);
	if (bucket === "status") return { turnEnded: completeMessages(target, event), matchedPending: null };
	if (bucket === "approval") return { turnEnded: false, matchedPending: null };
	if (event.type === "thread_created") {
		// 主消息流的子 Agent 卡落点：分片只带 threadId，实时状态由 multiAgent 快照提供。
		const meta = record(event.metadata),
			data = eventDataOf(event) ?? {};
		const threadId = [meta.session_thread_id, data.session_thread_id, threadIdOf(event)].find(
			(value): value is string => typeof value === "string" && value.startsWith("sthr_"),
		);
		if (threadId) {
			const message = ensureAssistant(target, undefined, event.created_at, identity);
			message.parts.push({ type: "sub-agent", id: identity, threadId });
		}
		return { turnEnded: false, matchedPending: null };
	}
	if (event.type === "thread_status") {
		if (threadIdOf(event)) completeMessages(target, event);
		return { turnEnded: false, matchedPending: null };
	}
	if (event.type === "thread_message_sent" || event.type === "thread_message_received") {
		// 主↔子 Agent 的协作收发事件：派发任务书由 multiAgent 提取成卡头摘要，
		// 子 Agent 产出在其自身线程时间线展示，主流程不重复渲染。
		return { turnEnded: false, matchedPending: null };
	}
	const isUser = bucket === "message" && event.role === "user";
	const message = isUser
		? userMessage(target, event, identity)
		: ensureAssistant(target, threadIdOf(event), event.created_at, identity);
	if (!isUser) assistantContent(message, event, identity);
	appendArtifacts(message, event, hooks.onArtifact);
	return { turnEnded: false, matchedPending: isUser ? identity : null };
}

/** 默认 SessionEvent 展示规则；每次调用只处理最新快照重建中的一个事件。 */
export function transformSessionEvent({ messages, event, identity }: MessageTransformInput): MessageTransformResult {
	const artifacts: ArtifactDescriptor[] = [];
	mergeEvent(messages, event, { onArtifact: (artifact) => artifacts.push(artifact) }, identity);
	return { messages, artifacts };
}
