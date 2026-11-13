import { describe, expect, it } from "vitest";
import { encodeFrame, KitError, PROTOCOL_VERSION } from "../../protocol/index.ts";
import { createTransport } from "./transport.ts";

function sseResponse(chunks: string[], status = 200): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const c of chunks) controller.enqueue(encoder.encode(c));
			controller.close();
		},
	});
	return new Response(stream, { status, headers: { "Content-Type": "text/event-stream" } });
}

describe("transport", () => {
	it("保留动态 headers 覆盖单次参数，协议版本不能被自定义头覆盖", async () => {
		const headers: Headers[] = [];
		const transport = createTransport({
			baseUrl: "http://x.test",
			headers: () => ({ authorization: "dynamic", "x-kit-protocol-version": "wrong" }),
			fetchImpl: async (_url, init) => {
				headers.push(new Headers(init?.headers));
				return headers.length === 1
					? Response.json({})
					: sseResponse([
							encodeFrame({
								type: "done",
								data: { session_id: "s", status: "idle", last_event_id: null, reason: null },
							}),
						]);
			},
		});
		await transport.request("/json", { headers: { authorization: "once", "x-kit-protocol-version": "also-wrong" } });
		await transport.stream("/stream");
		for (const value of headers) {
			expect(value.get("authorization")).toBe("dynamic");
			expect(value.get("x-kit-protocol-version")).toBe(PROTOCOL_VERSION);
		}
		expect(headers[1]?.get("accept")).toBe("text/event-stream");
	});

	it("request 成功解析 data 包装", async () => {
		const t = createTransport({
			baseUrl: "http://x.test",
			fetchImpl: (async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })) as typeof fetch,
		});
		await expect(t.request("/api/config")).resolves.toEqual({ data: { ok: true } });
	});

	it("request 失败映射 KitError", async () => {
		const t = createTransport({
			baseUrl: "http://x.test",
			fetchImpl: (async () =>
				new Response(JSON.stringify({ error: { code: "confirmation_required", message: "no token" } }), {
					status: 428,
				})) as typeof fetch,
		});
		await expect(t.request("/x")).rejects.toMatchObject({ code: "confirmation_required", status: 428 });
	});

	it("stream：分片帧 + done 正常结束", async () => {
		const frames =
			encodeFrame({ type: "ready", data: { session_id: "s1", after: null, replayed: 0 } }) +
			encodeFrame({
				type: "event",
				data: { event_id: "e1", type: "message", content: [{ type: "text", text: "hi" }] },
			}) +
			encodeFrame({ type: "done", data: { session_id: "s1", status: "idle", last_event_id: "e1", reason: null } });
		const t = createTransport({
			baseUrl: "http://x.test",
			fetchImpl: (async () => sseResponse([frames.slice(0, 20), frames.slice(20)])) as typeof fetch,
		});
		const seen: string[] = [];
		await t.stream("/s", { onFrame: (f) => seen.push(f.type) });
		expect(seen).toEqual(["ready", "event", "done"]);
	});

	it("stream：error 帧按 retryable 抛错", async () => {
		const frames = encodeFrame({
			type: "error",
			data: { code: "provider_error", message: "upstream", retryable: true },
		});
		const t = createTransport({
			baseUrl: "http://x.test",
			fetchImpl: (async () => sseResponse([frames])) as typeof fetch,
		});
		const err = await t.stream("/s").then(
			() => null,
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(KitError);
		expect((err as KitError).retryable).toBe(true);
	});

	it("stream：非 200 直接抛 KitError", async () => {
		const t = createTransport({
			baseUrl: "http://x.test",
			fetchImpl: (async () =>
				new Response(JSON.stringify({ error: { code: "not_found", message: "gone" } }), {
					status: 404,
				})) as typeof fetch,
		});
		await expect(t.stream("/s")).rejects.toMatchObject({ code: "not_found" });
	});
});

describe("stream failure boundary", () => {
	it("自然 EOF 在没有 done 时返回可重试错误", async () => {
		const transport = createTransport({
			baseUrl: "http://x.test",
			fetchImpl: (async () =>
				sseResponse([
					encodeFrame({ type: "ready", data: { session_id: "s", after: null, replayed: 0, cursor: "e:0" } }),
				])) as typeof fetch,
		});
		await expect(transport.stream("/stream")).rejects.toMatchObject({
			code: "provider_error",
			retryable: true,
			message: "事件连接意外关闭",
		});
	});
	it("首帧前静默超时也会取消 reader，不需要 done 才退出", async () => {
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			cancel() {
				cancelled = true;
			},
		});
		const transport = createTransport({
			baseUrl: "http://x.test",
			fetchImpl: (async () => new Response(body)) as typeof fetch,
		});
		await expect(transport.stream("/stream", { idleTimeoutMs: 5 })).rejects.toMatchObject({ retryable: true });
		expect(cancelled).toBe(true);
		expect(body.locked).toBe(false);
	});
	it("abort 终止等待中的 reader 并释放锁", async () => {
		const abort = new AbortController();
		let cancel = false;
		const body = new ReadableStream<Uint8Array>({
			cancel() {
				cancel = true;
			},
		});
		const transport = createTransport({
			baseUrl: "http://x.test",
			fetchImpl: (async () => new Response(body)) as typeof fetch,
		});
		const stream = transport.stream("/stream", { signal: abort.signal });
		await new Promise((resolve) => setTimeout(resolve, 0));
		abort.abort();
		await expect(stream).rejects.toBeDefined();
		expect(cancel).toBe(true);
		expect(body.locked).toBe(false);
	});
});
