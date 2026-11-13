import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionStore } from "../../chat/session-store.ts";
import type { SessionEvent } from "../../protocol/index.ts";
import { createBailianChatProvider } from "./index.ts";
import { type BackendFixture, backendOptions, deferred, wire } from "./test-fixtures.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const time = (second: number) => `2026-10-20T00:00:${String(second).padStart(2, "0")}Z`;
const status = (id: string, value: string, second: number) => ({
	object: "message",
	id,
	type: "session_status",
	status: "completed",
	created_at: time(second),
	content: [{ type: "data", data: { session_status: value } }],
});
const message = (id: string, text: string, lifecycle = "completed", second = 2) => ({
	object: "message",
	id,
	type: "message",
	role: "assistant",
	status: lifecycle,
	created_at: time(second),
	content: [{ type: "text", text }],
});
function setup(fixture: BackendFixture = {}) {
	const connection = wire();
	const abort = new AbortController();
	const options = backendOptions(connection, fixture);
	const store = createSessionStore("session");
	const ready = deferred<void>();
	const provider = createBailianChatProvider(options);
	const seen: SessionEvent[] = [];
	const stream = provider.stream("session", {
		signal: abort.signal,
		after: "kit-epoch:123",
		onReset: () => store.beginReplay(),
		onEvent: (event, cursor) => {
			seen.push(event);
			store.applyEvent(event, cursor);
		},
		onReady: (info) => {
			store.finishReplay(info.cursor);
			store.setConnection("connected");
			ready.resolve();
		},
	});
	const outcome = stream.then(
		() => undefined,
		(error: unknown) => error,
	);
	return { connection, abort, options, store, ready, seen, outcome, provider };
}
afterEach(() => vi.useRealTimers());

describe("自建百炼后端原始 SSE", () => {
	it("空闲会话在上游屏障和历史完成后 ready；保留自建 URL/包装且不向原始流传 Kit 游标", async () => {
		const connected = deferred<void>();
		const history = deferred<{ events: Record<string, unknown>[] }>();
		const connection = wire();
		const calls: string[] = [];
		const historyResponse = vi.fn(async (input: RequestInfo | URL) => {
			calls.push(String(input));
			return Response.json(await history.promise);
		});
		const streamResponse = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			calls.push(String(input));
			expect(init?.signal).toBeInstanceOf(AbortSignal);
			expect(String(input)).not.toContain("kit-epoch");
			return connection.response;
		});
		const test = setup({ streamResponse, historyResponse, ready: connected.promise });
		await tick();
		expect(historyResponse).not.toHaveBeenCalled();
		expect(test.store.getSnapshot().canSend).toBe(false);
		connected.resolve();
		await tick();
		expect(test.store.getSnapshot().canSend).toBe(false);
		history.resolve({ events: [] });
		await test.ready.promise;
		expect(test.store.getSnapshot().canSend).toBe(true);
		expect(test.seen).toEqual([]);
		expect(calls).toEqual(["https://own.test/subscribe", "https://own.test/history"]);
		test.abort.abort();
		expect(await test.outcome).toMatchObject({ name: "AbortError" });
		expect(connection.cancelled()).toBe(true);
	});

	it("流式使用 SDK 累计转换，最终快照替换正文，业务终态不关闭订阅", async () => {
		const test = setup();
		await test.ready.promise;
		test.connection.feed(status("running", "running", 1));
		test.connection.feed(message("answer", "", "in_progress"));
		test.connection.feed({ object: "content", msg_id: "answer", index: 0, type: "text", delta: true, text: "你" });
		test.connection.feed({ object: "content", msg_id: "answer", index: 0, type: "text", delta: true, text: "好" });
		await tick();
		expect(test.store.getSnapshot().messages[0]?.parts).toMatchObject([{ type: "text", text: "你好" }]);
		test.connection.feed(message("answer", "最终正文"));
		test.connection.feed(status("idle", "idle", 3));
		await tick();
		expect(test.store.getSnapshot()).toMatchObject({ phase: "idle", canSend: true, lastCursor: null });
		expect(test.store.getSnapshot().messages[0]?.parts).toMatchObject([{ type: "text", text: "最终正文" }]);
		expect(test.connection.cancelled()).toBe(false);
		test.abort.abort();
		await test.outcome;
	});

	it("完整历史与缓冲交叉时保留最新状态；in_progress 历史不重复追加新 delta", async () => {
		const history = deferred<{ events: Record<string, unknown>[] }>();
		const test = setup({ historyResponse: async () => Response.json(await history.promise) });
		await tick();
		test.connection.feed(status("idle", "idle", 0));
		test.connection.feed(message("answer", "", "in_progress"));
		test.connection.feed({ object: "content", msg_id: "answer", index: 0, type: "text", delta: true, text: "后缀" });
		await tick();
		history.resolve({
			events: [
				status("idle", "idle", 0),
				status("running", "running", 1),
				message("answer", "历史局部", "in_progress"),
			],
		});
		await test.ready.promise;
		expect(test.store.getSnapshot()).toMatchObject({ phase: "running", canSend: false });
		expect(test.store.getSnapshot().messages[0]?.parts).toMatchObject([{ text: "历史局部" }]);
		test.connection.feed(message("answer", "权威完整正文"));
		test.connection.feed(status("done", "idle", 4));
		await tick();
		expect(test.store.getSnapshot().messages[0]?.parts).toMatchObject([{ text: "权威完整正文" }]);
		expect(test.store.getSnapshot().canSend).toBe(true);
		test.abort.abort();
		await test.outcome;
	});

	it("原始流 EOF 报可重试错误且释放 reader，不伪造 done", async () => {
		const test = setup();
		await test.ready.promise;
		test.connection.close();
		expect(await test.outcome).toMatchObject({ retryable: true, message: "事件连接意外关闭" });
		expect(test.connection.body.locked).toBe(false);
	});

	it("同 ID 状态与历史冲突时拒绝 ready，不让旧 idle 覆盖 running", async () => {
		const history = deferred<{ events: Record<string, unknown>[] }>();
		const test = setup({ historyResponse: async () => Response.json(await history.promise) });
		await tick();
		test.connection.feed(status("state", "idle", 1));
		await tick();
		history.resolve({ events: [status("state", "running", 1)] });
		expect(await test.outcome).toMatchObject({ retryable: false });
		expect(test.seen).toEqual([]);
		expect(test.store.getSnapshot().canSend).toBe(false);
	});

	it("重建期间允许未完成消息推进到权威完成快照", async () => {
		const history = deferred<{ events: Record<string, unknown>[] }>();
		const test = setup({ historyResponse: async () => Response.json(await history.promise) });
		await tick();
		test.connection.feed(message("answer", "完整正文"));
		test.connection.feed(status("idle", "idle", 3));
		await tick();
		history.resolve({ events: [status("running", "running", 1), message("answer", "部分", "in_progress")] });
		await test.ready.promise;
		expect(test.store.getSnapshot().messages[0]?.parts).toMatchObject([{ text: "完整正文" }]);
		expect(test.store.getSnapshot().canSend).toBe(true);
		test.abort.abort();
		await test.outcome;
	});

	it.each([false, true])("孤立 content 不误判空闲；随后身份到达=%s", async (identityArrives) => {
		const history = deferred<{ events: Record<string, unknown>[] }>();
		const test = setup({ historyResponse: async () => Response.json(await history.promise) });
		await tick();
		test.connection.feed({ object: "content", msg_id: "answer", index: 0, type: "text", delta: true, text: "生成中" });
		if (identityArrives) test.connection.feed(message("answer", "", "in_progress"));
		await tick();
		history.resolve({ events: [] });
		if (identityArrives) {
			await test.ready.promise;
			expect(test.store.getSnapshot()).toMatchObject({ phase: "running", canSend: false });
			expect(test.store.getSnapshot().messages[0]?.parts).toMatchObject([{ text: "生成中" }]);
			test.abort.abort();
			await test.outcome;
		} else {
			expect(await test.outcome).toMatchObject({ retryable: false });
			expect(test.store.getSnapshot().canSend).toBe(false);
			expect(test.seen).toEqual([]);
		}
	});

	it.each(["missing-state", "ambiguous-order"])("不完整恢复依据 %s 不能宣布 ready", async (reason) => {
		const history = deferred<{ events: Record<string, unknown>[] }>();
		const test = setup({ historyResponse: async () => Response.json(await history.promise) });
		await tick();
		if (reason === "ambiguous-order") test.connection.feed(status("new", "idle", 1));
		await tick();
		history.resolve({
			events: reason === "missing-state" ? [message("answer", "旧回答")] : [status("old", "running", 1)],
		});
		expect(await test.outcome).toMatchObject({ retryable: false });
		expect(test.store.getSnapshot().canSend).toBe(false);
	});

	it("完整注释/heartbeat 保活，半条无终止数据不能永远绕过静默超时", async () => {
		vi.useFakeTimers();
		const test = setup({ options: { idleTimeoutMs: 50 } });
		await test.ready.promise;
		await vi.advanceTimersByTimeAsync(35);
		test.connection.text(": keep alive\r\n");
		await vi.advanceTimersByTimeAsync(35);
		test.connection.text("event: heartbeat\ndata: {}\n\n");
		await vi.advanceTimersByTimeAsync(35);
		expect(test.connection.cancelled()).toBe(false);
		test.connection.text("data: ");
		await vi.advanceTimersByTimeAsync(51);
		expect(await test.outcome).toMatchObject({ retryable: true, message: "事件连接长时间没有响应" });
		expect(test.connection.cancelled()).toBe(true);
	});

	it("HTTP 已到达但 ready 屏障未完成时连接超时，释放未结束响应", async () => {
		vi.useFakeTimers();
		const connected = deferred<void>();
		const connection = wire();
		const historyResponse = vi.fn(async () => Response.json({ events: [] }));
		const test = setup({
			options: { connectTimeoutMs: 20 },
			streamResponse: async () => connection.response,
			ready: connected.promise,
			historyResponse,
		});
		await vi.advanceTimersByTimeAsync(21);
		expect(await test.outcome).toMatchObject({ retryable: true, message: "订阅就绪或历史重建超时" });
		expect(connection.cancelled()).toBe(true);
		expect(historyResponse).not.toHaveBeenCalled();
	});

	it("待决历史期间缓冲超限会取消历史请求并拒绝 ready", async () => {
		const history = deferred<{ events: Record<string, unknown>[] }>();
		const test = setup({
			options: { maxBufferedFrames: 1 },
			historyResponse: async () => Response.json(await history.promise),
		});
		await tick();
		test.connection.feed(status("running", "running", 1));
		test.connection.feed(status("idle", "idle", 3));
		expect(await test.outcome).toMatchObject({ retryable: false, message: "历史重建期间实时事件缓冲超限" });
		expect(test.store.getSnapshot().canSend).toBe(false);
		expect(test.connection.cancelled()).toBe(true);
	});

	it.each([401, 429, 500])("HTTP %i 分类且错误不暴露后端正文", async (statusCode) => {
		const response = new Response("private response token", { status: statusCode });
		const test = setup({ streamResponse: async () => response });
		const error = await test.outcome;
		expect(error).toMatchObject({ status: statusCode, retryable: statusCode !== 401 });
		expect(String(error)).not.toContain("private response token");
		expect(test.store.getSnapshot().canSend).toBe(false);
	});

	it("业务 error 保留为事件；无业务身份的流 error 中止连接且不透出正文", async () => {
		const test = setup();
		await test.ready.promise;
		test.connection.text(
			`event: error\ndata: ${JSON.stringify({
				object: "message",
				id: "business-error",
				type: "error",
				status: "completed",
				content: [{ type: "text", text: "业务失败原因" }],
			})}\n\n`,
		);
		await tick();
		expect(test.seen).toMatchObject([{ event_id: "business-error", type: "error" }]);
		expect(test.connection.cancelled()).toBe(false);
		test.connection.text('event: error\ndata: {"message":"private token","retryable":false}\n\n');
		const error = await test.outcome;
		expect(error).toMatchObject({ retryable: false, message: "上游事件连接报告错误" });
		expect(String(error)).not.toContain("private token");
	});

	it.each(["{}", "[DONE]"])("无业务身份或不支持的结束标记 %s 不进入消息归并", async (payload) => {
		const test = setup();
		await test.ready.promise;
		test.connection.text(`data: ${payload}\n\n`);
		expect(await test.outcome).toMatchObject({ retryable: false });
		expect(test.seen).toEqual([]);
	});

	it("ready 之前断流取消待决历史，不再交付晚到帧", async () => {
		const history = deferred<{ events: Record<string, unknown>[] }>();
		let historySignal: AbortSignal | undefined;
		const test = setup({
			historyResponse: async (_, init) => {
				historySignal = init?.signal ?? undefined;
				return Response.json(await history.promise);
			},
		});
		await tick();
		test.connection.feed(message("buffered", "不应交付"));
		test.abort.abort();
		expect(await test.outcome).toMatchObject({ name: "AbortError" });
		expect(historySignal?.aborted).toBe(true);
		history.resolve({ events: [status("idle", "idle", 0)] });
		await tick();
		expect(test.seen).toEqual([]);
		expect(test.store.getSnapshot().canSend).toBe(false);
	});

	it("忽略 signal 的 openStream 晚到时也会关闭响应，不发起历史查询", async () => {
		const opened = deferred<Response>();
		const late = wire();
		const historyResponse = vi.fn(async () => Response.json({ events: [] }));
		const test = setup({ streamResponse: async () => opened.promise, historyResponse });
		await tick();
		test.abort.abort();
		await test.outcome;
		opened.resolve(late.response);
		await tick();
		expect(late.cancelled()).toBe(true);
		expect(historyResponse).not.toHaveBeenCalled();
	});

	it("重复分页游标不能截断后 ready", async () => {
		const historyResponse = vi.fn(async () => Response.json({ events: [], nextPageToken: "same-page" }));
		const test = setup({ historyResponse });
		expect(await test.outcome).toMatchObject({ retryable: false });
		expect(historyResponse).toHaveBeenCalledTimes(2);
		expect(test.store.getSnapshot().canSend).toBe(false);
		expect(test.connection.cancelled()).toBe(true);
	});

	it("畸形 JSON/帧超限明确报错，不泄露原始片段", async () => {
		const test = setup({ options: { maxBufferedBytes: 32 } });
		await test.ready.promise;
		test.connection.text(`data: ${"sensitive".repeat(20)}`);
		const error = await test.outcome;
		expect(error).toMatchObject({ retryable: false });
		expect(String(error)).not.toContain("sensitive");
		expect(test.connection.cancelled()).toBe(true);
	});
});
