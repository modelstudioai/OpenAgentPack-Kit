import { describe, expect, it, vi } from "vitest";
import { createSseStream, SseStreamError, type SseStreamOptions } from "./index.ts";

const encoder = new TextEncoder();
function bodyOf(chunks: Uint8Array[], close = true) {
	const cancel = vi.fn();
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			if (close) controller.close();
		},
		cancel,
	});
	return { body, cancel };
}
async function collect(body: ReadableStream<Uint8Array>, options: SseStreamOptions = {}) {
	const frames = [];
	for await (const frame of createSseStream(body, options)) frames.push(frame);
	return frames;
}

describe("standalone SSE stream", () => {
	it("跨字节 UTF-8 与 CRLF 分片，保留未知事件和未解析的 data", async () => {
		const bytes = encoder.encode(
			": keepalive\r\nid: c1\r\nevent: custom\r\ndata: 你好\r\ndata: not-json\r\n\r\ndata: [DONE]\n\n",
		);
		const { body } = bodyOf(Array.from(bytes, (byte) => new Uint8Array([byte])));
		const onComment = vi.fn();
		await expect(collect(body, { onComment })).resolves.toEqual([
			{ id: "c1", event: "custom", data: "你好\nnot-json" },
			{ event: "message", data: "[DONE]" },
		]);
		expect(onComment).toHaveBeenCalledOnce();
		expect(body.locked).toBe(false);
	});

	it.each([true, false])("自然 EOF 的尾帧交付由 flushOnEnd=%s 控制", async (flushOnEnd) => {
		const { body } = bodyOf([encoder.encode("data: complete\n\ndata: tail")]);
		await expect(collect(body, { flushOnEnd })).resolves.toEqual([
			{ event: "message", data: "complete" },
			...(flushOnEnd ? [{ event: "message", data: "tail" }] : []),
		]);
	});

	it("默认替换非法 UTF-8；严格模式以解析错误退出且关闭 reader", async () => {
		const bytes = new Uint8Array([...encoder.encode("data: "), 0xff, 10, 10]);
		await expect(collect(bodyOf([bytes]).body)).resolves.toEqual([{ event: "message", data: "�" }]);
		const { body, cancel } = bodyOf([bytes], false);
		await expect(collect(body, { utf8Fatal: true })).rejects.toBeInstanceOf(SseStreamError);
		expect(cancel).toHaveBeenCalledOnce();
		expect(body.locked).toBe(false);
	});

	it("帧超限前的完整帧仍交付，随后报告解析错误并关闭连接", async () => {
		const { body, cancel } = bodyOf([encoder.encode("data: ok\n\ndata: oversized")], false);
		const stream = createSseStream(body, { maxFrameChars: 10 });
		await expect(stream.next()).resolves.toMatchObject({ value: { data: "ok" } });
		await expect(stream.next()).rejects.toBeInstanceOf(SseStreamError);
		expect(cancel).toHaveBeenCalledOnce();
		expect(body.locked).toBe(false);
	});

	it("reader 的网络错误原样保留，不伪装成解码错误", async () => {
		const failure = new TypeError("network disconnected");
		const body = new ReadableStream<Uint8Array>({
			pull: () => {
				throw failure;
			},
		});
		await expect(collect(body)).rejects.toBe(failure);
		expect(body.locked).toBe(false);
	});

	it.each(["break", "throw"] as const)("消费方 %s 时取消底层并释放锁", async (exit) => {
		const { body, cancel } = bodyOf([encoder.encode("data: first\n\ndata: second\n\n")], false);
		const failure = new Error("consumer failed");
		const consume = async () => {
			for await (const _frame of createSseStream(body)) {
				if (exit === "throw") throw failure;
				break;
			}
		};
		if (exit === "throw") await expect(consume()).rejects.toBe(failure);
		else await consume();
		expect(cancel).toHaveBeenCalledOnce();
		expect(body.locked).toBe(false);
	});

	it("取消阻塞中的 read，取消后也不交付已解析的下一帧", async () => {
		for (const chunks of [[], [encoder.encode("data: first\n\ndata: second\n\n")]]) {
			const { body, cancel } = bodyOf(chunks, false);
			const abort = new AbortController();
			const stream = createSseStream(body, { signal: abort.signal });
			if (chunks.length) await expect(stream.next()).resolves.toMatchObject({ value: { data: "first" } });
			if (chunks.length) abort.abort();
			const next = stream.next();
			if (!chunks.length) abort.abort();
			await expect(next).rejects.toMatchObject({ name: "AbortError" });
			expect(cancel).toHaveBeenCalledOnce();
			expect(body.locked).toBe(false);
		}
	});

	it("消费方暂停在 yield 时取消，也立即释放底层 reader", async () => {
		const { body, cancel } = bodyOf([encoder.encode("data: first\n\n")], false);
		const abort = new AbortController();
		const stream = createSseStream(body, { signal: abort.signal });
		await stream.next();
		abort.abort();
		await vi.waitFor(() => expect(body.locked).toBe(false));
		expect(cancel).toHaveBeenCalledOnce();
		await expect(stream.next()).rejects.toMatchObject({ name: "AbortError" });
	});
});
