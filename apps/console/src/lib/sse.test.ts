import { type OperationView, PROTOCOL_VERSION } from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapAdmin } from "./kit.ts";
import { streamOperation } from "./sse.ts";

const operation: OperationView = {
	operation_id: "op",
	kind: "apply",
	status: "succeeded",
	progress: 1,
	log: ["已完成"],
	created_at: "2026-10-20T00:00:00.000Z",
	updated_at: "2026-10-20T00:00:01.000Z",
};

async function initialize(response: Response) {
	vi.stubGlobal("window", { location: { origin: "https://console.example.test", search: "" } });
	vi.stubGlobal("localStorage", { getItem: () => "token", removeItem: vi.fn() });
	const fetchImpl = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(Response.json({ data: { apiBaseUrl: "", protocolVersion: PROTOCOL_VERSION } }))
		.mockResolvedValueOnce(response);
	await bootstrapAdmin(fetchImpl);
	return fetchImpl;
}

describe("Operation SSE 策略", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("仅交付 Operation，忽略会话控制帧，并在自然 EOF 正常结束与交付尾帧", async () => {
		const response = new Response(
			`event: ping\ndata: {"t":1}\n\nevent: done\ndata: {"status":"done","lastEventId":null}\n\n` +
				`event: operation\ndata: ${JSON.stringify(operation)}`,
		);
		await initialize(response);
		const onOperation = vi.fn();
		await expect(streamOperation("op", onOperation)).resolves.toBeUndefined();
		expect(onOperation).toHaveBeenCalledExactlyOnceWith(operation);
		expect(response.body?.locked).toBe(false);
	});

	it("不会引入会话订阅的 45 秒空闲超时", async () => {
		vi.useFakeTimers();
		try {
			let controller!: ReadableStreamDefaultController<Uint8Array>;
			const body = new ReadableStream<Uint8Array>({
				start(value) {
					controller = value;
				},
			});
			await initialize(new Response(body));
			const onOperation = vi.fn();
			const stream = streamOperation("op", onOperation);
			const done = vi.fn();
			void stream.then(done);
			await vi.advanceTimersByTimeAsync(60_000);
			expect(done).not.toHaveBeenCalled();
			controller.enqueue(new TextEncoder().encode(`event: operation\ndata: ${JSON.stringify(operation)}\n\n`));
			controller.close();
			await stream;
			expect(onOperation).toHaveBeenCalledExactlyOnceWith(operation);
		} finally {
			vi.useRealTimers();
		}
	});
});
