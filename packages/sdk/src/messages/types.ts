import type { ArtifactDescriptor, AttachmentRef, SessionEvent } from "../protocol/index.ts";

export type MessagePart = (
	| { type: "text"; text: string }
	| { type: "reasoning"; text: string; status?: "streaming" | "done" | "failed" | "interrupted"; startedAt?: string }
	| {
			type: "tool";
			toolId: string;
			name: string;
			status: "running" | "done" | "error";
			input?: unknown;
			output?: unknown;
			startedAt?: string;
			endedAt?: string;
	  }
	| { type: "artifact"; artifact: ArtifactDescriptor }
	/** 随本条用户消息挂载的附件；乐观气泡与历史重建共用，provider 事件本身不携带。 */
	| { type: "attachment"; file: AttachmentRef }
	| { type: "status"; text: string }
	| { type: "sub-agent"; threadId: string }
	| { type: "unknown"; label: string; value: unknown }
) & { id?: string };

export type MessageStatus = "pending" | "streaming" | "done" | "failed" | "interrupted";
export interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	parts: MessagePart[];
	status: MessageStatus;
	threadId?: string;
	createdAt?: string;
	clientMessageId?: string;
}

/** 一次重建中的单个事件；messages 仅属于当前线程，event 是 ledger 快照的防御性拷贝。 */
export interface MessageTransformInput {
	messages: ChatMessage[];
	event: SessionEvent;
	/** Store 为事件分配的稳定身份；优先使用 Provider event_id，其次传输 cursor。 */
	identity: string;
}

export interface MessageTransformResult {
	/** 可以原地修改输入 messages，或返回替代数组。 */
	messages: ChatMessage[];
	artifacts?: ArtifactDescriptor[];
}

/** 同步展示转换；每次重建从空集合开始，转换器不得保留跨重建的累加状态。 */
export type MessageTransformer = (input: MessageTransformInput) => MessageTransformResult;
