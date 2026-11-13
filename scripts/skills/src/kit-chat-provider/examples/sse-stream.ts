import { createSseStream, type RawSseMessage } from "@openagentpack/kit-sdk/stream";

// The caller already owns a response body; no network request is made here.
export async function consumeSse(
	body: ReadableStream<Uint8Array>,
	signal: AbortSignal,
	onFrame: (frame: RawSseMessage) => void,
) {
	for await (const frame of createSseStream(body, { signal, utf8Fatal: true, maxFrameChars: 1024 * 1024 })) {
		// data remains a string. The Provider validates JSON and business semantics.
		onFrame(frame);
	}
	// EOF ends this iterator; it does not establish Agent execution completion.
}
