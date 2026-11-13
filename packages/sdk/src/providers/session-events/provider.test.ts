import { describe, expect, it, vi } from "vitest";
import { encodeFrame, type SseFrame } from "../../protocol/index.ts";
import { createRequest } from "../../request/index.ts";
import { createSessionEventChatProvider, type SessionEventChatProviderOptions } from "./index.ts";

// 保护真实接入合同：自定义路径/请求/JSON 包装不依赖 KitClient，SSE 保留游标和生命周期。
function fixture(frames: SseFrame[]) {
	const calls: { url: string; init: RequestInit }[] = [];
	const request = createRequest({
		baseUrl: "https://business.example/prefix",
		headers: () => ({ Authorization: "Bearer app-user" }),
		fetchImpl: async (url, init = {}) => {
			calls.push({ url: String(url), init });
			if (String(url).includes("/watch")) {
				const bytes = new TextEncoder().encode(frames.map(encodeFrame).join(""));
				return new Response(bytes, { headers: { "Content-Type": "text/event-stream" } });
			}
			return Response.json({ payload: { accepted: true, event_ids: ["user-1"] } });
		},
	});
	const configuration: SessionEventChatProviderOptions = {
		request,
		stream: {
			buildRequest: ({ sessionId, after }) => ({
				path: `/conversations/${encodeURIComponent(sessionId)}/watch?cursor=${encodeURIComponent(after ?? "")}`,
				init: { headers: { "x-business-stream": "snapshots" } },
			}),
		},
		sendMessage: {
			buildRequest: ({ sessionId, body }) => ({
				path: "/chat/send",
				init: {
					method: "POST",
					body: JSON.stringify({ conversation: sessionId, input: body.text, request: body.client_message_id }),
				},
			}),
			mapResponse: async (response) => (await response.json()).payload,
		},
		interrupt: {
			buildRequest: ({ sessionId }) => ({ path: `/chat/${sessionId}/stop`, init: { method: "PUT" } }),
			mapResponse: async (response) => ({ interrupted: (await response.json()).payload.accepted }),
		},
		toolApprovals: {
			buildRequest: () => ({ path: "/chat/approvals" }),
			mapResponse: async () => ({ requires_action: false, batch_id: null, pending_call_ids: [], requests: [] }),
		},
		submitToolApproval: {
			buildRequest: ({ decision }) => ({
				path: "/chat/decision",
				init: { method: "PATCH", body: JSON.stringify({ decision }) },
			}),
			mapResponse: async (response) => (await response.json()).payload,
		},
	};
	return { calls, configuration, provider: createSessionEventChatProvider(configuration) };
}

const event: SseFrame = {
	type: "event",
	cursor: "change-2",
	data: { event_id: "answer", type: "message", role: "assistant", content: [{ type: "text", text: "hello" }] },
};
const ready: SseFrame = { type: "ready", data: { session_id: "s/1", after: null, replayed: 1, cursor: "change-2" } };

describe("标准事件后端的公开配置接入", () => {
	it("使用业务接口与响应映射，交付回放/就绪/结束，游标不当作事件 ID", async () => {
		const { calls, provider } = fixture([
			{ type: "reset", data: { session_id: "s/1" } },
			event,
			ready,
			{ type: "ping", data: { t: 42 } },
			{ type: "done", data: { session_id: "s/1", status: "closed", last_event_id: "answer", reason: null } },
		]);
		const timeline: unknown[] = [];
		await provider.stream("s/1", {
			after: "cursor/+",
			onReset: () => timeline.push("reset"),
			onEvent: (value, cursor) => timeline.push([value.event_id, cursor]),
			onReady: (value) => timeline.push(value),
			onPing: (value) => timeline.push(value),
			onDone: (value) => timeline.push(value),
		});
		expect(timeline).toEqual([
			"reset",
			["answer", "change-2"],
			{ sessionId: "s/1", replayed: 1, cursor: "change-2" },
			42,
			{ status: "closed", lastEventId: "answer" },
		]);
		expect(calls[0]?.url).toBe("https://business.example/prefix/conversations/s%2F1/watch?cursor=cursor%2F%2B");
		expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer app-user");
		expect(new Headers(calls[0]?.init.headers).get("x-kit-protocol-version")).toBeNull();
		await expect(provider.sendMessage("s/1", { text: "hello", client_message_id: "request-1" })).resolves.toMatchObject(
			{ event_ids: ["user-1"] },
		);
		expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
			conversation: "s/1",
			input: "hello",
			request: "request-1",
		});
		await expect(provider.interrupt("s/1")).resolves.toEqual({ interrupted: true });
		expect(calls[2]?.init.method).toBe("PUT");
		await provider.submitToolApproval("s/1", { batch_id: "b", call_id: "c", result: "deny" });
		expect(calls[3]?.init.method).toBe("PATCH");
	});

	it("真实自然断流仍报告可恢复错误，不能以就绪或完成快照冒充 done", async () => {
		const { provider } = fixture([event, ready]);
		const onReady = vi.fn();
		const onDone = vi.fn();
		await expect(provider.stream("s/1", { onReady, onDone })).rejects.toMatchObject({
			code: "provider_error",
			retryable: true,
		});
		expect(onReady).toHaveBeenCalledOnce();
		expect(onDone).not.toHaveBeenCalled();
	});

	it("取消尚未完成的请求构造后，不连接后端或交付迟到回调", async () => {
		const { calls, configuration } = fixture([ready]);
		let release = () => {};
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		let markBuilding = () => {};
		const building = new Promise<void>((resolve) => {
			markBuilding = resolve;
		});
		const provider = createSessionEventChatProvider({
			...configuration,
			stream: {
				async buildRequest() {
					markBuilding();
					await pending;
					return { path: "/late/watch" };
				},
			},
		});
		const abort = new AbortController();
		const onReady = vi.fn();
		const stream = provider.stream("s/1", { signal: abort.signal, onReady });
		const result = expect(stream).rejects.toBeDefined();
		await building;
		abort.abort();
		await result;
		release();
		await Promise.resolve();
		expect(calls).toHaveLength(0);
		expect(onReady).not.toHaveBeenCalled();
	});
});
