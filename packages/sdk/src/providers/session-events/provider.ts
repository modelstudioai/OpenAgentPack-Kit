import { AbortScope } from "../../internal/abort-scope.ts";
import { transformSessionEvent } from "../../messages/merge.ts";
import type { MessageTransformer } from "../../messages/types.ts";
import type {
	EventsPage,
	SendMessageRequest,
	SendMessageResponse,
	SessionThreadsResponse,
	ToolApprovalDecision,
	ToolApprovalsResponse,
} from "../../protocol/index.ts";
import { KitError } from "../../protocol/index.ts";
import type { RequestClient } from "../../request/index.ts";
import type { ChatProvider, ThreadQueryOptions } from "../contract.ts";
import {
	type BackendOperation,
	type BackendRequestContext,
	type BackendRequestSpec,
	executeOperation,
} from "../http-operation.ts";
import { streamKitFrames } from "../kit/stream.ts";

export interface SessionEventStreamOperation {
	buildRequest(
		input: { sessionId: string; after?: string | null },
		context: BackendRequestContext,
	): BackendRequestSpec | Promise<BackendRequestSpec>;
}

export interface SessionEventChatProviderOptions {
	request: RequestClient;
	/** 标准 SessionEvent 与 reset/ready/event/ping/done/error 控制帧。 */
	stream: SessionEventStreamOperation;
	sendMessage: BackendOperation<{ sessionId: string; body: SendMessageRequest }, SendMessageResponse>;
	interrupt: BackendOperation<{ sessionId: string }, { interrupted: boolean }>;
	toolApprovals: BackendOperation<{ sessionId: string }, ToolApprovalsResponse>;
	submitToolApproval: BackendOperation<{ sessionId: string; decision: ToolApprovalDecision }, SendMessageResponse>;
	listThreads?: BackendOperation<{ sessionId: string } & ThreadQueryOptions, SessionThreadsResponse>;
	listThreadEvents?: BackendOperation<{ sessionId: string; threadId: string } & ThreadQueryOptions, EventsPage>;
	transformMessage?: MessageTransformer;
	connectTimeoutMs?: number;
	idleTimeoutMs?: number;
}

/** 已转换事件的后端接入；路径、鉴权、请求和 JSON 包装均由调用方配置。 */
export function createSessionEventChatProvider(options: SessionEventChatProviderOptions): ChatProvider {
	for (const key of ["connectTimeoutMs", "idleTimeoutMs"] as const) {
		const value = options[key];
		if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
			throw new RangeError(`${key} must be a positive safe integer`);
	}
	return {
		transformMessage: options.transformMessage ?? transformSessionEvent,
		...(options.listThreads
			? {
					async listThreads(sessionId: string, query: ThreadQueryOptions = {}) {
						const scope = new AbortScope(query.signal);
						try {
							return await executeOperation(options.request, options.listThreads!, { sessionId, ...query }, scope);
						} finally {
							scope.dispose();
						}
					},
				}
			: {}),
		...(options.listThreadEvents
			? {
					async listThreadEvents(sessionId: string, threadId: string, query: ThreadQueryOptions = {}) {
						const scope = new AbortScope(query.signal);
						try {
							return await executeOperation(
								options.request,
								options.listThreadEvents!,
								{ sessionId, threadId, ...query },
								scope,
							);
						} finally {
							scope.dispose();
						}
					},
				}
			: {}),
		async stream(sessionId, handlers = {}) {
			const scope = new AbortScope(handlers.signal);
			const deadline = setTimeout(
				() => scope.fail(new KitError("provider_error", "等待后端会话就绪超时", { retryable: true })),
				options.connectTimeoutMs ?? 30_000,
			);
			try {
				const spec = await scope.wait(
					Promise.resolve().then(() => {
						scope.check();
						return options.stream.buildRequest({ sessionId, after: handlers.after }, { signal: scope.signal });
					}),
				);
				scope.check();
				await streamKitFrames(options.request, spec.path, {
					signal: scope.signal,
					init: spec.init,
					idleTimeoutMs: options.idleTimeoutMs,
					onFrame(frame) {
						scope.check();
						switch (frame.type) {
							case "reset":
								handlers.onReset?.();
								break;
							case "event":
								handlers.onEvent?.(frame.data, frame.cursor);
								break;
							case "ready":
								if (frame.data.session_id !== sessionId)
									throw new KitError("provider_error", "后端返回了其他会话的就绪信号");
								clearTimeout(deadline);
								handlers.onReady?.({
									sessionId,
									replayed: frame.data.replayed,
									cursor: frame.data.cursor,
								});
								break;
							case "ping":
								handlers.onPing?.(frame.data.t);
								break;
							case "done":
								handlers.onDone?.({ status: frame.data.status, lastEventId: frame.data.last_event_id });
								break;
						}
					},
				});
			} catch (error) {
				scope.check();
				if (error instanceof KitError) throw error;
				throw new KitError("provider_error", "后端会话连接失败", { retryable: true });
			} finally {
				clearTimeout(deadline);
				scope.dispose();
			}
		},
		sendMessage: (sessionId, body) => executeOperation(options.request, options.sendMessage, { sessionId, body }),
		interrupt: (sessionId) => executeOperation(options.request, options.interrupt, { sessionId }),
		toolApprovals: (sessionId) => executeOperation(options.request, options.toolApprovals, { sessionId }),
		submitToolApproval: (sessionId, decision) =>
			executeOperation(options.request, options.submitToolApproval, { sessionId, decision }),
	};
}
