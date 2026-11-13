import { PROTOCOL_VERSION, PROTOCOL_VERSION_HEADER } from "@openagentpack/kit-sdk/protocol";
import { type ClientOperations, createKitClient } from "@openagentpack/kit-sdk/providers/kit";
import type { RequestClient } from "@openagentpack/kit-sdk/request";

/** Demo configuration only. An external frontend replaces these paths and response mappings for its own backend. */
export function createExampleClient(request: RequestClient) {
	const headers = { [PROTOCOL_VERSION_HEADER]: PROTOCOL_VERSION };
	const json = { ...headers, "Content-Type": "application/json" };
	const session = (id: string) => `/api/kit/sessions/${encodeURIComponent(id)}`;
	const query = (values: Record<string, string | number | boolean | undefined>) => {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(values))
			if (value !== undefined && value !== "") params.set(key, String(value));
		return params.size ? `?${params}` : "";
	};
	const body = (method: string, value?: unknown) => ({
		method,
		headers: json,
		...(value === undefined ? {} : { body: JSON.stringify(value) }),
	});
	const data = async <T>(response: Response): Promise<T> => (await response.json()).data as T;
	const operations: ClientOperations = {
		"auth.login": {
			buildRequest: ([input]) => ({ path: "/api/kit/auth/login", init: body("POST", input) }),
			mapResponse: data,
		},
		"auth.me": { buildRequest: () => ({ path: "/api/kit/auth/me", init: { headers } }), mapResponse: data },
		"auth.logout": {
			buildRequest: () => ({ path: "/api/kit/auth/logout", init: body("POST") }),
			mapResponse: () => undefined,
		},
		config: { buildRequest: () => ({ path: "/api/config", init: { headers } }), mapResponse: data },
		agents: { buildRequest: () => ({ path: "/api/kit/agents", init: { headers } }), mapResponse: data },
		agent: {
			buildRequest: ([slug]) => ({ path: `/api/kit/agents/${encodeURIComponent(slug)}`, init: { headers } }),
			mapResponse: data,
		},
		plaza: {
			buildRequest: ([input = {}]) => ({ path: `/api/kit/plaza${query(input)}`, init: { headers } }),
			mapResponse: data,
		},
		usageLimits: {
			buildRequest: ([input = {}]) => ({ path: `/api/kit/usage-limits${query(input)}`, init: { headers } }),
			mapResponse: data,
		},
		quota: {
			buildRequest: ([input = {}]) => ({ path: `/api/kit/quota${query(input)}`, init: { headers } }),
			mapResponse: data,
		},
		quotaRequests: { buildRequest: () => ({ path: "/api/kit/quota/requests", init: { headers } }), mapResponse: data },
		createQuotaRequest: {
			buildRequest: ([input]) => ({
				path: "/api/kit/quota/requests",
				init: body("POST", { requested_credits: input.requestedCredits, reason: input.reason }),
			}),
			mapResponse: data,
		},
		sessionAgents: { buildRequest: () => ({ path: "/api/kit/session-agents", init: { headers } }), mapResponse: data },
		sessions: {
			buildRequest: ([input = {}]) => ({
				path: `/api/kit/sessions${query({ agent_slug: input.agentSlug, limit: input.limit, page_token: input.pageToken, include_archived: input.includeArchived, q: input.q })}`,
				init: { headers },
			}),
			mapResponse: async (response) => {
				const value = await response.json();
				return { sessions: value.data, nextPageToken: value.next_page_token };
			},
		},
		session: { buildRequest: ([id]) => ({ path: session(id), init: { headers } }), mapResponse: data },
		createSession: {
			buildRequest: ([input]) => ({
				path: "/api/kit/sessions",
				init: body("POST", { agent_slug: input.agentSlug, title: input.title, files: input.files }),
			}),
			mapResponse: data,
		},
		renameSession: {
			buildRequest: ([id, title]) => ({ path: session(id), init: body("PATCH", { title }) }),
			mapResponse: data,
		},
		sessionPlan: {
			buildRequest: ([id, action]) => ({ path: `${session(id)}/plan`, init: body("POST", { action }) }),
			mapResponse: data,
		},
		archiveSession: {
			buildRequest: ([id, confirmation]) => ({ path: `${session(id)}/archive`, init: body("POST", confirmation) }),
			mapResponse: data,
		},
		deleteSession: {
			buildRequest: ([id, confirmation]) => ({ path: session(id), init: body("DELETE", confirmation) }),
			mapResponse: data,
		},
		uploadFile: {
			buildRequest: ([file]) => {
				const form = new FormData();
				form.append("file", new Blob([file.bytes as BlobPart], { type: file.mimeType }), file.name);
				return { path: "/api/kit/files", init: { method: "POST", headers, body: form } };
			},
			mapResponse: data,
		},
		fileStatus: {
			buildRequest: ([id]) => ({ path: `/api/kit/files/${encodeURIComponent(id)}`, init: { headers } }),
			mapResponse: data,
		},
		downloadFile: {
			buildRequest: ([id, input = {}]) => ({
				path: `/api/kit/files/${encodeURIComponent(id)}/download${query({ session_id: input.sessionId })}`,
				init: { headers },
			}),
			mapResponse: (response) => response,
		},
	};
	return createKitClient({ request, operations });
}
