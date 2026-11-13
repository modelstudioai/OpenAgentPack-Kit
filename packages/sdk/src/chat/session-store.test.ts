import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../protocol/index.ts";
import { createSessionStore } from "./session-store.ts";

const ev = (over: Partial<SessionEvent>): SessionEvent => ({ type: "message", role: "assistant", ...over });
const text = (t: string) => [{ type: "text", text: t }];

describe("session store", () => {
	it("event_id 去重：重复事件只归并一次", () => {
		const store = createSessionStore("s1");
		const event = ev({ event_id: "e1", content: text("hi") });
		expect(store.applyEvent(event)).toBe("applied");
		expect(store.applyEvent(event)).toBe("duplicate");
		expect(store.getSnapshot().messages).toHaveLength(1);
	});

	it("历史回放与实时流交叉到达不重复", () => {
		const store = createSessionStore("s1");
		const e1 = ev({ event_id: "e1", content: text("a") });
		const e2 = ev({ event_id: "e2", content: text("b") });
		const e3 = ev({ event_id: "e3", content: text("c") });
		// 回放：e1,e2；实时：e2,e3（e2 交叉重复）
		store.applyEvent(e1);
		store.applyEvent(e2);
		expect(store.applyEvent(e2)).toBe("duplicate");
		store.applyEvent(e3);
		// 流式分片合并进同一条 assistant 消息的同一个 text part
		const parts = store.getSnapshot().messages.flatMap((m) => m.parts);
		expect(parts.map((p) => (p.type === "text" ? p.text : p.type))).toEqual(["abc"]);
		expect(store.getSnapshot().messages.filter((m) => m.role === "assistant")).toHaveLength(1);
	});

	it("turn 边界只认 session_status=idle", () => {
		const store = createSessionStore("s1");
		store.beginTurn({ text: "q" });
		expect(store.getSnapshot().turnRunning).toBe(true);
		store.applyEvent(ev({ event_id: "a1", content: text("thinking…") }));
		expect(store.getSnapshot().turnRunning).toBe(true);
		// done 帧不会进 store；这里用事件流模拟 turn 结束
		store.applyEvent(ev({ event_id: "s1", type: "session_status", metadata: { status: "running" } }));
		expect(store.getSnapshot().turnRunning).toBe(true);
		store.applyEvent(ev({ event_id: "s2", type: "session_status", metadata: { status: "idle" } }));
		const snap = store.getSnapshot();
		expect(snap.turnRunning).toBe(false);
		expect(snap.messages.find((m) => m.role === "assistant")?.status).toBe("done");
	});

	it("artifact 提取进列表与消息分片", () => {
		const store = createSessionStore("s1");
		store.applyEvent(
			ev({
				event_id: "e1",
				metadata: { artifact: { file_id: "f1", filename: "a.pdf", content_type: "application/pdf" } },
			}),
		);
		const snap = store.getSnapshot();
		expect(snap.artifacts).toHaveLength(1);
		expect(snap.artifacts[0]?.file_id).toBe("f1");
		expect(snap.messages[0]?.parts.some((p) => p.type === "artifact")).toBe(true);
	});

	it("子线程归入 threads，不污染主列表", () => {
		const store = createSessionStore("s1");
		store.applyEvent(ev({ event_id: "t1", metadata: { session_thread_id: "sthr_1" }, content: text("child") }));
		const snap = store.getSnapshot();
		expect(snap.messages).toHaveLength(0);
		expect(snap.threads.sthr_1).toHaveLength(1);
	});

	it("乐观用户消息被真实回显替换", () => {
		const store = createSessionStore("s1");
		const { messageId } = store.beginTurn({ text: "hello", clientMessageId: "cm1" });
		expect(store.getSnapshot().messages[0]?.status).toBe("pending");
		store.applyEvent(
			ev({ event_id: "u1", role: "user", content: text("hello"), metadata: { client_message_id: "cm1" } }),
		);
		const snap = store.getSnapshot();
		expect(snap.messages).toHaveLength(1);
		expect(snap.messages[0]?.id).not.toBe(messageId);
		expect(snap.messages[0]?.status).toBe("done");
	});

	it("过期 generation 的 pending 回写被丢弃", () => {
		const store = createSessionStore("s1");
		const { messageId, generation } = store.beginTurn({ text: "old" });
		store.reset("s2");
		store.setPendingStatus(messageId, "failed", generation);
		expect(store.getSnapshot().messages).toHaveLength(0);
	});

	it("工具调用与输出配对，时间戳记录起止且快照更新不丢", () => {
		const store = createSessionStore("s1");
		store.applyEvent(
			ev({
				event_id: "c1",
				type: "tool_call",
				created_at: "2026-10-30T03:00:01Z",
				metadata: { tool_name: "search", tool_input: "{}" },
			}),
		);
		store.applyEvent(
			ev({
				event_id: "c2",
				type: "tool_call_output",
				created_at: "2026-10-30T03:00:04Z",
				metadata: { tool_name: "search" },
				content: text("result"),
			}),
		);
		const part = store.getSnapshot().messages[0]?.parts.find((p) => p.type === "tool");
		expect(part).toMatchObject({
			type: "tool",
			name: "search",
			status: "done",
			output: "result",
			startedAt: "2026-10-30T03:00:01Z",
			endedAt: "2026-10-30T03:00:04Z",
		});
		// 思考分片记录起始时间，供执行容器计时。
		store.applyEvent(
			ev({
				event_id: "r1",
				type: "reasoning",
				created_at: "2026-10-30T03:00:00Z",
				content: text("想想"),
			}),
		);
		const reasoning = store.getSnapshot().messages[0]?.parts.find((p) => p.type === "reasoning");
		expect(reasoning).toMatchObject({ type: "reasoning", startedAt: "2026-10-30T03:00:00Z" });
	});

	it("error 事件把当前 assistant 消息标失败", () => {
		const store = createSessionStore("s1");
		store.applyEvent(ev({ event_id: "e1", content: text("partial") }));
		store.applyEvent(ev({ event_id: "e2", type: "error", code: "provider_error", message: "boom" }));
		expect(store.getSnapshot().messages[0]?.status).toBe("failed");
	});
});

describe("snapshot projection", () => {
	it("同 ID 累计文本替换，最终快照抵御迟到分片，消息与分片身份稳定", () => {
		const store = createSessionStore("s1");
		store.applyEvent(ev({ event_id: "a", content: text("你"), metadata: { event_status: "in_progress" } }), "epoch:1");
		const first = store.getSnapshot().messages[0];
		store.applyEvent(ev({ event_id: "a", content: text("你好"), metadata: { event_status: "completed" } }), "epoch:2");
		store.applyEvent(ev({ event_id: "a", content: text("你"), metadata: { event_status: "in_progress" } }), "epoch:3");
		const final = store.getSnapshot().messages[0];
		expect(final?.id).toBe(first?.id);
		expect(final?.parts[0]?.id).toBe(first?.parts[0]?.id);
		expect(final?.parts).toMatchObject([{ type: "text", text: "你好" }]);
		expect(store.getSnapshot().lastCursor).toBe("epoch:3");
	});
	it("缺失正文保留，显式空数组清空而不是保留旧内容", () => {
		const store = createSessionStore();
		store.applyEvent(ev({ event_id: "a", content: text("partial") }));
		store.applyEvent(ev({ event_id: "a", metadata: { event_status: "completed" } }));
		expect(store.getSnapshot().messages[0]?.parts).toMatchObject([{ text: "partial" }]);
		store.applyEvent(ev({ event_id: "a", content: [] }));
		expect(store.getSnapshot().messages[0]?.parts).toEqual([]);
	});
	it("多内容块保持正文/未知/正文顺序，未知 JSON 仅投影数据", () => {
		const store = createSessionStore();
		store.applyEvent(
			ev({
				event_id: "a",
				content: [
					{ type: "text", text: "before" },
					{ type: "future", data: { html: "<script>1</script>" } },
					{ type: "text", text: "after" },
				],
			}),
		);
		expect(store.getSnapshot().messages[0]?.parts.map((part) => part.type)).toEqual(["text", "unknown", "text"]);
		expect(store.getSnapshot().messages[0]?.parts[1]).toMatchObject({
			value: { data: { html: "<script>1</script>" } },
		});
	});
	it("同名并发工具按 call_id 配对，结果先到仍保留结构化输入输出", () => {
		const store = createSessionStore();
		store.applyEvent(
			ev({
				event_id: "o2",
				type: "tool_call_output",
				metadata: { call_id: "c2", tool_name: "search" },
				content: [{ type: "data", data: { output: { results: [2] } } }],
			}),
		);
		store.applyEvent(
			ev({
				event_id: "c1",
				type: "tool_call",
				metadata: { call_id: "c1", tool_name: "search", tool_input: { query: "one" } },
			}),
		);
		store.applyEvent(
			ev({
				event_id: "c2",
				type: "tool_call",
				metadata: { call_id: "c2", tool_name: "search", tool_input: { query: "two" } },
			}),
		);
		store.applyEvent(
			ev({
				event_id: "o1",
				type: "tool_call_output",
				metadata: { call_id: "c1", tool_name: "search" },
				content: [{ type: "data", data: { output: { results: [1] } } }],
			}),
		);
		const parts = store.getSnapshot().messages[0]?.parts;
		expect(parts).toHaveLength(2);
		expect(parts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ toolId: "c1", input: { query: "one" }, output: { results: [1] }, status: "done" }),
				expect.objectContaining({ toolId: "c2", input: { query: "two" }, output: { results: [2] }, status: "done" }),
			]),
		);
	});
	it("artifacts 数组去重更新与显式清空均反映在卡片和列表", () => {
		const store = createSessionStore();
		store.applyEvent(
			ev({
				event_id: "a",
				metadata: {
					artifacts: [
						{ file_id: "f1", filename: "one" },
						{ file_id: "f2", filename: "two" },
					],
				},
			}),
		);
		store.applyEvent(
			ev({
				event_id: "a",
				metadata: {
					artifacts: [
						{ file_id: "f1", filename: "updated" },
						{ file_id: "f1", filename: "last" },
					],
				},
			}),
		);
		expect(store.getSnapshot().artifacts).toMatchObject([{ file_id: "f1", filename: "last" }]);
		store.applyEvent(ev({ event_id: "a", metadata: { artifacts: [] } }));
		expect(store.getSnapshot().artifacts).toEqual([]);
		expect(store.getSnapshot().messages[0]?.parts).toEqual([]);
	});
	it("requires_action 不能终结 Turn，子线程结束不解锁主线程", () => {
		const store = createSessionStore();
		store.setConnection("connected");
		store.beginTurn({ text: "question" });
		store.applyEvent(
			ev({ event_id: "child", type: "thread_status", metadata: { session_thread_id: "sthr_child", status: "idle" } }),
		);
		expect(store.getSnapshot().turnRunning).toBe(true);
		store.applyEvent(
			ev({
				event_id: "req",
				type: "tool_approval_request",
				content: [
					{ type: "data", data: { batch_id: "b", call_id: "c", name: "run", arguments: "{}", tool_type: "builtin" } },
				],
			}),
		);
		store.applyEvent(
			ev({
				event_id: "status",
				type: "session_status",
				content: [
					{
						type: "data",
						data: {
							session_status: "idle",
							stop_reason: { type: "requires_action", pending_batch_id: "b", pending_call_ids: ["c"] },
						},
					},
				],
			}),
		);
		expect(store.getSnapshot()).toMatchObject({ phase: "requires_action", turnRunning: true, canSend: false });
		expect(store.getSnapshot().approvals).toMatchObject([{ batch_id: "b", call_id: "c", actionable: true }]);
		store.applyEvent(ev({ event_id: "done", type: "session_status", metadata: { status: "idle" } }));
		expect(store.getSnapshot()).toMatchObject({ phase: "idle", turnRunning: false, canSend: true, approvals: [] });
	});
	it("reset 回放原子替换 Provider 集合，保留未回显乐观消息", () => {
		const store = createSessionStore();
		store.applyEvent(ev({ event_id: "old", content: text("old") }), "old:1");
		store.beginTurn({ text: "unsent", clientMessageId: "cm" });
		store.beginReplay();
		store.applyEvent(ev({ event_id: "new", content: text("new") }), "new:1");
		expect(
			store
				.getSnapshot()
				.messages.flatMap((message) => message.parts)
				.filter((part) => part.type === "text")
				.map((part) => part.text),
		).toEqual(["old", "unsent"]);
		expect(store.getSnapshot().lastCursor).toBe("old:1");
		store.finishReplay("new:1");
		expect(
			store
				.getSnapshot()
				.messages.flatMap((message) => message.parts)
				.filter((part) => part.type === "text")
				.map((part) => part.text),
		).toEqual(["new", "unsent"]);
		expect(store.getSnapshot().lastCursor).toBe("new:1");
	});
	it("无 ID 事件使用传输 cursor 身份，不能误去重相同内容", () => {
		const store = createSessionStore();
		store.applyEvent(ev({ content: text("same") }), "epoch:1");
		store.applyEvent(ev({ content: text("same") }), "epoch:2");
		expect(store.getSnapshot().messages[0]?.parts).toMatchObject([{ text: "samesame" }]);
		expect(store.getSnapshot().lastEventId).toBeNull();
	});
	it("新 Turn 后旧 pending 失败回调不能覆盖当前发送", () => {
		const store = createSessionStore();
		const old = store.beginTurn({ text: "old" });
		store.beginTurn({ text: "new" });
		store.setPendingStatus(old.messageId, "failed", old.generation);
		expect(store.getSnapshot().messages.map((message) => message.status)).toEqual(["pending", "pending"]);
	});
});

describe("latest lifecycle authority", () => {
	it("同 ID 状态更新保持气泡位置且仍能终结后到正文", () => {
		const store = createSessionStore();
		store.applyEvent(ev({ event_id: "status", type: "session_status", metadata: { status: "running" } }));
		store.applyEvent(ev({ event_id: "a", content: text("partial") }));
		store.applyEvent(ev({ event_id: "status", type: "session_status", metadata: { status: "idle" } }));
		expect(store.getSnapshot()).toMatchObject({ phase: "idle", turnRunning: false, messages: [{ status: "done" }] });
		store.applyEvent(ev({ event_id: "a", content: text("complete"), metadata: { event_status: "completed" } }));
		expect(store.getSnapshot().phase).toBe("idle");
	});
	it("Provider 中断确认标记 interrupted，而不是普通完成", () => {
		const store = createSessionStore();
		store.applyEvent(ev({ event_id: "a", content: text("partial") }));
		store.applyEvent(
			ev({ event_id: "s", type: "session_status", metadata: { status: "idle", stop_reason: { type: "interrupted" } } }),
		);
		expect(store.getSnapshot()).toMatchObject({ phase: "interrupted", messages: [{ status: "interrupted" }] });
	});
	it("Provider 审批响应覆盖先前的本地 pending 状态", () => {
		const store = createSessionStore();
		store.applyEvent(
			ev({
				event_id: "req",
				type: "tool_approval_request",
				content: [
					{ type: "data", data: { batch_id: "b", call_id: "c", name: "run", arguments: "{}", tool_type: "builtin" } },
				],
			}),
		);
		store.applyEvent(
			ev({
				event_id: "status",
				type: "session_status",
				metadata: {
					status: "idle",
					stop_reason: { type: "requires_action", pending_batch_id: "b", pending_call_ids: ["c"] },
				},
			}),
		);
		store.setApprovalStatus("b", "c", "pending");
		store.applyEvent(
			ev({
				event_id: "res",
				type: "tool_approval_response",
				content: [{ type: "data", data: { batch_id: "b", call_id: "c", result: "allow" } }],
			}),
		);
		expect(store.getSnapshot().approvals[0]).toMatchObject({ status: "submitted", actionable: false });
	});
});

describe("optimistic acknowledgement", () => {
	it("相同文本不能猜测回填，POST event_ids 可确认先到的 Provider 回显", () => {
		const store = createSessionStore();
		const pending = store.beginTurn({ text: "same", clientMessageId: "cm" });
		store.applyEvent(ev({ event_id: "u", role: "user", content: text("same") }));
		expect(store.getSnapshot().messages).toHaveLength(2);
		store.acknowledgePending(pending.messageId, ["u"], pending.generation);
		expect(store.getSnapshot().messages).toMatchObject([{ id: "u", status: "done" }]);
	});
});

describe("reset replay lifecycle order", () => {
	it("首次展示位置靠前但 cursor 较新的 idle 才是终结权威", () => {
		const store = createSessionStore();
		store.setConnection("connected");
		store.beginReplay();
		store.applyEvent(ev({ event_id: "status-a", type: "session_status", metadata: { status: "idle" } }), "epoch:10");
		store.applyEvent(ev({ event_id: "a", content: text("done"), metadata: { event_status: "completed" } }), "epoch:11");
		store.applyEvent(ev({ event_id: "status-b", type: "session_status", metadata: { status: "running" } }), "epoch:7");
		store.finishReplay("epoch:11");
		expect(store.getSnapshot()).toMatchObject({
			phase: "idle",
			providerStatus: "idle",
			turnRunning: false,
			canSend: true,
			messages: [{ status: "done" }],
		});
	});
	it("reset 旧位置较新的等待审批不能被后位置旧 idle 解锁", () => {
		const store = createSessionStore();
		store.beginReplay();
		store.applyEvent(
			ev({
				event_id: "request",
				type: "tool_approval_request",
				content: [
					{ type: "data", data: { batch_id: "b", call_id: "c", name: "run", arguments: "{}", tool_type: "builtin" } },
				],
			}),
			"epoch:3",
		);
		store.applyEvent(
			ev({
				event_id: "status-a",
				type: "session_status",
				metadata: {
					status: "idle",
					stop_reason: { type: "requires_action", pending_batch_id: "b", pending_call_ids: ["c"] },
				},
			}),
			"epoch:10",
		);
		store.applyEvent(ev({ event_id: "status-b", type: "session_status", metadata: { status: "idle" } }), "epoch:7");
		store.finishReplay("epoch:10");
		expect(store.getSnapshot()).toMatchObject({
			phase: "requires_action",
			turnRunning: true,
			approvals: [{ batch_id: "b", call_id: "c" }],
		});
	});
});

describe("message attachments", () => {
	const file = (file_id: string, filename: string) => ({ file_id, filename });

	it("乐观气泡携带附件分片且在文本上方，同 file_id 去重", () => {
		const store = createSessionStore();
		store.beginTurn({
			text: "看下这两个",
			attachments: [file("f1", "a.csv"), file("f1", "a.csv"), file("f2", "b.csv")],
		});
		const parts = store.getSnapshot().messages[0]?.parts;
		expect(parts).toMatchObject([
			{ type: "attachment", id: "attachment:f1", file: { file_id: "f1", filename: "a.csv" } },
			{ type: "attachment", id: "attachment:f2", file: { file_id: "f2", filename: "b.csv" } },
			{ type: "text", text: "看下这两个" },
		]);
	});

	it("回显替换后附件保留在正式消息上", () => {
		const store = createSessionStore();
		const pending = store.beginTurn({
			text: "这是什么文件",
			clientMessageId: "cm1",
			attachments: [file("f1", "lerna.json")],
		});
		store.acknowledgePending(pending.messageId, ["u1"], pending.generation);
		store.applyEvent(ev({ event_id: "u1", role: "user", content: text("这是什么文件") }));
		const snap = store.getSnapshot();
		expect(snap.messages).toHaveLength(1);
		expect(snap.messages[0]?.id).toBe("u1");
		expect(snap.messages[0]?.parts).toMatchObject([
			{ type: "attachment", file: { file_id: "f1" } },
			{ type: "text", text: "这是什么文件" },
		]);
	});

	it("刷新后按会话详情关联为历史用户气泡补附件", () => {
		const store = createSessionStore();
		store.setMessageFiles([{ event_ids: ["u9"], files: [file("f1", "report.pdf")] }]);
		store.applyEvent(ev({ event_id: "u9", role: "user", content: text("帮我总结") }));
		expect(store.getSnapshot().messages[0]?.parts).toMatchObject([
			{ type: "attachment", file: { file_id: "f1", filename: "report.pdf" } },
			{ type: "text", text: "帮我总结" },
		]);
		// 无关联的事件不受影响
		store.applyEvent(ev({ event_id: "u10", role: "user", content: text("普通消息") }));
		const second = store.getSnapshot().messages[1];
		expect(second?.parts.map((part) => part.type)).toEqual(["text"]);
	});

	it("回显合并与会话详情映射同时命中同一附件时只保留一份", () => {
		const store = createSessionStore();
		store.setMessageFiles([{ event_ids: ["u1"], files: [file("f1", "lerna.json")] }]);
		const pending = store.beginTurn({
			text: "这是什么文件",
			clientMessageId: "cm1",
			attachments: [file("f1", "lerna.json")],
		});
		store.acknowledgePending(pending.messageId, ["u1"], pending.generation);
		store.applyEvent(ev({ event_id: "u1", role: "user", content: text("这是什么文件") }));
		const parts = store.getSnapshot().messages[0]?.parts.filter((part) => part.type === "attachment");
		expect(parts).toHaveLength(1);
	});
});
