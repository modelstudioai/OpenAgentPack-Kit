import { KitError } from "@openagentpack/kit-sdk/protocol";
import { createBailianChatProvider } from "@openagentpack/kit-sdk/providers/bailian";
import { type BackendConfig, createBackendHttp, readJson, record } from "./backend-http.ts";

export function createRawBailianProvider(config: BackendConfig) {
	const backend = createBackendHttp(config);
	return createBailianChatProvider({
		request: backend.request,
		...backend.operations,
		openStream: {
			buildRequest: ({ sessionId }) => ({
				path: `${backend.sessionPath(sessionId)}/stream`,
				init: { headers: { Accept: "text/event-stream" } },
			}),
			mapResponse(response) {
				// Backend contract: subscribe upstream FIRST, then flush this header.
				// Cross-origin backends must expose it through Access-Control-Expose-Headers.
				if (response.headers.get("x-upstream-ready") !== "true")
					throw new KitError("conflict", "The backend did not confirm upstream subscription readiness.");
				// Do not consume body or await a separate readiness promise here.
				return { response, ready: Promise.resolve() };
			},
		},
		listEvents: {
			buildRequest({ sessionId, pageToken }) {
				const query = new URLSearchParams({ order: "asc" });
				if (pageToken) query.set("page_token", pageToken);
				return { path: `${backend.sessionPath(sessionId)}/events?${query}` };
			},
			async mapResponse(response) {
				const page = record(await readJson(response));
				if (!Array.isArray(page.data))
					throw new KitError("provider_error", "The backend returned an invalid history page.");
				const next = page.next_page_token;
				if (next !== undefined && next !== null && typeof next !== "string")
					throw new KitError("provider_error", "The backend returned an invalid history cursor.");
				return {
					// Keep complete raw objects, including identity and execution state.
					events: page.data.map(record),
					nextPageToken: next,
				};
			},
		},
	});
}
