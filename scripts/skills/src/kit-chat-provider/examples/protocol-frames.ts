import type { SseFrame } from "@openagentpack/kit-sdk/protocol";
import { streamProtocolFrames } from "@openagentpack/kit-sdk/providers/kit";
import type { RequestClient } from "@openagentpack/kit-sdk/request";

/** The request already owns the backend base URL and any required identity/version headers. */
export async function observeProtocolFrames(
	request: RequestClient,
	path: string,
	signal: AbortSignal,
	onFrame: (frame: SseFrame) => void,
) {
	await streamProtocolFrames(request, path, {
		signal,
		onFrame,
		init: { method: "GET" },
		idleTimeoutMs: 45_000,
	});
	// done ended this subscription. It does not establish Agent execution completion.
	// Unexpected EOF, protocol error frames, and idle timeouts reject instead.
}
