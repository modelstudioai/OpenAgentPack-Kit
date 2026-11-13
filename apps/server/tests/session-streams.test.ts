import type { SessionEvent, SseFrame } from "@openagentpack/kit-sdk/protocol";
import { describe, expect, it, vi } from "vitest";
import { createMockGateway } from "../src/gateway/mock.ts";
import { createEventBufferRegistry } from "../src/services/event-buffer.ts";
import { createSessionStreams, readSessionHistory } from "../src/services/session-streams.ts";
import { statusMarker } from "../src/services/usage-limit-completion.ts";

const event = (id: string, text: string, completed = false): SessionEvent => ({
	event_id: id,
	type: "message",
	role: "assistant",
	content: [{ type: "text", text }],
	metadata: { event_status: completed ? "completed" : "in_progress" },
});
function latch() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}
async function untilReady(iterator: AsyncGenerator<SseFrame>) {
	const frames: SseFrame[] = [];
	for (;;) {
		const frame = await iterator.next();
		if (frame.done) throw new Error("stream ended before ready");
		frames.push(frame.value);
		if (frame.value.type === "ready") return frames;
	}
}

describe("持久 Session 订阅", () => {
	it("首条业务事件前即可 ready；多个客户端共用连接，最后退出才取消", async () => {
		const gateway = createMockGateway();
		const session = await gateway.createSession({ agentId: "a" });
		const connected = latch();
		const closed = vi.fn();
		const original = gateway.streamEvents.bind(gateway);
		gateway.streamEvents = vi.fn(async function* (id, options) {
			await connected.promise;
			try {
				yield* original(id, options);
			} finally {
				closed();
			}
		});
		const buffers = createEventBufferRegistry();
		const streams = createSessionStreams(gateway, buffers, 1000);
		const a = streams.frames(session.session_id, {});
		const b = streams.frames(session.session_id, {});
		const first = untilReady(a);
		const second = untilReady(b);
		const sent = vi.fn(async () => true);
		const sending = streams.use(session.session_id, sent);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(sent).not.toHaveBeenCalled();
		connected.release();
		await Promise.all([first, second, sending]);
		expect(sent).toHaveBeenCalledOnce();
		expect(gateway.streamEvents).toHaveBeenCalledOnce();
		await a.return(undefined);
		expect(closed).not.toHaveBeenCalled();
		await b.return(undefined);
		await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
		expect(buffers.size()).toBe(0);
	});

	it("全分页历史与实时交叉，完成快照不会被迟到部分降级", async () => {
		const gateway = createMockGateway();
		const session = await gateway.createSession({ agentId: "a" });
		const historyGate = latch();
		gateway.listEvents = vi.fn(async (_id, options) => {
			if (!options?.pageToken) {
				await historyGate.promise;
				return { events: [event("same", "你好", true)], next_page_token: "opaque-token" };
			}
			return { events: [event("second", "第二页", true)], next_page_token: null };
		});
		gateway.streamEvents = async function* (_id, options) {
			options?.onReady?.();
			yield event("same", "你");
			historyGate.release();
			await new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve(), { once: true }));
		};
		const streams = createSessionStreams(gateway, createEventBufferRegistry(), 1000);
		const iterator = streams.frames(session.session_id, {});
		const frames = await untilReady(iterator);
		expect(frames.map((frame) => frame.type)).toEqual(["reset", "event", "event", "ready"]);
		expect(frames.filter((frame) => frame.type === "event").map((frame) => frame.data.content)).toEqual([
			[{ type: "text", text: "你好" }],
			[{ type: "text", text: "第二页" }],
		]);
		expect(gateway.listEvents).toHaveBeenLastCalledWith(
			session.session_id,
			expect.objectContaining({ pageToken: "opaque-token" }),
		);
		await iterator.return(undefined);
	});

	it("运行中最后订阅者离开后继续跟踪，终态回写并释放上游", async () => {
		const gateway = createMockGateway();
		const session = await gateway.createSession({ agentId: "a" });
		const status = (id: string, value: string): SessionEvent => ({
			event_id: id,
			type: "session_status",
			metadata: { status: value },
		});
		gateway.listEvents = async () => ({ events: [status("s0", "running")], next_page_token: null });
		const terminal = latch();
		const closed = vi.fn();
		gateway.streamEvents = async function* (_id, options) {
			try {
				options?.onReady?.();
				yield status("s1", "running");
				await terminal.promise;
				yield status("s2", "idle");
			} finally {
				closed();
			}
		};
		const buffers = createEventBufferRegistry();
		const statuses: string[] = [];
		const streams = createSessionStreams(gateway, buffers, 1000, {
			onStatus: (_sessionId, value) => statuses.push(value),
		});
		const iterator = streams.frames(session.session_id, {});
		await untilReady(iterator);
		await iterator.return(undefined);
		expect(closed).not.toHaveBeenCalled();
		expect(streams.isTracking(session.session_id)).toBe(true);
		terminal.release();
		await vi.waitFor(() => expect(statuses.at(-1)).toBe("idle"));
		await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
		expect(streams.isTracking(session.session_id)).toBe(false);
		expect(buffers.size()).toBe(0);
	});

	it("pending turn 重放相同旧 idle 不提前释放，真实终态到达后才释放", async () => {
		const gateway = createMockGateway();
		const session = await gateway.createSession({ agentId: "a" });
		const status = (id: string, value: string): SessionEvent => ({
			event_id: id,
			type: "session_status",
			metadata: { status: value, stop_reason: { type: "completed" } },
		});
		gateway.listEvents = async () => ({ events: [status("shared", "idle")], next_page_token: null });
		const stale = latch();
		const running = latch();
		const finished = latch();
		gateway.streamEvents = async function* (_id, options) {
			options?.onReady?.();
			await stale.promise;
			yield status("shared", "idle");
			await running.promise;
			yield status("shared", "running");
			await finished.promise;
			yield status("shared", "idle");
		};
		const buffers = createEventBufferRegistry();
		const onStatus = vi.fn();
		const streams = createSessionStreams(gateway, buffers, 1000, { onStatus });
		const iterator = streams.frames(session.session_id, {});
		await untilReady(iterator);
		const buffer = buffers.ensure(session.session_id);
		streams.acceptTurn(session.session_id, {
			eventIds: ["cm-detached"],
			previousStatus: statusMarker(buffer.latestStatus, buffer),
			clientMessageId: "cm-detached",
			knownUserIds: new Set(),
			after: buffer.events.length,
			sequence: buffer.sequence + 1,
		});
		await iterator.return(undefined);
		stale.release();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(streams.isTracking(session.session_id)).toBe(true);
		running.release();
		finished.release();
		await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith(session.session_id, "idle"));
		expect(streams.isTracking(session.session_id)).toBe(false);
		expect(buffers.size()).toBe(0);
	});

	it("意外 EOF 是 error，不能伪造 done；初始化失败不执行 POST", async () => {
		const gateway = createMockGateway();
		const session = await gateway.createSession({ agentId: "a" });
		gateway.streamEvents = async function* (_id, options) {
			options?.onReady?.();
			yield event("a", "partial");
		};
		const streams = createSessionStreams(gateway, createEventBufferRegistry(), 10);
		const frames: SseFrame[] = [];
		for await (const frame of streams.frames(session.session_id, {})) frames.push(frame);
		expect(frames.some((frame) => frame.type === "error" && frame.data.retryable)).toBe(true);
		expect(frames.some((frame) => frame.type === "done")).toBe(false);
		const send = vi.fn(async () => true);
		await expect(streams.use(session.session_id, send)).rejects.toMatchObject({ code: "provider_error" });
		expect(send).not.toHaveBeenCalled();
	});

	it("同 ID 缓冲状态与历史无版本证据时拒绝 ready 和发送", async () => {
		const gateway = createMockGateway();
		const session = await gateway.createSession({ agentId: "a" });
		const read = latch();
		const status = (value: string): SessionEvent => ({
			event_id: "status",
			type: "session_status",
			metadata: { event_status: "completed", status: value },
		});
		gateway.listEvents = async () => {
			await read.promise;
			return { events: [status("running")], next_page_token: null };
		};
		gateway.streamEvents = async function* (_id, options) {
			options?.onReady?.();
			yield status("idle");
			read.release();
			await new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve(), { once: true }));
		};
		const streams = createSessionStreams(gateway, createEventBufferRegistry(), 1000);
		const iterator = streams.frames(session.session_id, {});
		const first = iterator.next();
		const send = vi.fn(async () => true);
		const rejected = expect(streams.use(session.session_id, send)).rejects.toMatchObject({ code: "provider_error" });
		expect((await first).value).toMatchObject({ type: "error", data: { retryable: false } });
		await rejected;
		expect(send).not.toHaveBeenCalled();
		expect((await iterator.next()).done).toBe(true);
	});

	it("缓冲中的明确完成快照可推进未完成历史并允许发送", async () => {
		const gateway = createMockGateway();
		const session = await gateway.createSession({ agentId: "a" });
		const read = latch();
		gateway.listEvents = async () => {
			await read.promise;
			return { events: [event("answer", "局部")], next_page_token: null };
		};
		gateway.streamEvents = async function* (_id, options) {
			options?.onReady?.();
			yield event("answer", "局部扩展");
			yield event("answer", "完整正文", true);
			read.release();
			await new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve(), { once: true }));
		};
		const streams = createSessionStreams(gateway, createEventBufferRegistry(), 1000);
		const iterator = streams.frames(session.session_id, {});
		const frames = await untilReady(iterator);
		expect(frames.filter((frame) => frame.type === "event").map((frame) => frame.data.content)).toEqual([
			[{ type: "text", text: "完整正文" }],
		]);
		const send = vi.fn(async () => true);
		await expect(streams.use(session.session_id, send)).resolves.toBe(true);
		expect(send).toHaveBeenCalledOnce();
		await iterator.return(undefined);
	});

	it("停止订阅可取消首帧前的连接等待", async () => {
		const gateway = createMockGateway();
		const session = await gateway.createSession({ agentId: "a" });
		let wasAborted = false;
		gateway.streamEvents = async function* (_id, options) {
			await new Promise<void>((resolve) =>
				options?.signal?.addEventListener(
					"abort",
					() => {
						wasAborted = true;
						resolve();
					},
					{ once: true },
				),
			);
		};
		const streams = createSessionStreams(gateway, createEventBufferRegistry(), 10);
		const controller = new AbortController();
		const next = streams.frames(session.session_id, { signal: controller.signal }).next();
		await new Promise((resolve) => setTimeout(resolve, 0));
		controller.abort();
		expect((await next).done).toBe(true);
		expect(wasAborted).toBe(true);
	});

	it("初始化期间取消释放缓存，迟到的历史结果不能重建正文", async () => {
		const gateway = createMockGateway();
		const session = await gateway.createSession({ agentId: "a" });
		const reading = latch();
		const finish = latch();
		gateway.listEvents = async () => {
			reading.release();
			await finish.promise;
			return { events: [event("late", "不应留存")], next_page_token: null };
		};
		const buffers = createEventBufferRegistry();
		const abort = new AbortController();
		const iterator = createSessionStreams(gateway, buffers, 1000).frames(session.session_id, { signal: abort.signal });
		const first = iterator.next();
		await reading.promise;
		abort.abort();
		expect((await first).done).toBe(true);
		finish.release();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(buffers.size()).toBe(0);
	});

	it("重复分页游标拒绝回放，不能无界循环", async () => {
		const gateway = createMockGateway();
		gateway.listEvents = vi.fn(async () => ({ events: [], next_page_token: "same" }));
		await expect(readSessionHistory(gateway, "s")).rejects.toMatchObject({ code: "provider_error" });
		expect(gateway.listEvents).toHaveBeenCalledTimes(2);
	});
});

describe("恢复与资源边界", () => {
	it("实时会话终止事件回传后正常结束，idle Turn 则继续订阅", async () => {
		const gateway = createMockGateway();
		const session = await gateway.createSession({ agentId: "a" });
		const terminate = latch();
		gateway.streamEvents = async function* (_id, options) {
			options?.onReady?.();
			await terminate.promise;
			yield { event_id: "end", type: "session_status", metadata: { status: "terminated" } };
		};
		const streams = createSessionStreams(gateway, createEventBufferRegistry(), 1000);
		const iterator = streams.frames(session.session_id, {});
		await untilReady(iterator);
		terminate.release();
		expect((await iterator.next()).value?.type).toBe("event");
		expect((await iterator.next()).value?.type).toBe("done");
		expect((await iterator.next()).done).toBe(true);
	});

	it.each([{ statusCode: 401 }, { statusCode: 403 }, { name: "UserError" }, { code: "BAILIAN_EVENT_PROTOCOL_ERROR" }])(
		"鉴权/参数/协议错误不要求客户端重试：%j",
		async (failure) => {
			const gateway = createMockGateway();
			const session = await gateway.createSession({ agentId: "a" });
			gateway.streamEvents = () => ({
				[Symbol.asyncIterator]() {
					return {
						next: async () => {
							throw Object.assign(new Error("secret-provider-body"), failure);
						},
					};
				},
			});
			const frames: SseFrame[] = [];
			for await (const frame of createSessionStreams(gateway, createEventBufferRegistry(), 1000).frames(
				session.session_id,
				{},
			))
				frames.push(frame);
			expect(frames).toEqual([
				{
					type: "error",
					data: { code: "provider_error", message: "上游事件连接被拒绝或协议不兼容", retryable: false },
				},
			]);
		},
	);

	it("reset 回放中断后仍完整回放；缓存最新快照的序号不影响原子替换", async () => {
		const gateway = createMockGateway();
		const session = await gateway.createSession({ agentId: "a" });
		const buffers = createEventBufferRegistry();
		const streams = createSessionStreams(gateway, buffers, 1000);
		const keeper = streams.frames(session.session_id, {});
		await untilReady(keeper);
		buffers.append(session.session_id, event("a", "你"));
		buffers.append(session.session_id, event("b", "其他"));
		buffers.append(session.session_id, event("a", "你好", true));
		const interrupted = streams.frames(session.session_id, { after: "expired:1" });
		expect((await interrupted.next()).value?.type).toBe("reset");
		expect((await interrupted.next()).value?.type).toBe("event");
		await interrupted.return(undefined);
		const resumed = streams.frames(session.session_id, { after: "expired:1" });
		const frames = await untilReady(resumed);
		expect(frames.filter((frame) => frame.type === "event").map((frame) => frame.data.event_id)).toEqual(["a", "b"]);
		expect(frames.at(-1)).toMatchObject({ type: "ready", data: { cursor: buffers.cursor(session.session_id) } });
		await resumed.return(undefined);
		await keeper.return(undefined);
	});

	it("慢消费者队列超过 8MiB 后明确断开并要求重建", async () => {
		const gateway = createMockGateway();
		const session = await gateway.createSession({ agentId: "a" });
		const buffers = createEventBufferRegistry();
		const iterator = createSessionStreams(gateway, buffers, 1000).frames(session.session_id, {});
		await untilReady(iterator);
		buffers.append(session.session_id, event("huge", "a".repeat(8 * 1024 * 1024)));
		expect((await iterator.next()).value).toMatchObject({ type: "error", data: { retryable: true } });
		await iterator.return(undefined);
	});
});

describe("索引状态回调", () => {
	it("live 事件按归一词表回调：running 进、idle 收，失败回合回调 failed", async () => {
		const gateway = createMockGateway();
		const session = await gateway.createSession({ agentId: "a" });
		const onStatus = vi.fn();
		const streams = createSessionStreams(gateway, createEventBufferRegistry(), 1000, { onStatus });
		const iterator = streams.frames(session.session_id, {});
		await untilReady(iterator);
		await gateway.sendMessage(session.session_id, { text: "你好" });
		await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith(session.session_id, "idle"));
		expect(onStatus).toHaveBeenNthCalledWith(1, session.session_id, "running");

		await gateway.sendMessage(session.session_id, { text: "这次请失败" });
		await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith(session.session_id, "failed"));
		await iterator.return(undefined);
	});

	// 远端会话不存在时 running 永远不会收敛：初始化失败即回正为 idle，否则侧栏会一直转圈。
	it("Provider 明确会话不存在时把滞留索引回正为 idle", async () => {
		const gateway = createMockGateway();
		const onStatus = vi.fn();
		const streams = createSessionStreams(gateway, createEventBufferRegistry(), 1000, { onStatus });
		const frames: SseFrame[] = [];
		for await (const frame of streams.frames("missing-session", {})) frames.push(frame);
		expect(frames[0]).toMatchObject({ type: "error", data: { code: "not_found" } });
		expect(onStatus).toHaveBeenCalledWith("missing-session", "idle");
	});

	it("审批挂起回调 requires_action", async () => {
		const gateway = createMockGateway();
		const session = await gateway.createSession({ agentId: "a" });
		const onStatus = vi.fn();
		const streams = createSessionStreams(gateway, createEventBufferRegistry(), 1000, { onStatus });
		const iterator = streams.frames(session.session_id, {});
		await untilReady(iterator);
		await gateway.sendMessage(session.session_id, { text: "需要审批的操作" });
		await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith(session.session_id, "requires_action"));
		await iterator.return(undefined);
	});

	it("水合回正索引：无人订阅期间收敛的回合以历史终态回调一次", async () => {
		const gateway = createMockGateway();
		const session = await gateway.createSession({ agentId: "a" });
		await gateway.sendMessage(session.session_id, { text: "你好" });
		await vi.waitFor(async () => {
			expect((await gateway.getSession(session.session_id))?.status).toBe("idle");
		});
		const onStatus = vi.fn();
		const streams = createSessionStreams(gateway, createEventBufferRegistry(), 1000, { onStatus });
		const iterator = streams.frames(session.session_id, {});
		await untilReady(iterator);
		await vi.waitFor(() => expect(onStatus).toHaveBeenCalledTimes(1));
		expect(onStatus).toHaveBeenCalledWith(session.session_id, "idle");
		await iterator.return(undefined);
	});

	it("移除态（terminated）不回调索引状态，删除与归档由显式 mutations 落库", async () => {
		const gateway = createMockGateway();
		const session = await gateway.createSession({ agentId: "a" });
		const terminate = latch();
		gateway.streamEvents = async function* (_id, options) {
			options?.onReady?.();
			await terminate.promise;
			yield { event_id: "end", type: "session_status", metadata: { status: "terminated" } };
		};
		const onStatus = vi.fn();
		const streams = createSessionStreams(gateway, createEventBufferRegistry(), 1000, { onStatus });
		const iterator = streams.frames(session.session_id, {});
		await untilReady(iterator);
		terminate.release();
		expect((await iterator.next()).value?.type).toBe("event");
		expect((await iterator.next()).value?.type).toBe("done");
		expect(onStatus).not.toHaveBeenCalled();
	});
});
