import type { SessionEvent } from "@openagentpack/sdk/session-events";

/**
 * 事件契约直接复用上游 SDK 的 `SessionEvent`（type-only）。
 * 本文件只提供「展示分桶」与派生读取，不复制字段定义、不重造模型。
 * 见 AGENTS.md 不变量 1 与 docs/adr/0001。
 */
export type { SessionEvent };

/** UI 展示分桶：把开放的事件类型集合收敛到有限的渲染分支。 */
export type EventBucket =
	| "message"
	| "reasoning"
	| "tool"
	| "approval"
	| "status"
	| "thread"
	| "artifact"
	| "error"
	| "other";

const TOOL_TYPES = new Set([
	"tool_call",
	"function_call",
	"mcp_call",
	"tool_confirmation",
	"tool_call_output",
	"function_call_output",
	"mcp_call_output",
]);
const THREAD_TYPES = new Set([
	"thread_message_sent",
	"thread_message_received",
	"thread_status",
	"thread_created",
	"thread_context_compacted",
]);
const STATUS_TYPES = new Set([
	"session_status",
	"session_updated",
	"model_request_start",
	"model_request_end",
	"define_outcome",
	"outcome_evaluation",
	"interrupt",
]);

export function bucketOf(type: string): EventBucket {
	if (type === "message") return "message";
	if (type === "reasoning") return "reasoning";
	if (type === "error") return "error";
	if (type === "tool_approval_request" || type === "tool_approval_response") return "approval";
	if (TOOL_TYPES.has(type)) return "tool";
	if (THREAD_TYPES.has(type)) return "thread";
	if (STATUS_TYPES.has(type)) return "status";
	return "other";
}

/** SDK 派生的交付文件；优先使用 metadata.artifacts 数组。 */
export interface ArtifactDescriptor {
	file_id: string;
	filename?: string;
	content_type?: string;
	size?: number;
}

function metadataOf(event: SessionEvent): Record<string, unknown> {
	return (event.metadata ?? {}) as Record<string, unknown>;
}

/** 事件所属子线程。thread_id 优先；会话状态不属于任何子线程，引用目标不改变归属。 */
export function threadIdOf(event: SessionEvent): string | undefined {
	if (event.type === "session_status") return undefined;
	const meta = metadataOf(event);
	const v = meta.thread_id ?? meta.session_thread_id;
	return typeof v === "string" && v.startsWith("sthr_") ? v : undefined;
}

/** 事件携带的交付文件（Artifact），无则 undefined。 */
export function artifactOf(event: SessionEvent): ArtifactDescriptor | undefined {
	return artifactsOf(event)[0];
}

export function artifactsOf(event: SessionEvent): ArtifactDescriptor[] {
	const meta = metadataOf(event);
	const values = Array.isArray(meta.artifacts) ? meta.artifacts : [meta.artifact];
	const result = new Map<string, ArtifactDescriptor>();
	for (const value of values) {
		const artifact = readArtifact(value);
		if (artifact) result.set(artifact.file_id, artifact);
	}
	return [...result.values()];
}

function readArtifact(v: unknown): ArtifactDescriptor | undefined {
	if (!v || typeof v !== "object") return undefined;
	const a = v as Record<string, unknown>;
	if (typeof a.file_id !== "string") return undefined;
	return {
		file_id: a.file_id,
		filename: typeof a.filename === "string" ? a.filename : undefined,
		content_type: typeof a.content_type === "string" ? a.content_type : undefined,
		size: typeof a.size === "number" ? a.size : undefined,
	};
}

export function eventDataOf(event: SessionEvent): Record<string, unknown> | undefined {
	for (const block of event.content ?? []) {
		if (block.type === "data" && block.data && typeof block.data === "object" && !Array.isArray(block.data))
			return block.data as Record<string, unknown>;
	}
	return undefined;
}

export function sessionStatusOf(event: SessionEvent): string | undefined {
	if (event.type !== "session_status") return undefined;
	const value = eventDataOf(event)?.session_status ?? metadataOf(event).status;
	return typeof value === "string" ? value : undefined;
}

export function stopReasonOf(event: SessionEvent): Record<string, unknown> | undefined {
	const data = eventDataOf(event);
	const value = data && Object.hasOwn(data, "stop_reason") ? data.stop_reason : metadataOf(event).stop_reason;
	if (typeof value === "string") return { type: value };
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Turn 结束：`session_status` 且状态回到 idle。见 docs/protocol.md。 */
export const TURN_END_STATUS = "idle";

export function isTurnEndEvent(event: SessionEvent): boolean {
	if (event.type !== "session_status") return false;
	return (
		!threadIdOf(event) && sessionStatusOf(event) === TURN_END_STATUS && stopReasonOf(event)?.type !== "requires_action"
	);
}

/**
 * 与 SDK `isTerminalSessionStatus` 同语义：会话当前**没有进行中的运行**
 * （turn 已收敛或会话已结束），用于决定是否继续泵流。集合与上游保持一致。
 */
const TERMINAL_SESSION_STATUSES = new Set(["idle", "completed", "failed", "terminated", "deleted"]);

export function isTerminalSessionStatus(status: string | undefined | null): boolean {
	return typeof status === "string" && TERMINAL_SESSION_STATUSES.has(status);
}

/** 会话已被移除（删除/归档），不可再发消息；用于 404/不可用判定。 */
const REMOVED_SESSION_STATUSES = new Set(["terminated", "deleted", "archived"]);

export function isSessionRemovedStatus(status: string | undefined | null): boolean {
	return typeof status === "string" && REMOVED_SESSION_STATUSES.has(status);
}

/** 事件稳定 id：优先 provider 的 event_id，否则本地合成（仅用于去重，不回传服务端）。 */
export function stableEventId(event: SessionEvent): string {
	if (event.event_id && event.event_id.length > 0) return event.event_id;
	const hash = simpleHash(JSON.stringify(event));
	return `synthetic:${event.type}:${hash}`;
}

export function simpleHash(input: string): string {
	// FNV-1a 32-bit：足够稳定且无依赖；不用于安全用途。
	let h = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36);
}
