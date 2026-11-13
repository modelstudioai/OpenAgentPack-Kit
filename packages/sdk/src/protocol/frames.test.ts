import { describe, expect, it } from "vitest";
import { createSseParser, decodeFrame, encodeFrame, encodeRaw, type RawSseMessage, type SseFrame } from "./frames.ts";

function collect(chunks: string[]): RawSseMessage[] {
	const out: RawSseMessage[] = [];
	const parser = createSseParser((m) => out.push(m));
	for (const c of chunks) parser.push(c);
	parser.end();
	return out;
}

describe("SSE 帧编解码", () => {
	it("同一业务ID的多个更新保留独立传输游标，CR/LF混合分块不丢帧", () => {
		const data = { event_id: "message-1", type: "message", content: [] };
		const wire =
			encodeFrame({ type: "reset", data: { session_id: "s1" } }) +
			encodeFrame({ type: "event", data, cursor: "epoch:1" }) +
			encodeFrame({ type: "event", data, cursor: "epoch:2" });
		const frames = collect(wire.replace(/\n/g, "\r\n").split("")).map(decodeFrame);
		expect(frames).toEqual([
			{ type: "reset", data: { session_id: "s1" } },
			{ type: "event", data, cursor: "epoch:1" },
			{ type: "event", data, cursor: "epoch:2" },
		]);
		expect(collect('event: ping\rdata: {"t":3}\r\r'.split("")).map(decodeFrame)).toEqual([
			{ type: "ping", data: { t: 3 } },
		]);
	});

	it("单帧往返", () => {
		const frame: SseFrame = { type: "ping", data: { t: 42 } };
		const messages = collect([encodeFrame(frame)]);
		expect(messages).toHaveLength(1);
		expect(decodeFrame(messages[0]!)).toEqual(frame);
	});

	it("粘包：一帧分两片到达", () => {
		const raw = encodeFrame({ type: "ping", data: { t: 1 } }) + encodeFrame({ type: "ping", data: { t: 2 } });
		const messages = collect([raw.slice(0, 9), raw.slice(9)]);
		expect(messages).toHaveLength(2);
	});

	it("分片：帧被切成多片", () => {
		const raw = encodeFrame({
			type: "event",
			data: { type: "message", content: [{ type: "text", text: "hello" }] } as never,
		});
		const messages = collect([raw.slice(0, 5), raw.slice(5, 12), raw.slice(12)]);
		expect(messages).toHaveLength(1);
		const decoded = decodeFrame(messages[0]!);
		expect(decoded?.type).toBe("event");
	});

	it("CRLF 与注释行", () => {
		const messages = collect([': keep-alive\r\nevent: ping\r\ndata: {"t":7}\r\n\r\n']);
		expect(messages).toHaveLength(1);
		expect(decodeFrame(messages[0]!)).toEqual({ type: "ping", data: { t: 7 } });
	});

	it("多行 data 合并", () => {
		const messages = collect([encodeRaw({ event: "event", data: '{"type":"message",\n"content":[]}' })]);
		expect(messages[0]!.data).toBe('{"type":"message",\n"content":[]}');
		expect(decodeFrame(messages[0]!)?.type).toBe("event");
	});

	it("未知 event 不静默丢弃：parser 原样吐出，decode 返回 null", () => {
		const messages = collect([encodeRaw({ event: "future_thing", data: "{}" })]);
		expect(messages).toHaveLength(1);
		expect(decodeFrame(messages[0]!)).toBeNull();
	});

	it("尾帧无空行收尾时 end() 补派发", () => {
		const out: RawSseMessage[] = [];
		const parser = createSseParser((m) => out.push(m));
		parser.push('event: ping\ndata: {"t":9}');
		expect(out).toHaveLength(0);
		parser.end();
		expect(out).toHaveLength(1);
		expect(decodeFrame(out[0]!)).toEqual({ type: "ping", data: { t: 9 } });
	});
});
