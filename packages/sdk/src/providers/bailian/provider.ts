import { createBailianSessionEventNormalizer } from "@openagentpack/sdk/session-events";
import { AbortScope } from "../../internal/abort-scope.ts";
import { transformSessionEvent } from "../../messages/merge.ts";
import { KitError } from "../../protocol/index.ts";
import type { ChatProvider } from "../contract.ts";
import type { BailianChatProviderOptions } from "./contract.ts";
import { executeOperation } from "./operation.ts";
import { streamBailianBackend } from "./stream.ts";

/** 自建后端负责 HTTP 与鉴权，SDK 负责百炼事件转换；每次 stream 独立重建，不自动重发写入。 */
export function createBailianChatProvider(options: BailianChatProviderOptions): ChatProvider {
	for (const key of [
		"connectTimeoutMs",
		"idleTimeoutMs",
		"maxBufferedFrames",
		"maxBufferedBytes",
		"maxHistoryEvents",
	] as const) {
		const value = options[key];
		if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
			throw new RangeError(`${key} must be a positive safe integer`);
	}
	return {
		...(options.listThreads
			? ({
					listThreads: async (sessionId, query = {}) => {
						const scope = new AbortScope(query.signal);
						try {
							return await executeOperation(
								options.request,
								options.listThreads!,
								{ sessionId, limit: query.limit, pageToken: query.pageToken },
								scope,
							);
						} finally {
							scope.dispose();
						}
					},
				} satisfies Pick<ChatProvider, "listThreads">)
			: {}),
		...(options.listThreadEvents
			? ({
					listThreadEvents: async (sessionId, threadId, query = {}) => {
						const scope = new AbortScope(query.signal);
						try {
							const page = await executeOperation(
								options.request,
								options.listThreadEvents!,
								{ sessionId, threadId, limit: query.limit, pageToken: query.pageToken },
								scope,
							);
							// 每页只转换完整历史快照，不共享 SSE delta 累加器，也不要求主会话状态。
							const normalizer = createBailianSessionEventNormalizer({
								redact: false,
								truncate: false,
								includeRaw: false,
							});
							const data = page.events.map((raw) => {
								scope.check();
								const event = normalizer.seed(raw);
								if (!event?.event_id) throw new KitError("provider_error", "子 Agent 历史缺少完整事件快照");
								return event;
							});
							return { data, next_page_token: page.nextPageToken ?? null };
						} finally {
							scope.dispose();
						}
					},
				} satisfies Pick<ChatProvider, "listThreadEvents">)
			: {}),
		transformMessage: transformSessionEvent,
		stream: (sessionId, handlers = {}) => streamBailianBackend(sessionId, options, handlers),
		sendMessage: (sessionId, body) => executeOperation(options.request, options.sendMessage, { sessionId, body }),
		interrupt: (sessionId) => executeOperation(options.request, options.interrupt, { sessionId }),
		toolApprovals: (sessionId) => executeOperation(options.request, options.toolApprovals, { sessionId }),
		submitToolApproval: (sessionId, decision) =>
			executeOperation(options.request, options.submitToolApproval, { sessionId, decision }),
	};
}
