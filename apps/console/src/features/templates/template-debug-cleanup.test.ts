import { KitError, type PlanResponse } from "@openagentpack/kit-sdk/protocol";
import { describe, expect, it, vi } from "vitest";
import { createTemplateDebugCleanupQueue } from "./template-debug-cleanup.ts";

function plan(version = 1): PlanResponse {
	return { plan_id: `plan-${version}`, confirm_token: `token-${version}`, expires_at: 1, destructive: true, diff: [] };
}

function deferredDeletion() {
	let resolve!: (result: { deleted: boolean }) => void;
	const promise = new Promise<{ deleted: boolean }>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

function waitForIdle(queue: ReturnType<typeof createTemplateDebugCleanupQueue>) {
	if (!queue.getSnapshot().some((task) => task.pending)) return Promise.resolve();
	return new Promise<void>((resolve) => {
		const unsubscribe = queue.subscribe(() => {
			if (queue.getSnapshot().some((task) => task.pending)) return;
			unsubscribe();
			resolve();
		});
	});
}

describe("模版调试会话清理队列", () => {
	// 保护组件离开和迟到响应同时触发清理：同一任务只能执行一次，并沿用计划令牌。
	it("合并重复入队，按计划确认删除，成功移除任务", async () => {
		const deletion = deferredDeletion();
		const client = {
			debug: { planDelete: vi.fn().mockResolvedValue(plan()), deleteSession: vi.fn(() => deletion.promise) },
		};
		const queue = createTemplateDebugCleanupQueue();
		queue.enqueue(client, "session-one");
		queue.enqueue(client, "session-one");
		expect(queue.getSnapshot()).toMatchObject([{ sessionId: "session-one", pending: true, error: null }]);
		expect(queue.getSnapshot()).toBe(queue.getSnapshot());
		deletion.resolve({ deleted: true });
		await waitForIdle(queue);
		expect(client.debug.planDelete).toHaveBeenCalledTimes(1);
		expect(client.debug.deleteSession.mock.calls).toEqual([
			["session-one", { plan_id: "plan-1", confirm_token: "token-1" }],
		]);
		expect(queue.getSnapshot()).toEqual([]);
	});

	// 保护恢复路径：失败状态与原客户端保留，重复入队不偷偷重试，显式重试重新申请令牌。
	it("普通错误即使携带 404 也保留，显式重试成功后清除", async () => {
		const deletion = deferredDeletion();
		const client = {
			debug: {
				planDelete: vi.fn().mockResolvedValueOnce(plan()).mockResolvedValueOnce(plan(2)),
				deleteSession: vi
					.fn()
					.mockRejectedValueOnce(Object.assign(new Error("暂时不可用"), { status: 404 }))
					.mockReturnValueOnce(deletion.promise),
			},
		};
		const queue = createTemplateDebugCleanupQueue();
		queue.enqueue(client, "session-retry");
		await waitForIdle(queue);
		queue.enqueue(client, "session-retry");
		expect(client.debug.planDelete).toHaveBeenCalledTimes(1);
		expect(queue.getSnapshot()).toMatchObject([{ sessionId: "session-retry", pending: false, error: "暂时不可用" }]);
		const retry = queue.retryFailed();
		expect(queue.getSnapshot()).toMatchObject([{ sessionId: "session-retry", pending: true, error: "暂时不可用" }]);
		deletion.resolve({ deleted: true });
		await retry;
		expect(client.debug.planDelete).toHaveBeenCalledTimes(2);
		expect(client.debug.deleteSession).toHaveBeenLastCalledWith("session-retry", {
			plan_id: "plan-2",
			confirm_token: "token-2",
		});
		expect(queue.getSnapshot()).toEqual([]);
	});

	// 保护资源已不存在的幂等清理：准备或执行阶段的 KitError 404 均视为完成。
	it("计划或删除返回 KitError 404 时移除任务，不再重试", async () => {
		for (const phase of ["plan", "delete"]) {
			const missing = new KitError("not_found", "会话不存在");
			const client = {
				debug: {
					planDelete: phase === "plan" ? vi.fn().mockRejectedValue(missing) : vi.fn().mockResolvedValue(plan()),
					deleteSession: vi.fn().mockRejectedValue(missing),
				},
			};
			const queue = createTemplateDebugCleanupQueue();
			queue.enqueue(client, "session-missing");
			await waitForIdle(queue);
			await queue.retryFailed();
			expect(queue.getSnapshot()).toEqual([]);
			expect(client.debug.planDelete).toHaveBeenCalledTimes(1);
			expect(client.debug.deleteSession).toHaveBeenCalledTimes(phase === "plan" ? 0 : 1);
		}
	});
});
