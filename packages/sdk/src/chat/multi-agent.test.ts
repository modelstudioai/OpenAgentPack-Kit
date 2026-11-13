import { describe, expect, it, vi } from "vitest";
import type { EventsPage, SessionEvent, SessionThreadSummary } from "../protocol/index.ts";
import type { ChatProvider, StreamSessionOptions } from "../providers/contract.ts";
import { createChatController } from "./controller.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
const summary = (id = "sthr_child"): SessionThreadSummary => ({
	id,
	session_id: "s1",
	parent_thread_id: "thrd_main",
	agent: { id: "agent", name: "Research" },
	status: "running",
	created_at: "2026-10-28T00:00:00Z",
	updated_at: "2026-10-28T00:00:00Z",
});
const event = (id: string, text: string, thread = "sthr_child", status = "completed"): SessionEvent => ({
	event_id: id,
	created_at: id === "old" ? "2026-10-28T00:00:01Z" : "2026-10-28T00:00:02Z",
	type: "message",
	role: "assistant",
	metadata: { thread_id: thread, event_status: status },
	content: [{ type: "text", text }],
});
function fixture(extra: Partial<ChatProvider> = {}) {
	let handlers: StreamSessionOptions = {};
	const provider: ChatProvider = {
		stream: vi.fn(async (_id, options = {}) => {
			handlers = options;
			await new Promise<void>((resolve) => options.signal?.addEventListener("abort", () => resolve(), { once: true }));
		}),
		sendMessage: async () => ({ session_id: "s1", accepted: true, event_ids: [] }),
		interrupt: async () => ({ interrupted: true }),
		toolApprovals: async () => ({ requires_action: false, batch_id: null, pending_call_ids: [], requests: [] }),
		submitToolApproval: async () => ({ session_id: "s1", accepted: true, event_ids: [] }),
		...extra,
	};
	const controller = createChatController(provider, "s1");
	const connected = controller.connect();
	handlers.onReady?.({ sessionId: "s1", replayed: 0, cursor: "epoch:1" });
	return { controller, provider, connected, handlers, view: () => controller.getSnapshot().multiAgent };
}
const parts = (events: ReturnType<typeof fixture>["view"]) => partsText(events().threads[0]?.messages ?? []);
function partsText(messages: import("../messages/types.ts").ChatMessage[]) {
	return messages.flatMap((message) => message.parts.filter((part) => part.type === "text").map((part) => part.text));
}

describe("native multi-agent controller", () => {
	it("主 thrd 归主列表，引用目标只发现子 Agent，同 Agent 的两个线程独立", async () => {
		const f = fixture({
			listThreads: async () => ({ data: [summary(), summary("sthr_second")], next_page_token: null }),
		});
		await f.connected;
		await tick();
		f.handlers.onEvent?.(
			{
				...event("main", "main", "thrd_main"),
				metadata: {
					thread_id: "thrd_main",
					session_thread_id: "sthr_child",
					to_session_thread_id: "sthr_child",
					to_agent_name: "Event name",
				},
			},
			"epoch:2",
		);
		f.handlers.onEvent?.(event("one", "child"), "epoch:3");
		f.handlers.onEvent?.(event("two", "second", "sthr_second"), "epoch:4");
		await tick();
		expect(partsText(f.controller.getSnapshot().messages)).toEqual(["main"]);
		expect(f.view().threads.map((t) => [t.id, t.name])).toEqual([
			["sthr_child", "Event name"],
			["sthr_second", "Research"],
		]);
		expect(parts(f.view)).toEqual(["child"]);
		expect(f.view().threads[0]?.historyAvailable).toBe(false);
		f.controller.dispose();
	});
	it("thread_created 只在主流渲染子 Agent 卡，子线程自身时间线不重复消费", async () => {
		const f = fixture({ listThreads: async () => ({ data: [summary()], next_page_token: null }) });
		await f.connected;
		await tick();
		f.handlers.onEvent?.(
			{
				event_id: "spawn",
				type: "thread_created",
				created_at: "2026-10-28T00:00:00Z",
				metadata: { thread_id: "sthr_child", session_thread_id: "sthr_child" },
				content: [
					{ type: "data", data: { session_thread_id: "sthr_child", agent_name: "Research", status: "running" } },
				],
			},
			"epoch:2",
		);
		f.handlers.onEvent?.(event("one", "child"), "epoch:3");
		await tick();
		const main = f.controller.getSnapshot().messages;
		expect(main.some((m) => m.parts.some((p) => p.type === "sub-agent"))).toBe(true);
		expect(partsText(main)).toEqual([]);
		expect(f.view().threads[0]?.messages.some((m) => m.parts.some((p) => p.type === "sub-agent"))).toBe(false);
		expect(parts(f.view)).toEqual(["child"]);
		f.controller.dispose();
	});
	it("卡头任务摘要取主 Agent 派发文本，展示名去掉 Agents/ 前缀", async () => {
		const f = fixture({ listThreads: async () => ({ data: [summary()], next_page_token: null }) });
		await f.connected;
		await tick();
		f.handlers.onEvent?.(
			{
				event_id: "spawn",
				type: "thread_created",
				created_at: "2026-10-28T00:00:00Z",
				metadata: { thread_id: "sthr_child", session_thread_id: "sthr_child" },
				content: [
					{
						type: "data",
						data: { session_thread_id: "sthr_child", agent_name: "Agents/template_01M5", status: "running" },
					},
				],
			},
			"epoch:2",
		);
		f.handlers.onEvent?.(
			{
				event_id: "dispatch",
				type: "thread_message_sent",
				created_at: "2026-10-28T00:00:01Z",
				metadata: { thread_id: "sthr_child", session_thread_id: "sthr_child" },
				content: [{ type: "text", text: "调研多 Agent 协作要点" }],
			},
			"epoch:3",
		);
		// 子 Agent 自己的协作回执（from 不是 coordinator）不改写任务摘要。
		f.handlers.onEvent?.(
			{
				event_id: "reply-note",
				type: "thread_message_received",
				created_at: "2026-10-28T00:00:02Z",
				metadata: { thread_id: "sthr_child", session_thread_id: "sthr_child", from_agent_name: "Agents/template_01M5" },
				content: [{ type: "text", text: "收到，开始执行" }],
			},
			"epoch:4",
		);
		await tick();
		expect(f.view().threads[0]).toMatchObject({ name: "template_01M5", task: "调研多 Agent 协作要点" });
		f.controller.dispose();
	});
	it("回合收尾兜底拉摘要：子线程未发 thread_status 也能转为完成并带结束时间", async () => {
		const listing = vi
			.fn<NonNullable<ChatProvider["listThreads"]>>()
			.mockResolvedValueOnce({ data: [summary()], next_page_token: null })
			.mockResolvedValueOnce({
				data: [{ ...summary(), status: "idle", updated_at: "2026-10-28T00:01:00Z" }],
				next_page_token: null,
			});
		const f = fixture({ listThreads: listing });
		await f.connected;
		await tick();
		f.handlers.onEvent?.(
			{
				event_id: "spawn",
				type: "thread_created",
				created_at: "2026-10-28T00:00:00Z",
				metadata: { thread_id: "sthr_child", session_thread_id: "sthr_child" },
				content: [
					{ type: "data", data: { session_thread_id: "sthr_child", agent_name: "Research", status: "running" } },
				],
			},
			"epoch:2",
		);
		await tick();
		expect(f.view().threads[0]?.status).toBe("running");
		f.handlers.onEvent?.({
			event_id: "turn-end",
			type: "session_status",
			created_at: "2026-10-28T00:01:00Z",
			metadata: { status: "idle" },
			content: [{ type: "data", data: { session_status: "idle" } }],
		});
		await tick();
		expect(f.view().threads[0]).toMatchObject({ status: "idle", endedAt: "2026-10-28T00:01:00Z" });
		expect(listing).toHaveBeenCalledTimes(2);
		f.controller.dispose();
	});
	it("历史与实时同 ID 交叉只保留新快照，历史查询不改主审批、phase、cursor", async () => {
		const page = deferred<EventsPage>();
		const f = fixture({
			listThreads: async () => ({ data: [summary()], next_page_token: null }),
			listThreadEvents: () => page.promise,
		});
		await f.connected;
		await tick();
		f.view().selectThread("sthr_child");
		f.handlers.onEvent?.(event("answer", "live final", "sthr_child"), "epoch:5");
		f.controller.store.setApprovals({ requires_action: true, batch_id: "b", pending_call_ids: ["c"], requests: [] });
		const main = f.controller.getSnapshot();
		page.resolve({ data: [event("answer", "old partial", "sthr_child", "in_progress")], next_page_token: null });
		await tick();
		expect(parts(f.view)).toEqual(["live final"]);
		expect(f.controller.getSnapshot()).toMatchObject({
			phase: main.phase,
			lastCursor: "epoch:5",
			approvals: main.approvals,
		});
		f.controller.dispose();
	});
	it("同秒较早分页按游标前插，重新选择刷新最新页时保留旧页和游标", async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce({ data: [event("new", "latest")], next_page_token: "older" })
			.mockResolvedValueOnce({
				data: [{ ...event("old", "earlier"), created_at: "2026-10-28T00:00:02Z" }],
				next_page_token: "oldest",
			})
			.mockResolvedValueOnce({ data: [event("new", "updated")], next_page_token: "older" });
		const f = fixture({
			listThreads: async () => ({ data: [summary()], next_page_token: null }),
			listThreadEvents: request,
		});
		await tick();
		f.view().selectThread("sthr_child");
		await tick();
		await f.view().loadThreadEvents("sthr_child", { more: true });
		expect(parts(f.view).join("\n")).toContain("earlier");
		f.view().selectThread(null);
		f.view().selectThread("sthr_child");
		await tick();
		expect(parts(f.view).join("")).toBe("earlierupdated");
		expect(f.view().threads[0]?.nextPageToken).toBe("oldest");
		expect(request.mock.calls[1]?.[2]).toMatchObject({ pageToken: "older" });
		expect(f.provider.stream).toHaveBeenCalledOnce();
		f.controller.dispose();
	});
	it("reset 取消线程请求并清除补充历史，迟到响应不能复活被撤回事件", async () => {
		const page = deferred<EventsPage>();
		const request = vi.fn<NonNullable<ChatProvider["listThreadEvents"]>>(() => page.promise);
		const f = fixture({
			listThreads: async () => ({ data: [summary()], next_page_token: null }),
			listThreadEvents: request,
		});
		await tick();
		f.view().selectThread("sthr_child");
		f.handlers.onReset?.();
		expect(request.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
		f.handlers.onReady?.({ sessionId: "s1", replayed: 0, cursor: "new:0" });
		f.controller.dispose();
		page.resolve({ data: [event("retracted", "stale")], next_page_token: null });
		await tick();
		expect(f.view().threads.every((t) => t.messages.length === 0)).toBe(true);
	});
	it("拒绝错属事件并允许重试；循环分页不能伪装历史完成", async () => {
		const request = vi
			.fn<NonNullable<ChatProvider["listThreadEvents"]>>()
			.mockResolvedValueOnce({ data: [event("foreign", "private", "sthr_other")], next_page_token: null })
			.mockResolvedValueOnce({ data: [event("owned", "visible")], next_page_token: "same" })
			.mockResolvedValueOnce({ data: [event("older", "never applied")], next_page_token: "same" })
			.mockResolvedValueOnce({ data: [event("old", "earlier")], next_page_token: null });
		const f = fixture({
			listThreads: async () => ({ data: [summary()], next_page_token: null }),
			listThreadEvents: request,
		});
		await tick();
		f.view().selectThread("sthr_child");
		await tick();
		expect(f.view().threads[0]).toMatchObject({ loaded: false, error: "事件不属于所选子 Agent", messages: [] });
		await f.view().loadThreadEvents("sthr_child");
		expect(parts(f.view)).toEqual(["visible"]);
		await f.view().loadThreadEvents("sthr_child", { more: true });
		expect(f.view().threads[0]).toMatchObject({ nextPageToken: "same", error: "子 Agent 事件分页游标重复" });
		expect(parts(f.view)).toEqual(["visible"]);
		await f.view().loadThreadEvents("sthr_child", { retry: true });
		expect(request.mock.calls[3]?.[2]?.pageToken).toBe("same");
		expect(parts(f.view).join("")).toBe("earliervisible");
		f.controller.dispose();
	});
	it("不重叠的历史按创建时间置于较新实时事件前，缺少顺序依据时保留原消息并报错", async () => {
		const request = vi
			.fn<NonNullable<ChatProvider["listThreadEvents"]>>()
			.mockResolvedValueOnce({ data: [event("old", "earlier")], next_page_token: null })
			.mockResolvedValueOnce({
				data: [{ ...event("unknown", "ambiguous"), created_at: undefined }],
				next_page_token: null,
			});
		const f = fixture({ listThreadEvents: request });
		f.handlers.onEvent?.(event("new", "later"));
		f.view().selectThread("sthr_child");
		await tick();
		expect(parts(f.view).join("")).toBe("earlierlater");
		await f.view().loadThreadEvents("sthr_child");
		expect(f.view().threads[0]?.error).toContain("缺少可验证的顺序");
		expect(parts(f.view).join("")).toBe("earlierlater");
		f.controller.dispose();
	});
	it("新摘要更新旧状态，查询期间的实时状态优先，最新历史可补无摘要状态", async () => {
		const list = deferred<{ data: SessionThreadSummary[]; next_page_token: null }>();
		const listing = vi
			.fn<NonNullable<ChatProvider["listThreads"]>>()
			.mockResolvedValueOnce({ data: [summary()], next_page_token: null })
			.mockResolvedValueOnce({ data: [{ ...summary(), status: "idle" }], next_page_token: null })
			.mockImplementationOnce(() => list.promise);
		const f = fixture({ listThreads: listing });
		await tick();
		const status: SessionEvent = {
			event_id: "status",
			type: "thread_status",
			created_at: "2026-10-28T00:00:02Z",
			metadata: { thread_id: "sthr_child" },
			content: [{ type: "data", data: { status: "running" } }],
		};
		f.handlers.onEvent?.(status);
		await f.view().refreshThreads();
		expect(f.view().threads[0]?.status).toBe("idle");
		const refreshing = f.view().refreshThreads();
		f.handlers.onEvent?.(status);
		list.resolve({ data: [{ ...summary(), status: "idle" }], next_page_token: null });
		await refreshing;
		expect(f.view().threads[0]?.status).toBe("running");
		f.controller.dispose();
		const g = fixture({
			listThreadEvents: async () => ({
				data: [{ ...status, content: [{ type: "data", data: { status: "idle" } }] }],
				next_page_token: null,
			}),
		});
		g.handlers.onEvent?.(status);
		g.view().selectThread("sthr_child");
		await tick();
		expect(g.view().threads[0]?.status).toBe("idle");
		expect(g.view().threads[0]?.messages).toEqual([]);
		g.controller.dispose();
	});
	it("旧 ready 查询在 reset 取消后完成，不清除新一轮回放的子 Agent 选择", async () => {
		const listing = vi
			.fn<NonNullable<ChatProvider["listThreads"]>>()
			.mockImplementationOnce(
				(_id, options) =>
					new Promise((_resolve, reject) => {
						options?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
					}),
			)
			.mockResolvedValue({ data: [summary()], next_page_token: null });
		const f = fixture({ listThreads: listing });
		f.handlers.onEvent?.(event("before", "before reset"));
		f.view().selectThread("sthr_child");
		expect(f.view().selectedThreadId).toBe("sthr_child");
		f.handlers.onReset?.();
		expect(listing.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
		// 等旧列表 catch/finally 与 ready.then 完成，此时新回放的线程集合仍为空。
		await tick();
		f.handlers.onEvent?.(event("after", "after reset"));
		f.handlers.onReady?.({ sessionId: "s1", replayed: 1, cursor: "new:1" });
		await tick();
		expect(f.view().selectedThreadId).toBe("sthr_child");
		expect(parts(f.view)).toEqual(["after reset"]);
		expect(listing).toHaveBeenCalledTimes(2);
		f.controller.dispose();
	});
});
