import { PROTOCOL_VERSION, PROTOCOL_VERSION_HEADER } from "@openagentpack/kit-sdk/protocol";
import type { ChatProvider } from "@openagentpack/kit-sdk/providers";
import { createSessionEventChatProvider } from "@openagentpack/kit-sdk/providers/session-events";
import { type BackendConfig, createBackendHttp } from "./backend-http.ts";

// The Web app uses the same public factory with its own paths and { data } mapping.
// This independent backend instead uses /sessions, { result } and application auth.
// It adopts the documented SessionEvent/control-frame wire contract.
export function createNormalizedProvider(config: BackendConfig): ChatProvider {
	const backend = createBackendHttp(config);
	return createSessionEventChatProvider({
		request: backend.request,
		...backend.operations,
		stream: {
			buildRequest({ sessionId, after }) {
				const query = new URLSearchParams();
				if (after) query.set("after", after);
				const suffix = query.size ? `?${query}` : "";
				return {
					path: `${backend.sessionPath(sessionId)}/events/stream${suffix}`,
					init: {
						headers: {
							Accept: "text/event-stream",
							[PROTOCOL_VERSION_HEADER]: PROTOCOL_VERSION,
						},
					},
				};
			},
		},
	});
}
