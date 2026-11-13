import type {
	SendMessageRequest,
	SendMessageResponse,
	SessionThreadsResponse,
	ToolApprovalDecision,
	ToolApprovalsResponse,
} from "../../protocol/index.ts";
import type { RequestClient } from "../../request/index.ts";
import type { BackendOperation, BackendRequestContext, BackendRequestSpec } from "../http-operation.ts";

export interface BailianStreamResponse {
	response: Response;
	/** 必须代表真实上游订阅已建立，不能无条件用 HTTP 200 或首条业务事件代替。 */
	ready: Promise<void>;
}

export interface BailianEventsPage {
	/** 完整原始事件，按创建顺序升序；保留 id、created_at 及生命周期信息。 */
	events: Record<string, unknown>[];
	nextPageToken?: string | null;
}

export type BailianRequestContext = BackendRequestContext;
export type BailianRequestSpec = BackendRequestSpec;
export type BailianOperation<Input, Output> = BackendOperation<Input, Output>;

export interface BailianThreadQuery {
	sessionId: string;
	limit?: number;
	pageToken?: string;
}

export interface BailianThreadOperations {
	listThreads: BailianOperation<BailianThreadQuery, SessionThreadsResponse>;
	listThreadEvents: BailianOperation<BailianThreadQuery & { threadId: string }, BailianEventsPage>;
}

export interface BailianChatProviderOptions extends Partial<BailianThreadOperations> {
	request: RequestClient;
	/** mapResponse 返回 response + ready，不读取 SSE body、不先等待 ready。 */
	openStream: BailianOperation<{ sessionId: string }, BailianStreamResponse>;
	listEvents: BailianOperation<{ sessionId: string; pageToken?: string }, BailianEventsPage>;
	sendMessage: BailianOperation<{ sessionId: string; body: SendMessageRequest }, SendMessageResponse>;
	interrupt: BailianOperation<{ sessionId: string }, { interrupted: boolean }>;
	toolApprovals: BailianOperation<{ sessionId: string }, ToolApprovalsResponse>;
	submitToolApproval: BailianOperation<{ sessionId: string; decision: ToolApprovalDecision }, SendMessageResponse>;
	/** 连接就绪和历史重建总时限，默认 30 秒。 */
	connectTimeoutMs?: number;
	/** 无有效帧或注释心跳的时限，默认 45 秒。 */
	idleTimeoutMs?: number;
	maxBufferedFrames?: number;
	maxBufferedBytes?: number;
	maxHistoryEvents?: number;
}
