import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionStore } from "../../chat/session-store.ts";
import type { SessionEvent } from "../../protocol/index.ts";
import { createRequest } from "../../request/index.ts";
import type { ChatProvider } from "../contract.ts";
import { type BailianEventsPage, createBailianChatProvider } from "./index.ts";
import { backendOptions, wire as connection, deferred } from "./test-fixtures.ts";

const timestamp = (second: number) => `2026-10-20T01:00:${String(second).padStart(2, "0")}Z`;
const status = (id: string, value: string, second: number) => ({
	object: "message",
	id,
	type: "session_status",
	status: "completed",
	created_at: timestamp(second),
	content: [{ type: "data", data: { session_status: value } }],
});
const message = (id: string, text: string, second: number, lifecycle = "completed") => ({
	object: "message",
	id,
	type: "message",
	role: "assistant",
	status: lifecycle,
	created_at: timestamp(second),
	content: [{ type: "text", text }],
});
const delta = (id: string, text: string) => ({
	object: "content",
	msg_id: id,
	index: 0,
	type: "text",
	delta: true,
	text,
});
// 真实 Cloud 的 event_start/event_delta 形态；正文用合成文本替换。
const eventStart = (id: string, type: "message" | "reasoning") => ({
	type: "event_start",
	event: { id, type },
	object: "message",
	status: "in_progress",
});
const reasoningDelta = (id: string, text: string) => ({
	type: "event_delta",
	event_id: id,
	delta: { type: "reasoning_delta", index: 0, reasoning: text },
	object: "content",
	status: "in_progress",
});

const subscriptions = new Set<{ abort: AbortController; outcome: Promise<unknown> }>();
afterEach(async () => {
	for (const subscription of subscriptions) subscription.abort.abort();
	await Promise.all([...subscriptions].map((subscription) => subscription.outcome));
	subscriptions.clear();
});

function observe(provider: ChatProvider, store = createSessionStore("session")) {
	const abort = new AbortController();
	const ready = deferred<void>();
	const seen: SessionEvent[] = [];
	let resets = 0;
	let pings = 0;
	const outcome = provider
		.stream("session", {
			signal: abort.signal,
			onReset: () => {
				resets++;
				store.beginReplay();
			},
			onEvent: (event, cursor) => {
				seen.push(event);
				store.applyEvent(event, cursor);
			},
			onPing: () => {
				pings++;
			},
			onReady: (event) => {
				store.finishReplay(event.cursor);
				store.setConnection("connected");
				ready.resolve();
			},
		})
		.then(
			() => undefined,
			(error: unknown) => error,
		);
	subscriptions.add({ abort, outcome });
	return { abort, ready: ready.promise, outcome, store, seen, resets: () => resets, pings: () => pings };
}

describe("自建百炼后端网络合同与恢复", () => {
	it("公开 SDK 转换真实起始与增量帧，最终快照和会话终态恢复正常正文", async () => {
		const wire = connection();
		const observed = observe(createBailianChatProvider(backendOptions(wire)));
		await observed.ready;
		wire.feed(status("running", "running", 1));
		wire.feed(eventStart("thinking", "reasoning"));
		wire.feed(reasoningDelta("thinking", "正在"));
		wire.feed(reasoningDelta("thinking", "分析"));
		await vi.waitFor(() =>
			expect(observed.store.getSnapshot().messages[0]?.parts).toMatchObject([{ type: "reasoning", text: "正在分析" }]),
		);
		expect(observed.store.getSnapshot()).toMatchObject({ phase: "running", canSend: false });
		wire.feed({ ...message("thinking", "完整思考", 2), type: "reasoning" });
		wire.feed(eventStart("answer", "message"));
		wire.feed({
			type: "event_delta",
			event_id: "answer",
			delta: { type: "content_delta", index: 0, content: { type: "text", text: "流式回答" } },
			object: "content",
			status: "in_progress",
		});
		await vi.waitFor(() =>
			expect(observed.store.getSnapshot().messages[0]?.parts).toMatchObject([
				{ type: "reasoning", text: "完整思考" },
				{ type: "text", text: "流式回答" },
			]),
		);
		wire.feed(message("answer", "最终回答", 3));
		await vi.waitFor(() =>
			expect(observed.store.getSnapshot().messages[0]?.parts[1]).toMatchObject({ type: "text", text: "最终回答" }),
		);
		expect(observed.store.getSnapshot()).toMatchObject({ phase: "running", canSend: false });
		wire.feed(status("idle", "idle", 4));
		await vi.waitFor(() => expect(observed.store.getSnapshot().canSend).toBe(true));
		expect(observed.store.getSnapshot().messages).toMatchObject([
			{
				status: "done",
				parts: [
					{ type: "reasoning", text: "完整思考" },
					{ type: "text", text: "最终回答" },
				],
			},
		]);
		expect(observed.seen.every((event) => !["event_start", "event_delta"].includes(event.type))).toBe(true);
		expect(wire.cancelled()).toBe(false);
	});

	it.each([false, true])("恢复时 event_delta 按 event_id 等待业务身份，随后起始帧到达=%s", async (identityArrives) => {
		const wire = connection();
		const history = deferred<BailianEventsPage>();
		const historyResponse = vi.fn(async () => Response.json(await history.promise));
		const observed = observe(createBailianChatProvider(backendOptions(wire, { historyResponse })));
		await vi.waitFor(() => expect(historyResponse).toHaveBeenCalledOnce());
		wire.feed(reasoningDelta("thinking", "尚在分析"));
		if (identityArrives) wire.feed(eventStart("thinking", "reasoning"));
		wire.bytes(new TextEncoder().encode("event: heartbeat\ndata: {}\n\n"));
		await vi.waitFor(() => expect(observed.pings()).toBe(1));
		history.resolve({ events: [] });
		if (identityArrives) {
			await Promise.race([observed.ready, observed.outcome.then((error) => Promise.reject(error))]);
			expect(observed.store.getSnapshot()).toMatchObject({ phase: "running", canSend: false });
			expect(observed.store.getSnapshot().messages[0]?.parts).toMatchObject([{ type: "reasoning", text: "尚在分析" }]);
		} else {
			expect(await observed.outcome).toMatchObject({ retryable: false });
			expect(observed.store.getSnapshot().canSend).toBe(false);
			expect(observed.seen).toEqual([]);
			expect(wire.cancelled()).toBe(true);
		}
	});

	it.each([false, true])("非空历史用同 ID 最终快照恢复无时间的起始帧；增量先到=%s", async (deltaFirst) => {
		const wire = connection();
		const history = deferred<BailianEventsPage>();
		const historyResponse = vi.fn(async () => Response.json(await history.promise));
		const observed = observe(createBailianChatProvider(backendOptions(wire, { historyResponse })));
		await vi.waitFor(() => expect(historyResponse).toHaveBeenCalledOnce());
		wire.feed(status("state", "running", 1));
		const fragments = [eventStart("thinking", "reasoning"), reasoningDelta("thinking", "局部思考")];
		for (const frame of deltaFirst ? fragments.toReversed() : fragments) wire.feed(frame);
		wire.feed(message("answer", "随后正文", 3));
		wire.feed({ ...message("thinking", "完整思考", 2), type: "reasoning" });
		wire.feed(status("state", "idle", 1));
		wire.bytes(new TextEncoder().encode("event: heartbeat\ndata: {}\n\n"));
		await vi.waitFor(() => expect(observed.pings()).toBe(1));
		history.resolve({ events: [status("past-idle", "idle", 0)] });
		await Promise.race([observed.ready, observed.outcome.then((error) => Promise.reject(error))]);
		expect(observed.store.getSnapshot()).toMatchObject({
			phase: "idle",
			canSend: true,
			messages: [
				{
					status: "done",
					parts: [
						{ type: "reasoning", text: "完整思考" },
						{ type: "text", text: "随后正文" },
					],
				},
			],
		});
		expect(
			observed.seen.filter((event) => event.type === "session_status").map((event) => event.metadata?.status),
		).toEqual(["idle", "running", "idle"]);
		expect(wire.cancelled()).toBe(false);
	});

	it("无同 ID 时间证据时不借用相邻事件时间宣布恢复完成", async () => {
		const wire = connection();
		const history = deferred<BailianEventsPage>();
		const historyResponse = vi.fn(async () => Response.json(await history.promise));
		const observed = observe(createBailianChatProvider(backendOptions(wire, { historyResponse })));
		await vi.waitFor(() => expect(historyResponse).toHaveBeenCalledOnce());
		wire.feed(status("state", "running", 1));
		wire.feed(eventStart("thinking", "reasoning"));
		wire.feed(reasoningDelta("thinking", "缺少自己的创建时间"));
		wire.feed(message("other", "另一事件有时间", 2));
		wire.feed(status("state", "idle", 1));
		wire.bytes(new TextEncoder().encode("event: heartbeat\ndata: {}\n\n"));
		await vi.waitFor(() => expect(observed.pings()).toBe(1));
		history.resolve({ events: [status("past-idle", "idle", 0)] });
		expect(await observed.outcome).toMatchObject({ retryable: false });
		expect(observed.store.getSnapshot().canSend).toBe(false);
		expect(observed.seen).toEqual([]);
		expect(wire.cancelled()).toBe(true);
	});

	it("同 ID 最终快照的 created_at 变化不移动消息首次确定的位置", async () => {
		const wire = connection();
		const history = deferred<BailianEventsPage>();
		const historyResponse = vi.fn(async () => Response.json(await history.promise));
		const observed = observe(createBailianChatProvider(backendOptions(wire, { historyResponse })));
		await vi.waitFor(() => expect(historyResponse).toHaveBeenCalledOnce());
		wire.feed(message("answer", "局部正文", 1, "in_progress"));
		wire.feed(message("answer", "完整正文", 3));
		wire.bytes(new TextEncoder().encode("event: heartbeat\ndata: {}\n\n"));
		await vi.waitFor(() => expect(observed.pings()).toBe(1));
		history.resolve({ events: [status("past-idle", "idle", 0), status("later-status", "idle", 2)] });
		await Promise.race([observed.ready, observed.outcome.then((error) => Promise.reject(error))]);
		expect(observed.seen.map((event) => event.event_id)).toEqual(["past-idle", "answer", "later-status"]);
		expect(observed.seen[1]).toMatchObject({
			created_at: timestamp(1),
			content: [{ type: "text", text: "完整正文" }],
		});
		expect(observed.store.getSnapshot()).toMatchObject({
			phase: "idle",
			canSend: true,
			messages: [{ status: "done", parts: [{ type: "text", text: "完整正文" }] }],
		});
	});

	it.each([false, true])("历史重建保留同时间戳实时帧的已知顺序；含旧历史=%s", async (hasHistory) => {
		const wire = connection();
		const history = deferred<BailianEventsPage>();
		const historyResponse = vi.fn(async () => Response.json(await history.promise));
		const observed = observe(createBailianChatProvider(backendOptions(wire, { historyResponse })));
		await vi.waitFor(() => expect(historyResponse).toHaveBeenCalledOnce());
		wire.feed(status("running", "running", 2));
		wire.feed(message("answer", "正在输出", 2, "in_progress"));
		wire.bytes(new TextEncoder().encode("event: heartbeat\ndata: {}\n\n"));
		await vi.waitFor(() => expect(observed.pings()).toBe(1));
		history.resolve({ events: hasHistory ? [status("past-idle", "idle", 0)] : [] });
		await observed.ready;
		expect(observed.seen.map((event) => event.event_id)).toEqual([
			...(hasHistory ? ["past-idle"] : []),
			"running",
			"answer",
		]);
		expect(observed.store.getSnapshot()).toMatchObject({
			providerStatus: "running",
			phase: "running",
			canSend: false,
			messages: [{ parts: [{ text: "正在输出" }] }],
		});
	});

	it("同 ID 实时状态更新保留最新观察位置，消息快照仍保留首次展示顺序", async () => {
		const wire = connection();
		const history = deferred<BailianEventsPage>();
		const historyResponse = vi.fn(async () => Response.json(await history.promise));
		const observed = observe(createBailianChatProvider(backendOptions(wire, { historyResponse })));
		await vi.waitFor(() => expect(historyResponse).toHaveBeenCalledOnce());
		wire.feed(status("state", "running", 1));
		wire.feed({ ...message("user", "问题", 2), role: "user" });
		wire.feed(message("first", "局部正文", 3, "in_progress"));
		wire.feed(message("second", "随后内容", 4));
		wire.feed(message("first", "完整正文", 3));
		wire.feed(status("state", "idle", 1));
		wire.bytes(new TextEncoder().encode("event: heartbeat\ndata: {}\n\n"));
		await vi.waitFor(() => expect(observed.pings()).toBe(1));
		history.resolve({ events: [status("past-idle", "idle", 0)] });
		await observed.ready;
		expect(observed.store.getSnapshot()).toMatchObject({
			providerStatus: "idle",
			phase: "idle",
			canSend: true,
			messages: [
				{ role: "user", parts: [{ text: "问题" }] },
				{ role: "assistant", parts: [{ text: "完整正文随后内容" }] },
			],
		});
	});

	it("实时同 ID 状态更新仍无法定位于后续历史之前或之后时拒绝 ready", async () => {
		const wire = connection();
		const history = deferred<BailianEventsPage>();
		const historyResponse = vi.fn(async () => Response.json(await history.promise));
		const observed = observe(createBailianChatProvider(backendOptions(wire, { historyResponse })));
		await vi.waitFor(() => expect(historyResponse).toHaveBeenCalledOnce());
		wire.feed(status("buffered-state", "running", 1));
		wire.feed(status("buffered-state", "idle", 1));
		wire.bytes(new TextEncoder().encode("event: heartbeat\ndata: {}\n\n"));
		await vi.waitFor(() => expect(observed.pings()).toBe(1));
		history.resolve({ events: [status("historical-state", "running", 2)] });
		expect(await observed.outcome).toMatchObject({ retryable: false });
		expect(observed.seen).toEqual([]);
		expect(observed.store.getSnapshot().canSend).toBe(false);
	});

	it("实际 fetch Response 支持自定义 URL、鉴权和历史 envelope，原样翻页不访问 Kit 接口", async () => {
		const wire = connection();
		const cursor = "opaque+/cursor==";
		const fetchBackend = vi.fn(async (input: string, init?: RequestInit) => {
			const url = new URL(input);
			expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-business-session");
			expect(init?.signal).toBeInstanceOf(AbortSignal);
			if (url.pathname === "/v2/conversation/session/subscribe") return wire.response;
			if (url.pathname !== "/v2/conversation/session/timeline") throw new Error("Unexpected endpoint");
			const next = url.searchParams.get("continuation");
			if (next === null) {
				return Response.json({
					result: {
						records: [status("running", "running", 0), message("answer", "历史正文", 1)],
						continuation: cursor,
					},
				});
			}
			expect(next).toBe(cursor);
			return Response.json({ result: { records: [status("idle", "idle", 2)], continuation: null } });
		});
		const base = backendOptions(wire);
		const provider = createBailianChatProvider({
			...base,
			request: createRequest({
				baseUrl: "https://business.example/v2",
				headers: () => ({ Authorization: "Bearer fixture-business-session" }),
				fetchImpl: fetchBackend as typeof fetch,
			}),
			openStream: {
				buildRequest: ({ sessionId }) => ({ path: `/conversation/${sessionId}/subscribe` }),
				mapResponse: (response) => {
					// fixture 后端合同明确：该响应头只在上游订阅登记后设置。
					if (response.headers.get("X-Bailian-Subscribed") !== "true") throw new Error("Subscription not ready");
					return { response, ready: Promise.resolve() };
				},
			},
			listEvents: {
				buildRequest: ({ sessionId, pageToken }) => ({
					path: `/conversation/${sessionId}/timeline${pageToken ? `?continuation=${encodeURIComponent(pageToken)}` : ""}`,
				}),
				mapResponse: async (response) => {
					const body = (await response.json()) as {
						result: { records: Record<string, unknown>[]; continuation: string | null };
					};
					return { events: body.result.records, nextPageToken: body.result.continuation };
				},
			},
		});
		const observed = observe(provider);
		try {
			await observed.ready;
			expect(observed.seen.map((event) => event.event_id)).toEqual(["running", "answer", "idle"]);
			expect(observed.store.getSnapshot()).toMatchObject({ phase: "idle", canSend: true, lastCursor: null });
			expect(observed.store.getSnapshot().messages[0]?.parts).toMatchObject([{ text: "历史正文" }]);
			expect(fetchBackend).toHaveBeenCalledTimes(3);
			expect(fetchBackend.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
				"/v2/conversation/session/subscribe",
				"/v2/conversation/session/timeline",
				"/v2/conversation/session/timeline",
			]);
			expect(fetchBackend.mock.calls.some(([url]) => url.includes("/api/kit/"))).toBe(false);
		} finally {
			observed.abort.abort();
			await observed.outcome;
		}
		expect(wire.body.locked).toBe(false);
	});

	it("自然 EOF 后新订阅全量重建，历史和实时交叉不重复，进行中正文等待完整快照", async () => {
		const firstWire = connection();
		const secondWire = connection();
		const secondHistory = deferred<BailianEventsPage>();
		const historical = message("past", "上一轮完整正文", 0);
		const idle = status("past-idle", "idle", 1);
		const running = status("current-running", "running", 2);
		let connections = 0;
		const streamResponse = vi.fn(async () => (++connections === 1 ? firstWire.response : secondWire.response));
		const historyResponse = vi.fn(async () =>
			Response.json(connections === 1 ? { events: [historical, idle] } : await secondHistory.promise),
		);
		const provider = createBailianChatProvider(backendOptions(firstWire, { streamResponse, historyResponse }));
		const first = observe(provider);
		await first.ready;
		firstWire.feed(running);
		firstWire.feed(message("active", "", 3, "in_progress"));
		firstWire.feed(delta("active", "断线前片段"));
		await vi.waitFor(() =>
			expect(first.store.getSnapshot().messages[1]?.parts).toMatchObject([{ text: "断线前片段" }]),
		);
		firstWire.close();
		expect(await first.outcome).toMatchObject({ retryable: true, message: "事件连接意外关闭" });
		expect(firstWire.body.locked).toBe(false);
		expect(first.store.getSnapshot().phase).toBe("running");
		expect(streamResponse).toHaveBeenCalledTimes(1);

		const second = observe(provider, first.store);
		try {
			await vi.waitFor(() => expect(historyResponse).toHaveBeenCalledTimes(2));
			secondWire.feed(historical);
			secondWire.feed(idle);
			secondWire.feed(message("active", "", 3, "in_progress"));
			secondWire.feed(delta("active", "恢复后尾巴"));
			// 一个已读完整 heartbeat 证明前面的业务帧已进入重建缓冲。
			secondWire.bytes(new TextEncoder().encode("event: heartbeat\ndata: {}\n\n"));
			await vi.waitFor(() => expect(second.pings()).toBe(1));
			secondHistory.resolve({
				events: [historical, idle, running, message("active", "历史中的局部正文", 3, "in_progress")],
			});
			await second.ready;
			expect(second.resets()).toBe(1);
			expect(second.seen.map((event) => event.event_id)).toEqual(["past", "past-idle", "current-running", "active"]);
			expect(second.store.getSnapshot()).toMatchObject({ phase: "running", canSend: false, lastCursor: null });
			expect(second.store.getSnapshot().messages).toHaveLength(2);
			expect(second.store.getSnapshot().messages[1]?.parts).toMatchObject([{ text: "历史中的局部正文" }]);
			secondWire.feed(message("active", "权威完整正文", 3));
			secondWire.feed(status("current-idle", "idle", 4));
			await vi.waitFor(() => expect(second.store.getSnapshot().canSend).toBe(true));
			expect(second.store.getSnapshot().messages).toHaveLength(2);
			expect(second.store.getSnapshot().messages[1]?.parts).toMatchObject([{ text: "权威完整正文" }]);
			expect(streamResponse).toHaveBeenCalledTimes(2);
			expect(historyResponse).toHaveBeenCalledTimes(2);
		} finally {
			second.abort.abort();
			await second.outcome;
		}
		expect(secondWire.body.locked).toBe(false);
	});

	it("UTF-8 每字节分块、CRLF 与多 data 行保留正文，SSE id 不冒充业务身份或续传游标", async () => {
		const wire = connection();
		const provider = createBailianChatProvider(backendOptions(wire));
		const observed = observe(provider);
		try {
			await observed.ready;
			const payload =
				'event: message\r\nid: transport-only\r\ndata: {"object":"message","id":"business-id",\r\n' +
				'data: "type":"message","role":"assistant","status":"completed","content":[{"type":"text","text":"你好🌟"}]}\r\n\r\n';
			for (const byte of new TextEncoder().encode(payload)) wire.bytes(new Uint8Array([byte]));
			await vi.waitFor(() => expect(observed.seen).toHaveLength(1));
			expect(observed.seen[0]).toMatchObject({
				event_id: "business-id",
				content: [{ type: "text", text: "你好🌟" }],
			});
			expect(observed.store.getSnapshot().lastCursor).toBeNull();
		} finally {
			observed.abort.abort();
			await observed.outcome;
		}
	});
});
