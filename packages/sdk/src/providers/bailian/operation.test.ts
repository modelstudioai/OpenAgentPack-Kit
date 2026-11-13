import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolApprovalsResponse } from "../../protocol/index.ts";
import { createRequest } from "../../request/index.ts";
import { createBailianChatProvider } from "./provider.ts";
import { backendOptions, deferred, wire } from "./test-fixtures.ts";

afterEach(() => vi.useRealTimers());

describe("百炼六操作使用统一 Request", () => {
	it("自定义参数、URL、动态鉴权和响应 envelope 覆盖全部六操作；写入不自动重发", async () => {
		const connection = wire();
		const calls: { url: string; method: string; body: unknown; token: string | null; signal?: AbortSignal | null }[] =
			[];
		let token = "first";
		const pending: ToolApprovalsResponse = {
			requires_action: false,
			batch_id: null,
			pending_call_ids: [],
			requests: [],
		};
		const fetchImpl: typeof fetch = async (input, init) => {
			const url = String(input);
			calls.push({
				url,
				method: init?.method ?? "GET",
				body: init?.body ? JSON.parse(String(init.body)) : undefined,
				token: new Headers(init?.headers).get("authorization"),
				signal: init?.signal,
			});
			if (url.endsWith("/subscribe")) return connection.response;
			const responses: Record<string, unknown> = {
				history: { records: [] },
				stop: { interrupted: true },
				approvals: pending,
			};
			const value = responses[url.slice(url.lastIndexOf("/") + 1)] ?? {
				session_id: "s /1",
				accepted: true,
				event_ids: ["write"],
			};
			return Response.json({ result: value });
		};
		const defaults = backendOptions(connection);
		const path = (sessionId: string, action: string) => `/sessions/${encodeURIComponent(sessionId)}/${action}`;
		const mapResult = async <T>(response: Response) => ((await response.json()) as { result: T }).result;
		const signals: (AbortSignal | undefined)[] = [];
		const provider = createBailianChatProvider({
			...defaults,
			request: createRequest({
				baseUrl: "https://own.example/v3",
				headers: () => ({ authorization: `Bearer ${token}` }),
				fetchImpl,
			}),
			openStream: {
				buildRequest: ({ sessionId }, context) => {
					signals.push(context.signal);
					return { path: path(sessionId, "subscribe") };
				},
				mapResponse: (response, context) => {
					expect(context.input).toEqual({ sessionId: "s /1" });
					expect(context.signal).toBe(signals[0]);
					return { response, ready: Promise.resolve() };
				},
			},
			listEvents: {
				buildRequest: ({ sessionId }) => ({ path: path(sessionId, "history") }),
				mapResponse: async (response, { signal }) => {
					expect(signal).toBe(signals[0]);
					const result = await mapResult<{ records: Record<string, unknown>[] }>(response);
					return { events: result.records };
				},
			},
			sendMessage: {
				buildRequest: ({ sessionId, body }) => ({
					path: path(sessionId, "send"),
					init: { method: "POST", body: JSON.stringify({ message: body }) },
				}),
				mapResponse: mapResult,
			},
			interrupt: {
				buildRequest: ({ sessionId }) => ({ path: path(sessionId, "stop"), init: { method: "POST" } }),
				mapResponse: mapResult,
			},
			toolApprovals: {
				buildRequest: ({ sessionId }) => ({ path: path(sessionId, "approvals") }),
				mapResponse: mapResult,
			},
			submitToolApproval: {
				buildRequest: ({ sessionId, decision }) => ({
					path: path(sessionId, "decision"),
					init: { method: "PUT", body: JSON.stringify({ approval: decision }) },
				}),
				mapResponse: () => {
					throw new Error("mapping failed");
				},
			},
		});
		const abort = new AbortController();
		const ready = deferred<void>();
		const outcome = provider
			.stream("s /1", { signal: abort.signal, onReady: () => ready.resolve() })
			.catch((error: unknown) => error);
		await ready.promise;
		token = "second";
		await expect(provider.sendMessage("s /1", { text: "hello" })).resolves.toMatchObject({ accepted: true });
		await expect(provider.interrupt("s /1")).resolves.toEqual({ interrupted: true });
		await expect(provider.toolApprovals("s /1")).resolves.toEqual(pending);
		const decision = { batch_id: "b", call_id: "c", result: "deny" as const };
		await expect(provider.submitToolApproval("s /1", decision)).rejects.toThrow("mapping failed");
		expect(calls.map(({ url }) => url)).toEqual(
			["subscribe", "history", "send", "stop", "approvals", "decision"].map(
				(action) => `https://own.example/v3/sessions/s%20%2F1/${action}`,
			),
		);
		expect(calls.slice(0, 2).every((call) => call.signal === signals[0])).toBe(true);
		expect(calls.map(({ token: value }) => value)).toEqual([
			"Bearer first",
			"Bearer first",
			...Array(4).fill("Bearer second"),
		]);
		expect(calls[2]).toMatchObject({ method: "POST", body: { message: { text: "hello" } } });
		expect(calls[5]).toMatchObject({ method: "PUT", body: { approval: decision } });
		abort.abort();
		await outcome;
		expect(connection.cancelled()).toBe(true);
	});

	it("ready 未完成时已经读取实时帧；ready 拒绝后取消且不读取历史", async () => {
		const connection = wire();
		const barrier = deferred<void>();
		const historyResponse = vi.fn(async () => Response.json({ events: [] }));
		const provider = createBailianChatProvider(backendOptions(connection, { ready: barrier.promise, historyResponse }));
		const ping = deferred<void>();
		const onEvent = vi.fn();
		const onReady = vi.fn();
		const outcome = provider
			.stream("s", { onPing: () => ping.resolve(), onEvent, onReady })
			.catch((error: unknown) => error);
		connection.text("event: heartbeat\ndata: {}\n\n");
		await ping.promise;
		expect(historyResponse).not.toHaveBeenCalled();
		expect(onEvent).not.toHaveBeenCalled();
		barrier.reject(new Error("private backend details"));
		expect(await outcome).toMatchObject({ retryable: true, message: "自建后端事件连接失败" });
		expect(onReady).not.toHaveBeenCalled();
		expect(connection.cancelled()).toBe(true);
	});

	it("ready 屏障之前的业务帧先缓冲，历史完成后才原子交付", async () => {
		const connection = wire();
		const barrier = deferred<void>();
		const historyResponse = vi.fn(async () => Response.json({ events: [] }));
		const provider = createBailianChatProvider(backendOptions(connection, { ready: barrier.promise, historyResponse }));
		const abort = new AbortController();
		const ping = deferred<void>();
		const ready = deferred<void>();
		const onEvent = vi.fn();
		const outcome = provider
			.stream("s", {
				signal: abort.signal,
				onPing: () => ping.resolve(),
				onEvent,
				onReady: () => ready.resolve(),
			})
			.catch((error: unknown) => error);
		connection.feed({
			object: "message",
			id: "running",
			type: "session_status",
			status: "completed",
			content: [{ type: "data", data: { session_status: "running" } }],
		});
		connection.feed({
			object: "message",
			id: "answer",
			type: "message",
			role: "assistant",
			status: "in_progress",
			content: [{ type: "text", text: "已经生成" }],
		});
		connection.text("event: heartbeat\ndata: {}\n\n");
		await ping.promise;
		expect(onEvent).not.toHaveBeenCalled();
		expect(historyResponse).not.toHaveBeenCalled();
		barrier.resolve();
		await ready.promise;
		expect(onEvent.mock.calls.map(([event]) => event.event_id)).toEqual(["running", "answer"]);
		expect(onEvent.mock.calls[1]?.[0].content).toEqual([{ type: "text", text: "已经生成" }]);
		abort.abort();
		await outcome;
	});

	it("响应映射忽略 signal 时取消仍退出并关闭 body，迟到 ready 拒绝也被处理", async () => {
		const connection = wire();
		const mapping = deferred<{ response: Response; ready: Promise<void> }>();
		const entered = deferred<void>();
		const defaults = backendOptions(connection);
		const provider = createBailianChatProvider({
			...defaults,
			openStream: {
				...defaults.openStream,
				mapResponse: (_response, { signal }) => {
					expect(signal).toBeInstanceOf(AbortSignal);
					entered.resolve();
					return mapping.promise;
				},
			},
		});
		const abort = new AbortController();
		const onReady = vi.fn();
		const outcome = provider.stream("s", { signal: abort.signal, onReady }).catch((error: unknown) => error);
		await entered.promise;
		abort.abort();
		expect(await outcome).toMatchObject({ name: "AbortError" });
		expect(connection.cancelled()).toBe(true);
		mapping.resolve({ response: connection.response, ready: Promise.reject(new Error("late ready")) });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(onReady).not.toHaveBeenCalled();
	});

	it("历史 mapResponse 持有 JSON reader 时取消会关闭原响应并释放锁", async () => {
		const connection = wire();
		const entered = deferred<void>();
		const cancel = vi.fn();
		const historyBody = new ReadableStream<Uint8Array>({ cancel });
		const defaults = backendOptions(connection, {
			historyResponse: async () => new Response(historyBody, { headers: { "Content-Type": "application/json" } }),
		});
		const provider = createBailianChatProvider({
			...defaults,
			listEvents: {
				...defaults.listEvents,
				mapResponse: (response) => {
					entered.resolve();
					return response.json();
				},
			},
		});
		const abort = new AbortController();
		const onReady = vi.fn();
		const outcome = provider.stream("s", { signal: abort.signal, onReady }).catch((error: unknown) => error);
		await entered.promise;
		expect(historyBody.locked).toBe(true);
		abort.abort();
		expect(await outcome).toMatchObject({ name: "AbortError" });
		expect(cancel).toHaveBeenCalledOnce();
		expect(historyBody.locked).toBe(false);
		expect(connection.cancelled()).toBe(true);
		expect(onReady).not.toHaveBeenCalled();
	});

	it.each(["build", "headers", "mapping"] as const)("连接总时限覆盖 %s 阶段", async (phase) => {
		vi.useFakeTimers();
		const connection = wire();
		const held = deferred<never>();
		const defaults = backendOptions(connection);
		const fetchImpl = vi.fn(async () => connection.response);
		const provider = createBailianChatProvider({
			...defaults,
			connectTimeoutMs: 10,
			request: createRequest({
				baseUrl: "https://own.test",
				fetchImpl,
				headers: () => (phase === "headers" ? held.promise : {}),
			}),
			openStream: {
				buildRequest: phase === "build" ? () => held.promise : defaults.openStream.buildRequest,
				mapResponse: phase === "mapping" ? () => held.promise : defaults.openStream.mapResponse,
			},
		});
		const outcome = provider.stream("s").catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(11);
		expect(await outcome).toMatchObject({ retryable: true, message: "订阅就绪或历史重建超时" });
		expect(fetchImpl).toHaveBeenCalledTimes(phase === "mapping" ? 1 : 0);
		if (phase === "mapping") expect(connection.cancelled()).toBe(true);
	});
});
