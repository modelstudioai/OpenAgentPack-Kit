import type { MessageTransformer } from "../messages/types.ts";
import type {
	EventsPage,
	SendMessageRequest,
	SendMessageResponse,
	SessionEvent,
	SessionThreadsResponse,
	ToolApprovalDecision,
	ToolApprovalsResponse,
} from "../protocol/index.ts";

export interface StreamSessionOptions {
	after?: string | null;
	signal?: AbortSignal;
	onEvent?: (event: SessionEvent, cursor?: string) => void;
	onReset?: () => void;
	onReady?: (info: { sessionId: string; replayed: number; cursor?: string | null }) => void;
	onDone?: (info: { status: string; lastEventId: string | null }) => void;
	onPing?: (t: number) => void;
}

export interface ThreadQueryOptions {
	limit?: number;
	pageToken?: string;
	signal?: AbortSignal;
}

/** 前端会话合同；一次 stream 只建立一次订阅，恢复和写入编排由 Chat 负责。 */
export interface ChatProvider {
	/** 定义事件的展示归并规则；省略时采用 Kit 默认规则，消息状态由 Chat 保存。 */
	transformMessage?: MessageTransformer;
	listThreads?(sessionId: string, options?: ThreadQueryOptions): Promise<SessionThreadsResponse>;
	/** 每页事件按创建顺序升序，游标继续查询更早一页。 */
	listThreadEvents?(sessionId: string, threadId: string, options?: ThreadQueryOptions): Promise<EventsPage>;
	stream(sessionId: string, options?: StreamSessionOptions): Promise<void>;
	sendMessage(sessionId: string, body: SendMessageRequest): Promise<SendMessageResponse>;
	interrupt(sessionId: string): Promise<{ interrupted: boolean }>;
	toolApprovals(sessionId: string): Promise<ToolApprovalsResponse>;
	submitToolApproval(sessionId: string, decision: ToolApprovalDecision): Promise<SendMessageResponse>;
}
