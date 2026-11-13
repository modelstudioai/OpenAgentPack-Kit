import { createRequest, type RequestClient } from "@openagentpack/kit-sdk/request";
import type { RawSseMessage } from "@openagentpack/kit-sdk/stream";

export function createApplicationRequest(baseUrl: string, getAppToken: () => Promise<string>): RequestClient {
	return createRequest({
		baseUrl,
		headers: async () => ({ Authorization: `Bearer ${await getAppToken()}` }),
	});
}

// Sample business routes, not fixed Bailian endpoints.
export async function readStatus(request: RequestClient, signal: AbortSignal) {
	return request.json<{ available: boolean }>("/status", { signal });
}

export async function observeUpdates(
	request: RequestClient,
	signal: AbortSignal,
	onFrame: (frame: RawSseMessage) => void,
) {
	for await (const frame of request.stream(
		"/updates",
		{ signal, headers: { Accept: "text/event-stream" } },
		{ utf8Fatal: true },
	)) {
		onFrame(frame);
	}
}
