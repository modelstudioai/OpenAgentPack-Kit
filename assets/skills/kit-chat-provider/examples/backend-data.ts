import { type ClientOperations, createKitClient } from "@openagentpack/kit-sdk/providers/kit";
import type { RequestClient } from "@openagentpack/kit-sdk/request";

// Configure only the features your backend supports. Missing operations never call Kit routes.
export function createDataClient(request: RequestClient) {
	const result = async <T>(response: Response): Promise<T> => (await response.json()).result;
	const json = (value: unknown) => ({
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(value),
	});
	const operations: ClientOperations = {
		agents: { buildRequest: () => ({ path: "/catalog" }), mapResponse: result },
		agent: { buildRequest: ([slug]) => ({ path: `/catalog/${encodeURIComponent(slug)}` }), mapResponse: result },
		sessionAgents: { buildRequest: () => ({ path: "/conversation-groups" }), mapResponse: result },
		sessions: {
			buildRequest: ([query]) => ({ path: "/conversations/search", init: json(query ?? {}) }),
			mapResponse: result,
		},
		session: { buildRequest: ([id]) => ({ path: `/conversations/${encodeURIComponent(id)}` }), mapResponse: result },
		createSession: { buildRequest: ([input]) => ({ path: "/conversations", init: json(input) }), mapResponse: result },
		renameSession: {
			buildRequest: ([id, title]) => ({
				path: `/conversations/${encodeURIComponent(id)}/title`,
				init: json({ title }),
			}),
			mapResponse: result,
		},
		sessionPlan: {
			buildRequest: ([id, action]) => ({
				path: `/conversations/${encodeURIComponent(id)}/preview`,
				init: json({ action }),
			}),
			mapResponse: result,
		},
		archiveSession: {
			buildRequest: ([id, confirmation]) => ({
				path: `/conversations/${encodeURIComponent(id)}/archive`,
				init: json(confirmation),
			}),
			mapResponse: result,
		},
		deleteSession: {
			buildRequest: ([id, confirmation]) => ({
				path: `/conversations/${encodeURIComponent(id)}/remove`,
				init: json(confirmation),
			}),
			mapResponse: result,
		},
		uploadFile: {
			buildRequest: ([file]) => {
				const form = new FormData();
				form.append("attachment", new Blob([file.bytes as BlobPart], { type: file.mimeType }), file.name);
				return { path: "/attachments", init: { method: "POST", body: form } };
			},
			mapResponse: result,
		},
		fileStatus: {
			buildRequest: ([id]) => ({ path: `/attachments/${encodeURIComponent(id)}/status` }),
			mapResponse: result,
		},
		downloadFile: {
			buildRequest: ([id, input]) => ({
				path: `/attachments/${encodeURIComponent(id)}/content?conversation=${encodeURIComponent(input?.sessionId ?? "")}`,
			}),
			mapResponse: (response) => response,
		},
		usageLimits: { buildRequest: () => ({ path: "/account/limits" }), mapResponse: result },
	};
	return createKitClient({ request, operations });
}
