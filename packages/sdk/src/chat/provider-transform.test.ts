import { describe, expect, it } from "vitest";
import {
	type ChatMessage,
	type MessageTransformer,
	type MessageTransformInput,
	transformSessionEvent,
} from "../messages/index.ts";
import { KitError, type SessionEvent } from "../protocol/index.ts";
import type { ChatProvider, StreamSessionOptions } from "../providers/index.ts";
import { createChatController } from "./index.ts";

type DisplayProvider = ChatProvider & { label: string };

function fixture(transformMessage: MessageTransformer) {
	const connections: { sessionId: string; options: StreamSessionOptions; fail: (error: unknown) => void }[] = [];
	const provider: DisplayProvider = {
		label: "custom",
		transformMessage,
		stream: (sessionId, options = {}) =>
			new Promise<void>((resolve, reject) => {
				connections.push({ sessionId, options, fail: reject });
				options.signal?.addEventListener("abort", () => resolve(), { once: true });
			}),
		sendMessage: async (sessionId) => ({ session_id: sessionId, accepted: true, event_ids: [] }),
		interrupt: async () => ({ interrupted: true }),
		toolApprovals: async () => ({ requires_action: false, batch_id: null, pending_call_ids: [], requests: [] }),
		submitToolApproval: async (sessionId) => ({ session_id: sessionId, accepted: true, event_ids: [] }),
	};
	function connection(sessionId: string) {
		const current = connections.findLast((entry) => entry.sessionId === sessionId);
		if (!current) throw new Error(`No subscription for ${sessionId}`);
		return current;
	}
	return {
		provider,
		connections,
		connection,
		ready: (sessionId: string, cursor: string | null = null) =>
			connection(sessionId).options.onReady?.({ sessionId, replayed: 0, cursor }),
		event: (sessionId: string, event: SessionEvent, cursor?: string) =>
			connection(sessionId).options.onEvent?.(event, cursor),
		reset: (sessionId: string) => connection(sessionId).options.onReset?.(),
	};
}

const message = (eventId: string, text: string, thread?: string): SessionEvent => ({
	event_id: eventId,
	type: "message",
	role: "assistant",
	content: [{ type: "text", text }],
	...(thread ? { metadata: { session_thread_id: thread } } : {}),
});
const texts = (messages: ChatMessage[]) =>
	messages.flatMap((item) => item.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])));

/** 返回新的数组与消息对象，验证 Chat 消费 Provider 返回值而非只依赖原地修改。 */
const uppercase: MessageTransformer = (input) => {
	const result = transformSessionEvent(input);
	return {
		...result,
		messages: result.messages.map((item) => ({
			...item,
			parts: item.parts.map((part) =>
				item.role === "assistant" && part.type === "text" ? { ...part, text: part.text.toUpperCase() } : part,
			),
		})),
	};
};

describe("Provider message transformation through ChatController", () => {
	it("展示 Provider 返回的替代消息和产物，方法上下文与事件事实相互隔离", async () => {
		const f = fixture(function (this: DisplayProvider, input: MessageTransformInput) {
			const result = transformSessionEvent(input);
			if (input.event.type === "session_status" && input.event.metadata) input.event.metadata.status = "idle";
			if (input.event.type !== "message") return result;
			return {
				messages: result.messages.map((item) => ({
					...item,
					parts: item.parts.map((part) =>
						part.type === "text" ? { ...part, text: `${this.label}: ${part.text}` } : part,
					),
				})),
				artifacts: [{ file_id: "custom-file", filename: this.label }],
			};
		});
		const controller = createChatController(f.provider, "s1");
		try {
			const connected = controller.connect();
			f.ready("s1");
			await connected;
			f.event("s1", message("answer", "hello"));
			f.event("s1", { event_id: "status", type: "session_status", metadata: { status: "running" } });
			// 新投影必须继续读取原始 running；转换器改写自己的 event 不能改动私有 ledger。
			f.event("s1", { event_id: "tool", type: "tool_call", metadata: { call_id: "call", tool_name: "search" } });
			expect(texts(controller.getSnapshot().messages)).toEqual(["custom: hello"]);
			expect(controller.getSnapshot()).toMatchObject({
				phase: "running",
				canSend: false,
				artifacts: [{ file_id: "custom-file", filename: "custom" }],
			});
			f.event("s1", { event_id: "status", type: "session_status", metadata: { status: "idle" } });
			expect(controller.getSnapshot()).toMatchObject({ phase: "idle", canSend: true });
		} finally {
			controller.dispose();
		}
	});

	it("自定义转换仍按最新快照重建，回放交叉与 after 续传不追加旧正文", async () => {
		const f = fixture(uppercase);
		const controller = createChatController(f.provider, "s1", {
			backoff: { baseMs: 1, maxMs: 1, jitter: 0, maxAttempts: 1 },
		});
		try {
			const connected = controller.connect();
			f.event("s1", message("a", "hello"), "epoch:1");
			f.ready("s1", "epoch:1");
			await connected;
			const first = controller.getSnapshot();
			const firstMessage = first.messages[0];
			expect(firstMessage?.parts[0]?.id).toBeTruthy();
			f.event("s1", message("a", "hello"), "epoch:1");
			f.event("s1", message("a", "hello world"), "epoch:2");
			const updated = controller.getSnapshot().messages[0];
			expect(texts(controller.getSnapshot().messages)).toEqual(["HELLO WORLD"]);
			expect(updated?.id).toBe(firstMessage?.id);
			expect(updated?.parts[0]?.id).toBe(firstMessage?.parts[0]?.id);
			expect(texts(first.messages)).toEqual(["HELLO"]);

			f.connection("s1").fail(new KitError("provider_error", "disconnected", { retryable: true }));
			await expect.poll(() => f.connections.length).toBe(2);
			expect(f.connection("s1").options.after).toBe("epoch:2");
			f.reset("s1");
			f.event("s1", message("a", "hello world"), "epoch:2");
			f.event("s1", message("a", "hello world"), "epoch:2");
			f.ready("s1", "epoch:2");
			f.event("s1", message("a", "hello again"), "epoch:3");
			expect(texts(controller.getSnapshot().messages)).toEqual(["HELLO AGAIN"]);
			expect(controller.getSnapshot().messages[0]?.parts[0]?.id).toBe(firstMessage?.parts[0]?.id);
			f.event("s1", { ...message("a", ""), content: [] }, "epoch:4");
			expect(controller.getSnapshot().messages).toMatchObject([{ id: firstMessage?.id, parts: [] }]);
			expect(texts(first.messages)).toEqual(["HELLO"]);
			expect(updated?.parts).toMatchObject([{ type: "text", text: "HELLO WORLD" }]);
		} finally {
			controller.dispose();
		}
	});

	it("thread_created 归主消息流生成子 Agent 卡分片，主↔子收发事件不产生可见分片", async () => {
		const f = fixture(uppercase);
		const controller = createChatController(f.provider, "s1");
		try {
			const connected = controller.connect();
			f.ready("s1");
			await connected;
			f.event("s1", {
				event_id: "spawn",
				type: "thread_created",
				created_at: "2026-10-28T00:00:00Z",
				metadata: { thread_id: "sthr_child", session_thread_id: "sthr_child" },
				content: [{ type: "data", data: { session_thread_id: "sthr_child", agent_name: "研究员", status: "running" } }],
			});
			// 派发任务书与协作回执只供卡头摘要消费，不再落到主/子任何消息流。
			f.event("s1", {
				event_id: "dispatch",
				type: "thread_message_sent",
				created_at: "2026-10-28T00:00:01Z",
				metadata: {
					thread_id: "sthr_child",
					session_thread_id: "sthr_child",
					from_thread_id: "thrd_main",
					to_thread_id: "sthr_child",
				},
				content: [{ type: "text", text: "dispatch brief" }],
			});
			f.event("s1", {
				event_id: "brief",
				type: "thread_message_received",
				created_at: "2026-10-28T00:00:02Z",
				metadata: { thread_id: "sthr_child", session_thread_id: "sthr_child", from_agent_name: "coordinator" },
				content: [{ type: "text", text: "coordinator brief" }],
			});
			f.event("s1", message("child", "child text", "sthr_child"));
			const snapshot = controller.getSnapshot();
			const parts = snapshot.messages.flatMap((item) => item.parts);
			expect(parts).toContainEqual(expect.objectContaining({ type: "sub-agent", threadId: "sthr_child" }));
			expect(parts.some((part) => part.type === "unknown")).toBe(false);
			expect(texts(snapshot.messages)).toEqual([]);
			expect(texts(snapshot.threads.sthr_child ?? [])).toEqual(["CHILD TEXT"]);
		} finally {
			controller.dispose();
		}
	});

	it("共享 Provider 的会话与线程隔离，回放保留未回显的乐观消息", async () => {
		const f = fixture(uppercase);
		const first = createChatController(f.provider, "s1");
		const second = createChatController(f.provider, "s2");
		try {
			const connected = [first.connect(), second.connect()];
			f.ready("s1");
			f.ready("s2");
			await Promise.all(connected);
			await first.send("draft", { clientMessageId: "local" });
			f.event("s1", message("a", "first"));
			f.event("s1", message("child", "child", "sthr_child"));
			f.event("s2", message("a", "second"));
			expect(texts(first.getSnapshot().messages)).toEqual(["draft", "FIRST"]);
			expect(texts(first.getSnapshot().threads.sthr_child ?? [])).toEqual(["CHILD"]);
			expect(texts(second.getSnapshot().messages)).toEqual(["SECOND"]);
			expect(second.getSnapshot().threads).toEqual({});

			f.reset("s1");
			f.event("s1", message("a", "replacement"));
			expect(texts(first.getSnapshot().messages)).toEqual(["draft", "FIRST"]);
			f.ready("s1");
			expect(texts(first.getSnapshot().messages)).toEqual(["draft", "REPLACEMENT"]);
			expect(first.getSnapshot().messages[0]).toMatchObject({
				role: "user",
				status: "pending",
				clientMessageId: "local",
			});
			expect(first.getSnapshot().threads).toEqual({});
			expect(texts(second.getSnapshot().messages)).toEqual(["SECOND"]);
		} finally {
			first.dispose();
			second.dispose();
		}
	});
});
