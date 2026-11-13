import { deriveApprovalState, type SessionEvent } from "@openagentpack/kit-sdk/protocol";
import { describe, expect, it, vi } from "vitest";
import { createMockGateway } from "../src/gateway/mock.ts";
import { createEventBufferRegistry } from "../src/services/event-buffer.ts";
import { createToolApprovals } from "../src/services/tool-approvals.ts";

function latch<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
}
const request = (batch: string): SessionEvent => ({
	event_id: `request-${batch}`,
	type: "tool_approval_request",
	content: [
		{
			type: "data",
			data: {
				batch_id: batch,
				call_id: "call",
				name: "write_file",
				arguments: { path: "/tmp/file" },
				tool_type: "builtin",
			},
		},
	],
});
const status = (batch: string | null, id = "status"): SessionEvent => ({
	event_id: id,
	type: "session_status",
	metadata: {
		event_status: "completed",
		status: batch ? "idle" : "running",
		stop_reason: batch ? { type: "requires_action", pending_batch_id: batch, pending_call_ids: ["call"] } : null,
	},
});
const message = (text: string): SessionEvent => ({
	event_id: "message",
	type: "message",
	role: "assistant",
	content: [{ type: "text", text }],
	metadata: { event_status: "completed" },
});

function setup() {
	const gateway = createMockGateway();
	const buffers = createEventBufferRegistry();
	const history = [request("old"), status("old"), message("旧正文")];
	buffers.seed("s", history);
	const reading = latch<void>();
	const finish = latch<void>();
	gateway.listEvents = vi.fn(async () => {
		reading.resolve();
		await finish.promise;
		return { events: history, next_page_token: null };
	});
	gateway.respondToolApproval = vi.fn(async () => ({ event_ids: ["response"] }));
	return { gateway, buffers, reading, finish, approvals: createToolApprovals(gateway, buffers) };
}

describe("审批刷新与实时快照交叉", () => {
	it("刷新保留查询前已知的同 ID 状态更新顺序，当前审批仍可提交", async () => {
		const gateway = createMockGateway();
		const buffers = createEventBufferRegistry();
		buffers.seed("s", [request("current"), status(null, "early"), status(null, "later")]);
		buffers.append("s", status("current", "early"));
		gateway.listEvents = async () => ({ events: buffers.get("s")!.events, next_page_token: null });
		gateway.respondToolApproval = vi.fn(async () => ({ event_ids: ["accepted"] }));
		const approvals = createToolApprovals(gateway, buffers);
		expect(await approvals.list("s")).toMatchObject({ requires_action: true, batch_id: "current" });
		await expect(approvals.respond("s", { batch_id: "current", call_id: "call", result: "allow" })).resolves.toEqual({
			event_ids: ["accepted"],
		});
		expect(gateway.respondToolApproval).toHaveBeenCalledOnce();
	});

	it("历史中新状态解除审批时不沿用缓存待办，过期提交被拒绝", async () => {
		const gateway = createMockGateway();
		const buffers = createEventBufferRegistry();
		const before = [request("old"), status("old")];
		buffers.seed("s", before);
		gateway.listEvents = async () => ({ events: [...before, status(null, "new-running")], next_page_token: null });
		gateway.respondToolApproval = vi.fn(async () => ({ event_ids: ["unexpected"] }));
		const approvals = createToolApprovals(gateway, buffers);
		expect(await approvals.list("s")).toMatchObject({ requires_action: false, requests: [] });
		await expect(approvals.respond("s", { batch_id: "old", call_id: "call", result: "allow" })).rejects.toMatchObject({
			code: "conflict",
		});
		expect(gateway.respondToolApproval).not.toHaveBeenCalled();
	});

	it("历史的新批次仍可刷新并合法提交，不被缓存旧批次阻止", async () => {
		const gateway = createMockGateway();
		const buffers = createEventBufferRegistry();
		const before = [request("old"), status("old")];
		buffers.seed("s", before);
		gateway.listEvents = async () => ({
			events: [...before, request("new"), status("new", "new-status")],
			next_page_token: null,
		});
		gateway.respondToolApproval = vi.fn(async () => ({ event_ids: ["accepted"] }));
		const approvals = createToolApprovals(gateway, buffers);
		expect(await approvals.list("s")).toMatchObject({ requires_action: true, batch_id: "new" });
		await expect(approvals.respond("s", { batch_id: "new", call_id: "call", result: "deny" })).resolves.toEqual({
			event_ids: ["accepted"],
		});
		expect(gateway.respondToolApproval).toHaveBeenCalledOnce();
	});

	it.each(["冲突状态", "缺失请求", "缺失状态"])("历史%s 无法确认当前待办时拒绝刷新和提交", async (scenario) => {
		const gateway = createMockGateway();
		const buffers = createEventBufferRegistry();
		buffers.seed("s", [request("old"), status("old")]);
		gateway.listEvents = async () => ({
			events:
				scenario === "缺失请求"
					? [status("old")]
					: scenario === "缺失状态"
						? [request("old")]
						: [request("old"), status(null)],
			next_page_token: null,
		});
		gateway.respondToolApproval = vi.fn(async () => ({ event_ids: ["unexpected"] }));
		const approvals = createToolApprovals(gateway, buffers);
		await expect(approvals.list("s")).rejects.toMatchObject({ code: "provider_error", retryable: false });
		await expect(approvals.respond("s", { batch_id: "old", call_id: "call", result: "allow" })).rejects.toMatchObject({
			code: "provider_error",
		});
		expect(gateway.respondToolApproval).not.toHaveBeenCalled();
	});

	it("查询历史期间同 ID 主状态清除审批，旧历史不能使其复活或覆盖新正文", async () => {
		const { gateway, buffers, reading, finish, approvals } = setup();
		const submitted = approvals.respond("s", { batch_id: "old", call_id: "call", result: "allow" });
		const rejected = expect(submitted).rejects.toMatchObject({ code: "conflict" });
		await reading.promise;
		buffers.append("s", status(null));
		buffers.append("s", message("新正文"));
		finish.resolve();
		await rejected;
		expect(gateway.respondToolApproval).not.toHaveBeenCalled();
		expect(deriveApprovalState(buffers.get("s")!.events, buffers.get("s")!.latestStatus).requires_action).toBe(false);
		expect(buffers.get("s")!.events.find((event) => event.event_id === "message")?.content).toEqual([
			{ type: "text", text: "新正文" },
		]);
	});

	it("历史请求期间换批次，刷新只返回新批次且不向订阅者再次发布旧状态", async () => {
		const { buffers, reading, finish, approvals } = setup();
		const result = approvals.list("s");
		await reading.promise;
		buffers.append("s", request("new"));
		buffers.append("s", status("new", "new-status"));
		const seen: SessionEvent[] = [];
		const unsubscribe = buffers.subscribe("s", (change) => {
			if (change) seen.push(change.event);
		});
		finish.resolve();
		expect(await result).toMatchObject({
			requires_action: true,
			batch_id: "new",
			requests: [{ batch_id: "new", actionable: true }],
		});
		expect(buffers.get("s")!.latestStatus?.event_id).toBe("new-status");
		expect(seen).toEqual([]);
		unsubscribe();
	});
});
