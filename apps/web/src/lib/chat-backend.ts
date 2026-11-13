import {
	type EventsPage,
	KitError,
	PROTOCOL_VERSION,
	PROTOCOL_VERSION_HEADER,
	SendMessageResponseSchema,
	SessionThreadsResponseSchema,
	ToolApprovalsResponseSchema,
} from "@openagentpack/kit-sdk/protocol";
import {
	createSessionEventChatProvider,
	type SessionEventChatProviderOptions,
} from "@openagentpack/kit-sdk/providers/session-events";
import type { RequestClient } from "@openagentpack/kit-sdk/request";

/** 示例后端配置：用户接自己的后端时，替换路径、请求参数与 mapResponse。 */
export function createExampleChatProvider(request: RequestClient) {
	const headers = { [PROTOCOL_VERSION_HEADER]: PROTOCOL_VERSION };
	const json = { ...headers, "Content-Type": "application/json" };
	const sessionPath = (id: string) => `/api/kit/sessions/${encodeURIComponent(id)}`;
	const queries = (input: { limit?: number; pageToken?: string }) => {
		const query = new URLSearchParams();
		if (input.limit !== undefined) query.set("limit", String(input.limit));
		if (input.pageToken) query.set("page_token", input.pageToken);
		return query.size ? `?${query}` : "";
	};
	const operations: SessionEventChatProviderOptions = {
		request,
		stream: {
			buildRequest({ sessionId, after }) {
				const query = new URLSearchParams();
				if (after) query.set("after", after);
				return {
					path: `${sessionPath(sessionId)}/stream${query.size ? `?${query}` : ""}`,
					init: { headers: { ...headers, Accept: "text/event-stream" } },
				};
			},
		},
		sendMessage: {
			buildRequest: ({ sessionId, body }) => ({
				path: `${sessionPath(sessionId)}/messages`,
				init: { method: "POST", headers: json, body: JSON.stringify(body) },
			}),
			mapResponse: async (response) => SendMessageResponseSchema.parse((await response.json()).data),
		},
		interrupt: {
			buildRequest: ({ sessionId }) => ({
				path: `${sessionPath(sessionId)}/interrupt`,
				init: { method: "POST", headers },
			}),
			mapResponse: async (response) => {
				const result = (await response.json()).data as { interrupted: boolean };
				if (typeof result?.interrupted !== "boolean") throw new KitError("provider_error", "后端中断响应格式无效");
				return { interrupted: result.interrupted };
			},
		},
		toolApprovals: {
			buildRequest: ({ sessionId }) => ({
				path: `${sessionPath(sessionId)}/tool-approvals`,
				init: { headers },
			}),
			mapResponse: async (response) => ToolApprovalsResponseSchema.parse((await response.json()).data),
		},
		submitToolApproval: {
			buildRequest: ({ sessionId, decision }) => ({
				path: `${sessionPath(sessionId)}/tool-approvals`,
				init: { method: "POST", headers: json, body: JSON.stringify(decision) },
			}),
			mapResponse: async (response) => SendMessageResponseSchema.parse((await response.json()).data),
		},
		listThreads: {
			buildRequest: ({ sessionId, ...query }) => ({
				path: `${sessionPath(sessionId)}/threads${queries(query)}`,
				init: { headers },
			}),
			mapResponse: async (response) => SessionThreadsResponseSchema.parse(await response.json()),
		},
		listThreadEvents: {
			buildRequest: ({ sessionId, threadId, ...query }) => ({
				path: `${sessionPath(sessionId)}/threads/${encodeURIComponent(threadId)}/events${queries(query)}`,
				init: { headers },
			}),
			mapResponse: async (response) => {
				const page = (await response.json()) as EventsPage;
				if (!Array.isArray(page?.data) || (page.next_page_token != null && typeof page.next_page_token !== "string"))
					throw new KitError("provider_error", "后端线程历史格式无效");
				return { ...page, data: [...page.data].reverse() };
			},
		},
	};
	return createSessionEventChatProvider(operations);
}
