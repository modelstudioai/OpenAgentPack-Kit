import { describe, expect, it } from "vitest";
import { mergeEventSnapshots } from "./event-snapshots.ts";
import { isTurnEndEvent, type SessionEvent } from "./events.ts";
import { deriveApprovalState, ToolApprovalDecisionSchema } from "./tool-approvals.ts";

const request = (batch = "batch-a", call = "call-1", type = "builtin"): SessionEvent => ({
	event_id: `${batch}:${call}`,
	type: "tool_approval_request",
	content: [
		{
			type: "data",
			data: { batch_id: batch, call_id: call, tool_type: type, name: "write", arguments: { path: "/tmp/report.txt" } },
		},
	],
});
const status = (reason: unknown): SessionEvent => ({
	type: "session_status",
	content: [{ type: "data", data: { session_status: "idle", stop_reason: reason } }],
});

describe("工具审批当前状态合同", () => {
	it("只有最新待办批次可操作，历史同call不误激活；结构化参数完整保留", () => {
		const current = deriveApprovalState([
			request("old"),
			request(),
			status({ type: "requires_action", pending_batch_id: "batch-a", pending_call_ids: ["call-1"] }),
		]);
		expect(current).toMatchObject({
			requires_action: true,
			batch_id: "batch-a",
			requests: [{ batch_id: "batch-a", actionable: true, arguments: { path: "/tmp/report.txt" } }],
		});
		expect(current.requests).toHaveLength(1);
	});

	it("已回传的调用即使pending尚未刷新也不可再次提交，其他call不受影响", () => {
		const events = [
			request(),
			request("batch-a", "call-2"),
			status({ type: "requires_action", pending_batch_id: "batch-a", pending_call_ids: ["call-1", "call-2"] }),
			{
				type: "tool_approval_response",
				content: [{ type: "data", data: { batch_id: "batch-a", call_id: "call-1", result: "deny" } }],
			},
		];
		const current = deriveApprovalState(events);
		expect(current.requests.map((item) => [item.call_id, item.actionable, item.result])).toEqual([
			["call-1", false, "deny"],
			["call-2", true, undefined],
		]);
		expect(current.pending_call_ids).toHaveLength(2);
	});

	it("明确恢复 running 后不沿用保留字段里的旧审批原因", () => {
		const running: SessionEvent = {
			type: "session_status",
			metadata: {
				status: "running",
				stop_reason: { type: "requires_action", pending_batch_id: "batch-a", pending_call_ids: ["call-1"] },
			},
		};
		expect(deriveApprovalState([request(), running])).toMatchObject({ requires_action: false, requests: [] });
	});

	it("显式空 stop_reason 清除旧 metadata 中保留的审批原因", () => {
		const before: SessionEvent = {
			...status({ type: "requires_action", pending_batch_id: "batch-a", pending_call_ids: ["call-1"] }),
			metadata: { stop_reason: "requires_action" },
		};
		const current = mergeEventSnapshots(before, status(null));
		expect(deriveApprovalState([request(), current]).requires_action).toBe(false);
		expect(isTurnEndEvent(current)).toBe(true);
	});

	it("requires_action缺少身份仍阻塞；未知工具合同不开放审批", () => {
		expect(deriveApprovalState([status({ type: "requires_action" })])).toMatchObject({
			requires_action: true,
			batch_id: null,
			requests: [],
		});
		const events = [
			request("batch-a", "call-1", "future"),
			status({ type: "requires_action", pending_batch_id: "batch-a", pending_call_ids: ["call-1"] }),
		];
		expect(deriveApprovalState(events).requests[0]?.actionable).toBe(false);
		expect(isTurnEndEvent(events[1]!)).toBe(false);
	});

	it("新的正常状态解除待办，子线程idle不能结束主Turn", () => {
		const paused = status({ type: "requires_action", pending_batch_id: "batch-a", pending_call_ids: ["call-1"] });
		const idle = status({ type: "end_turn" });
		expect(deriveApprovalState([request(), paused, idle]).requires_action).toBe(false);
		expect(isTurnEndEvent(idle)).toBe(true);
		expect(isTurnEndEvent({ ...idle, type: "thread_status", metadata: { session_thread_id: "sthr_child" } })).toBe(
			false,
		);
	});

	it("拒绝原因可省略且有一致的产品长度限制", () => {
		expect(ToolApprovalDecisionSchema.safeParse({ batch_id: "b", call_id: "c", result: "deny" }).success).toBe(true);
		expect(
			ToolApprovalDecisionSchema.safeParse({
				batch_id: "b",
				call_id: "c",
				result: "deny",
				deny_message: "x".repeat(201),
			}).success,
		).toBe(false);
	});
});
