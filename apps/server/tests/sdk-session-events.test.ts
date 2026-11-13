import { readFileSync } from "node:fs";
import { createSessionStore } from "@openagentpack/kit-sdk/chat";
import type { SessionEvent } from "@openagentpack/kit-sdk/protocol";
import { setDefaultFetch } from "@openagentpack/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { createSdkGateway } from "../src/gateway/sdk.ts";

const secret = "sk-unit-test-credential";
const gateway = () => createSdkGateway({ apiKey: secret, baseUrl: "https://provider.example.test/api/v1/agentstudio" });
afterEach(() => setDefaultFetch(fetch));

describe("真实 SDK 的 HTTP/SSE 契约", () => {
	it("录制的混合流帧经 SDK 与 Gateway 持续输出正文并以会话 idle 收敛", async () => {
		const frames = JSON.parse(
			readFileSync(new URL("./fixtures/bailian-sse-event-envelope.json", import.meta.url), "utf8"),
		) as Record<string, unknown>[];
		let cancelled = false;
		setDefaultFetch(
			async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							for (const frame of frames)
								controller.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(frame)}\n\n`));
						},
						cancel() {
							cancelled = true;
						},
					}),
					{ headers: { "content-type": "text/event-stream" } },
				),
		);
		const abort = new AbortController();
		const store = createSessionStore("session");
		const events: SessionEvent[] = [];
		try {
			for await (const event of gateway().streamEvents("session", { signal: abort.signal })) {
				events.push(event);
				store.applyEvent(event);
				if (event.type === "session_status" && event.metadata?.status === "idle") break;
			}
		} finally {
			abort.abort();
		}
		expect(
			events.some(
				(event) =>
					event.type === "message" &&
					event.metadata?.event_status === "in_progress" &&
					event.content?.[0]?.text === "[redacted:6]",
			),
		).toBe(true);
		expect(
			events.some(
				(event) =>
					event.type === "reasoning" && event.metadata?.event_status === "in_progress" && event.content?.[0]?.text,
			),
		).toBe(true);
		expect(events.some((event) => ["event_start", "event_delta"].includes(event.type))).toBe(false);
		expect(events.every((event) => event.metadata?.raw === undefined)).toBe(true);
		expect(store.getSnapshot()).toMatchObject({
			phase: "idle",
			messages: [
				{ role: "user", status: "done" },
				{
					role: "assistant",
					status: "done",
					parts: [
						{ type: "reasoning", text: "[redacted:138]" },
						{ type: "text", text: "[redacted:6]" },
					],
				},
			],
		});
		expect(cancelled).toBe(true);
	});

	it("历史快照完整保留结构与长正文、透传分页，剔除实际凭据与 raw", async () => {
		const calls: URL[] = [];
		const text = `${"完整正文".repeat(1500)} demo_api_key=visible ${secret}`;
		setDefaultFetch(async (input) => {
			calls.push(new URL(String(input)));
			return Response.json({
				data: [
					{
						object: "message",
						id: "evt-long",
						type: "message",
						role: "assistant",
						status: "completed",
						content: [
							{ type: "text", text },
							{ type: "custom", data: { nested: [1, 2] } },
						],
					},
				],
				has_more: true,
				next_page: "opaque-next",
			});
		});
		const result = await gateway().listEvents("session", { pageToken: "opaque-current", limit: 100 });
		expect(calls[0]?.searchParams.get("page")).toBe("opaque-current");
		expect(calls[0]?.searchParams.get("order")).toBe("asc");
		expect(result.next_page_token).toBe("opaque-next");
		expect(result.events[0]?.content).toEqual([
			{ type: "text", text: text.replace(secret, "[REDACTED]") },
			{ type: "custom", data: { nested: [1, 2] } },
		]);
		expect(result.events[0]?.metadata?.event_status).toBe("completed");
		expect(result.events[0]?.metadata?.raw).toBeUndefined();
	});

	it("累计增量进入 SDK accumulator，onReady 在首帧前触发且取消读取", async () => {
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		let requested: URL | undefined;
		let cancelled = false;
		setDefaultFetch(async (input) => {
			requested = new URL(String(input));
			return new Response(
				new ReadableStream({
					start(value) {
						controller = value;
					},
					cancel() {
						cancelled = true;
					},
				}),
				{ headers: { "content-type": "text/event-stream" } },
			);
		});
		const abort = new AbortController();
		let ready!: () => void;
		const connected = new Promise<void>((resolve) => {
			ready = resolve;
		});
		const iterator = gateway()
			.streamEvents("session", { signal: abort.signal, onReady: ready })
			[Symbol.asyncIterator]();
		const first = iterator.next();
		await connected;
		expect(requested?.searchParams.getAll("event_deltas[]")).toEqual(["message", "reasoning"]);
		const emit = (raw: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(raw)}\n\n`));
		emit({ object: "message", id: "e", type: "message", role: "assistant", status: "in_progress", content: [] });
		await first;
		emit({ object: "content", msg_id: "e", index: 0, type: "text", text: "你", delta: true });
		const second = await iterator.next();
		emit({ object: "content", msg_id: "e", index: 0, type: "text", text: "好", delta: true });
		const third = await iterator.next();
		expect(second.value?.content).toEqual([{ type: "text", text: "你" }]);
		expect(third.value?.content).toEqual([{ type: "text", text: "你好" }]);
		abort.abort();
		await iterator.return?.();
		expect(cancelled).toBe(true);
	});

	it("批准/拒绝共用事件 POST，按原请求线程发送且不注入额外参数", async () => {
		let body: unknown;
		setDefaultFetch(async (_input, init) => {
			body = JSON.parse(String(init?.body));
			return Response.json({ data: [{ id: "response-event" }] });
		});
		const result = await gateway().respondToolApproval("s", {
			batch_id: "b",
			call_id: "c",
			result: "deny",
			session_thread_id: "thread-1",
		});
		expect(body).toEqual({
			input: [
				{
					type: "tool_approval_response",
					role: "user",
					session_thread_id: "thread-1",
					content: [{ type: "data", data: { batch_id: "b", call_id: "c", result: "deny" } }],
				},
			],
		});
		expect(result.event_ids).toContain("response-event");
	});
});
