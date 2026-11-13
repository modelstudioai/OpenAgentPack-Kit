import { describe, expect, it, vi } from "vitest";
import { KitError, type SessionEvent, type ToolApprovalsResponse } from "../protocol/index.ts";
import type { ChatProvider, StreamSessionOptions } from "../providers/contract.ts";
import { createChatController } from "./controller.ts";

function fixture() {
	let streamOptions: StreamSessionOptions = {};
	let finish: () => void = () => undefined;
	let fail: (error: unknown) => void = () => undefined;
	const stream = vi.fn(async (_id: string, options: StreamSessionOptions = {}) => {
		streamOptions = options;
		await new Promise<void>((resolve, reject) => {
			finish = resolve;
			fail = reject;
			options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
		});
	});
	let approvals: ToolApprovalsResponse = { requires_action: false, batch_id: null, pending_call_ids: [], requests: [] };
	const sendMessage = vi.fn(async () => ({ session_id: "s1", accepted: true, event_ids: [] as string[] }));
	const submitToolApproval = vi.fn(async () => ({ session_id: "s1", accepted: true, event_ids: ["approval-1"] }));
	const client = {
		stream,
		sendMessage,
		interrupt: vi.fn(async () => ({ interrupted: true })),
		toolApprovals: vi.fn(async () => approvals),
		submitToolApproval,
	} satisfies ChatProvider;
	const controller = createChatController(client, "s1", {
		backoff: { baseMs: 1, maxMs: 1, jitter: 0, maxAttempts: 2 },
	});
	return {
		client,
		controller,
		stream,
		sendMessage,
		submitToolApproval,
		ready: (cursor: string | null = "epoch:0") => streamOptions.onReady?.({ sessionId: "s1", replayed: 0, cursor }),
		event: (event: SessionEvent, cursor?: string) => streamOptions.onEvent?.(event, cursor),
		reset: () => streamOptions.onReset?.(),
		end: () => {
			streamOptions.onDone?.({ status: "deleted", lastEventId: null });
			finish();
		},
		fail: (error: unknown) => fail(error),
		setApprovals: (value: ToolApprovalsResponse) => {
			approvals = value;
		},
	};
}
const pending: ToolApprovalsResponse = {
	requires_action: true,
	batch_id: "b1",
	pending_call_ids: ["c1"],
	requests: [
		{
			batch_id: "b1",
			call_id: "c1",
			request_event_id: "r1",
			name: "search",
			arguments: "{}",
			tool_type: "builtin",
			actionable: true,
			status: "pending",
		},
	],
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("chat controller", () => {
	it("等待 ready 再发送，connect 在持久订阅结束前返回", async () => {
		const f = fixture();
		const sending = f.controller.send("hi", { clientMessageId: "cm1" });
		expect(f.sendMessage).not.toHaveBeenCalled();
		f.ready();
		await sending;
		expect(f.sendMessage).toHaveBeenCalledOnce();
		expect(f.controller.connected).toBe(true);
		f.event(
			{
				event_id: "u1",
				type: "message",
				role: "user",
				content: [{ type: "text", text: "hi" }],
				metadata: { client_message_id: "cm1" },
			},
			"epoch:1",
		);
		f.event(
			{ event_id: "a1", type: "message", role: "assistant", content: [{ type: "text", text: "hello" }] },
			"epoch:2",
		);
		f.event({ event_id: "s1", type: "session_status", metadata: { status: "idle" } }, "epoch:3");
		expect(f.controller.getSnapshot().messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(f.controller.getSnapshot().turnRunning).toBe(false);
		expect(f.controller.connected).toBe(true);
		f.controller.dispose();
	});
	it("发送失败保留 failed 乐观消息，不自动重发", async () => {
		const f = fixture();
		f.sendMessage.mockRejectedValueOnce(new Error("POST uncertain"));
		const sending = f.controller.send("draft");
		f.ready();
		await expect(sending).rejects.toThrow("POST uncertain");
		expect(f.controller.getSnapshot().messages[0]).toMatchObject({
			status: "failed",
			parts: [{ type: "text", text: "draft" }],
		});
		expect(f.sendMessage).toHaveBeenCalledOnce();
		f.controller.dispose();
	});
	it("skills 授权名单随正文上送，乐观气泡按协议 token 投影（ADR-0016）", async () => {
		const f = fixture();
		const sending = f.controller.send("用 /animate 做转场", { skills: ["animate"] });
		f.ready();
		await sending;
		expect(f.sendMessage).toHaveBeenCalledWith(
			"s1",
			expect.objectContaining({ text: "用 /animate 做转场", skills: ["animate"] }),
		);
		expect(f.controller.getSnapshot().messages[0]).toMatchObject({
			parts: [{ type: "text", text: "用 [使用 Skill:animate] 做转场" }],
		});
		f.event({ event_id: "idle-1", type: "session_status", metadata: { status: "idle" } }, "epoch:1");
		await f.controller.send("未授权 /animate 原样");
		expect(f.sendMessage).toHaveBeenLastCalledWith("s1", expect.not.objectContaining({ skills: expect.anything() }));
		expect(f.controller.getSnapshot().messages.at(-1)).toMatchObject({
			parts: [{ type: "text", text: "未授权 /animate 原样" }],
		});
		f.controller.dispose();
	});
	it("断线重连使用传输 cursor，同 event_id 的快照继续替换", async () => {
		const f = fixture();
		const connected = f.controller.connect();
		f.ready();
		await connected;
		f.event({ event_id: "a", type: "message", content: [{ type: "text", text: "你" }] }, "epoch:7");
		f.fail(new KitError("provider_error", "network", { retryable: true }));
		await vi.waitFor(() => expect(f.stream).toHaveBeenCalledTimes(2));
		expect(f.stream.mock.calls[1]?.[1]?.after).toBe("epoch:7");
		f.ready("epoch:7");
		f.event({ event_id: "a", type: "message", content: [{ type: "text", text: "你好" }] }, "epoch:8");
		expect(f.controller.getSnapshot().messages[0]?.parts).toMatchObject([{ type: "text", text: "你好" }]);
		f.controller.dispose();
	});
	// 保护未确认发送：重建不能将旧 idle 变成完成证据；真实回显及新完成状态仍可解锁下一轮。
	it.each(["same", "new", "none"] as const)("reset 保留在途发送，游标 epoch=%s", async (epoch) => {
		const f = fixture();
		const initialCursor = epoch === "none" ? undefined : "old:1";
		const replayCursor = epoch === "none" ? undefined : epoch === "same" ? "old:1" : "new:1";
		const idle: SessionEvent = {
			event_id: "idle-before-send",
			type: "session_status",
			metadata: { event_status: "completed", status: "idle" },
		};
		// HTTP 历史和 SSE 对同一对象可能使用不同字段顺序，它不是新版本或本轮完成证据。
		const replayedIdle: SessionEvent = {
			metadata: { status: "idle", event_status: "completed" },
			type: "session_status",
			event_id: "idle-before-send",
		};
		let accept!: () => void;
		f.sendMessage.mockImplementationOnce(async () => {
			await new Promise<void>((resolve) => (accept = resolve));
			return { session_id: "s1", accepted: true, event_ids: ["user-echo"] };
		});
		try {
			const connected = f.controller.connect();
			f.event(idle, initialCursor);
			f.ready(initialCursor ?? null);
			await connected;
			const sending = f.controller.send("first");
			await vi.waitFor(() => expect(f.sendMessage).toHaveBeenCalledOnce());
			f.fail(new KitError("provider_error", "connection lost", { retryable: true }));
			await vi.waitFor(() => expect(f.stream).toHaveBeenCalledTimes(2));
			expect(f.stream.mock.calls[1]?.[1]?.after).toBe(initialCursor ?? null);
			f.reset();
			f.event(replayedIdle, replayCursor);
			f.ready(replayCursor ?? null);
			expect(f.controller.getSnapshot()).toMatchObject({ phase: "running", canSend: false });
			await expect(f.controller.send("second")).rejects.toThrow();
			expect(f.sendMessage).toHaveBeenCalledOnce();
			accept();
			await sending;
			// POST 确认后、Provider 回显前再次重建也不能把旧 idle 当作本轮完成。
			f.reset();
			f.event(replayedIdle, replayCursor);
			f.ready(replayCursor ?? null);
			expect(f.controller.getSnapshot().canSend).toBe(false);
			f.reset();
			f.event(idle, replayCursor);
			f.event({ event_id: "user-echo", type: "message", role: "user", content: [{ type: "text", text: "first" }] });
			f.event({ ...idle, event_id: "idle-after-send" });
			f.ready(null);
			expect(f.controller.getSnapshot()).toMatchObject({
				phase: "idle",
				canSend: true,
				messages: [{ id: "user-echo", status: "done" }],
			});
			await f.controller.send("second");
			expect(f.sendMessage).toHaveBeenCalledTimes(2);
		} finally {
			accept?.();
			f.controller.dispose();
		}
	});
	it("done 和 interrupt 响应不能代替 Provider 完成状态", async () => {
		const f = fixture();
		const send = f.controller.send("hi");
		f.ready();
		await send;
		await f.controller.stop();
		expect(f.controller.getSnapshot().phase).toBe("stopping");
		f.end();
		await tick();
		expect(f.controller.getSnapshot().turnRunning).toBe(true);
		f.controller.dispose();
	});
	it("dispose 拒绝首帧等待且旧异步回写被丢弃", async () => {
		const f = fixture();
		const send = f.controller.send("hi");
		f.controller.dispose();
		await expect(send).rejects.toThrow("关闭");
		f.ready();
		f.event({ event_id: "late", type: "message", content: [{ type: "text", text: "late" }] }, "epoch:1");
		expect(f.sendMessage).not.toHaveBeenCalled();
		expect(f.controller.getSnapshot().messages).toEqual([]);
	});
	it.each(["allow", "deny"] as const)("人工 %s 一次审批，提交成功仍等待 Provider", async (result) => {
		const f = fixture();
		f.setApprovals(pending);
		const submission = f.controller.submitApproval({ batch_id: "b1", call_id: "c1", result });
		f.ready();
		await submission;
		expect(f.submitToolApproval).toHaveBeenCalledWith("s1", { batch_id: "b1", call_id: "c1", result });
		expect(f.controller.getSnapshot().approvals[0]?.status).toBe("submitted");
		expect(f.controller.getSnapshot().phase).toBe("requires_action");
		await expect(f.controller.send("new turn")).rejects.toThrow("等待工具审批");
		f.controller.dispose();
	});
	it("过期批次和未知审批不能发送", async () => {
		const f = fixture();
		f.setApprovals(pending);
		const submission = f.controller.submitApproval({ batch_id: "old", call_id: "c1", result: "allow" });
		f.ready();
		await expect(submission).rejects.toThrow("过期");
		expect(f.submitToolApproval).not.toHaveBeenCalled();
		f.controller.dispose();
	});
	it("审批网络结果不明先查询，不自动重发；仍 pending 需再次人工确认", async () => {
		const f = fixture();
		f.setApprovals(pending);
		f.submitToolApproval.mockRejectedValueOnce(new Error("lost response"));
		const submission = f.controller.submitApproval({ batch_id: "b1", call_id: "c1", result: "deny" });
		f.ready();
		await expect(submission).rejects.toThrow("lost response");
		expect(f.client.toolApprovals).toHaveBeenCalledTimes(2);
		expect(f.submitToolApproval).toHaveBeenCalledOnce();
		expect(f.controller.getSnapshot().approvals[0]?.status).toBe("pending");
		f.controller.dispose();
	});
	it("409 审批冲突刷新当前集合，不能保留旧可操作按钮", async () => {
		const f = fixture();
		f.setApprovals(pending);
		f.submitToolApproval.mockImplementationOnce(async () => {
			f.setApprovals({ ...pending, pending_call_ids: [], requests: [] });
			throw new KitError("conflict", "stale");
		});
		const submission = f.controller.submitApproval({ batch_id: "b1", call_id: "c1", result: "allow" });
		f.ready();
		await expect(submission).rejects.toThrow("stale");
		expect(f.controller.getSnapshot().approvals).toEqual([]);
		f.controller.dispose();
	});
	it("同一审批并发提交只执行一个 POST", async () => {
		const f = fixture();
		f.setApprovals(pending);
		const decision = { batch_id: "b1", call_id: "c1", result: "allow" as const };
		const first = f.controller.submitApproval(decision);
		await expect(f.controller.submitApproval(decision)).rejects.toThrow("正在提交");
		f.ready();
		await first;
		expect(f.submitToolApproval).toHaveBeenCalledOnce();
		f.controller.dispose();
	});
});

describe("approval review identity", () => {
	it("没有传输 cursor 时，迟到的查询不能覆盖流中新到的待审批集合", async () => {
		const f = fixture();
		const connected = f.controller.connect();
		f.ready(null);
		await connected;
		let resolveQuery: (value: ToolApprovalsResponse) => void = () => undefined;
		f.client.toolApprovals.mockImplementationOnce(
			() => new Promise<ToolApprovalsResponse>((resolve) => (resolveQuery = resolve)),
		);
		const refreshing = f.controller.refreshApprovals();
		f.event({
			event_id: "request-new",
			type: "tool_approval_request",
			content: [
				{ type: "data", data: { batch_id: "b2", call_id: "c2", name: "run", arguments: "{}", tool_type: "builtin" } },
			],
		});
		f.event({
			event_id: "status-new",
			type: "session_status",
			metadata: {
				status: "idle",
				stop_reason: { type: "requires_action", pending_batch_id: "b2", pending_call_ids: ["c2"] },
			},
		});
		resolveQuery(pending);
		await refreshing;
		expect(f.controller.getSnapshot().approvals).toMatchObject([{ batch_id: "b2", call_id: "c2" }]);
		expect(f.controller.getSnapshot()).toMatchObject({ phase: "requires_action", canSend: false, lastCursor: null });
		f.controller.dispose();
	});

	it.each([false, true])("审批查询期间的重复帧不会屏蔽最新参数，参数变化=%s", async (changed) => {
		const f = fixture();
		f.setApprovals(pending);
		const connected = f.controller.connect();
		f.ready();
		await connected;
		const event: SessionEvent = {
			event_id: "duplicate",
			type: "message",
			role: "assistant",
			content: [{ type: "text", text: "ready for review" }],
		};
		f.event(event, "epoch:1");
		await f.controller.refreshApprovals();
		f.client.toolApprovals.mockImplementationOnce(async () => {
			f.event(structuredClone(event), "epoch:2");
			return {
				...pending,
				requests: pending.requests.map((request) => ({
					...request,
					arguments: changed ? '{"command":"changed"}' : request.arguments,
				})),
			};
		});
		const submission = f.controller.submitApproval({ batch_id: "b1", call_id: "c1", result: "allow" });
		if (changed) {
			await expect(submission).rejects.toThrow("参数已经变化");
			expect(f.submitToolApproval).not.toHaveBeenCalled();
		} else {
			await submission;
			expect(f.submitToolApproval).toHaveBeenCalledOnce();
		}
		expect(f.client.toolApprovals).toHaveBeenCalledTimes(2);
		f.controller.dispose();
	});

	it.each(["event", "reset", "ready"] as const)("提交前查询被 %s 失效后不能使用旧集合批准", async (change) => {
		const f = fixture();
		const connected = f.controller.connect();
		f.ready(null);
		await connected;
		f.event({ event_id: "r1", type: "tool_approval_request", content: [{ type: "data", data: pending.requests[0] }] });
		const status: SessionEvent = {
			event_id: "status",
			type: "session_status",
			metadata: {
				status: "idle",
				stop_reason: { type: "requires_action", pending_batch_id: "b1", pending_call_ids: ["c1"] },
			},
		};
		f.event(status);
		f.setApprovals(pending);
		await f.controller.refreshApprovals();
		f.client.toolApprovals.mockImplementationOnce(async () => {
			if (change === "event") f.event({ ...status, event_id: "status-new" });
			else if (change === "reset") f.reset();
			else f.ready(null);
			expect(f.controller.getSnapshot().approvals).toMatchObject([
				{ batch_id: "b1", call_id: "c1", actionable: true, status: "pending" },
			]);
			return pending;
		});
		await expect(f.controller.submitApproval({ batch_id: "b1", call_id: "c1", result: "allow" })).rejects.toThrow(
			"审批状态已经变化",
		);
		expect(f.client.toolApprovals).toHaveBeenCalledTimes(2);
		expect(f.submitToolApproval).not.toHaveBeenCalled();
		f.controller.dispose();
	});
});

describe("send response acknowledgement", () => {
	it("POST event_ids 回填不携带 client_message_id 的用户事件", async () => {
		const f = fixture();
		f.sendMessage.mockImplementationOnce(async () => {
			f.event({ event_id: "u", type: "message", role: "user", content: [{ type: "text", text: "same" }] }, "e:1");
			return { session_id: "s1", accepted: true, event_ids: ["u"] };
		});
		const sent = f.controller.send("same");
		f.ready();
		await sent;
		expect(f.controller.getSnapshot().messages).toMatchObject([{ id: "u", status: "done" }]);
		f.controller.dispose();
	});
});

describe("send attachments 透传", () => {
	it("attachments 透传进 sendMessage 请求体；缺省不携带", async () => {
		const f = fixture();
		const sending = f.controller.send("hi", { attachments: [{ file_id: "f1", filename: "a.csv" }] });
		f.ready();
		await sending;
		expect(f.sendMessage).toHaveBeenCalledWith("s1", {
			text: "hi",
			client_message_id: expect.any(String),
			attachments: [{ file_id: "f1", filename: "a.csv" }],
		});
		// 乐观气泡同步携带附件分片，供气泡展示
		expect(f.controller.getSnapshot().messages[0]?.parts).toMatchObject([
			{ type: "attachment", file: { file_id: "f1" } },
			{ type: "text", text: "hi" },
		]);
		const plain = fixture();
		const sendingPlain = plain.controller.send("plain");
		plain.ready();
		await sendingPlain;
		expect(plain.sendMessage).toHaveBeenCalledWith("s1", { text: "plain", client_message_id: expect.any(String) });
		plain.controller.dispose();
		f.controller.dispose();
	});
});
