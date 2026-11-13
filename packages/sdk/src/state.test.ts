import { describe, expect, it, vi } from "vitest";
import { KitError } from "./protocol/index.ts";
import { createMutation, createQuery } from "./state.ts";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

describe("通用调用状态", () => {
	it("较早查询迟到不会覆盖刷新结果，后续失败保留最近成功快照", async () => {
		const first = deferred<string>();
		const load = vi
			.fn()
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce("new revision")
			.mockRejectedValueOnce(new KitError("conflict", "项目正在发布"));
		const query = createQuery<string>(load);
		const old = query.refresh();
		await query.refresh();
		first.resolve("old revision");
		await old;
		expect(query.getSnapshot()).toEqual({ data: "new revision", loading: false, error: null });
		await query.refresh();
		expect(query.getSnapshot()).toEqual({ data: "new revision", loading: false, error: "项目正在发布" });
		query.dispose();
	});
	it("释放查询会取消读取，迟到结果不再通知已经离开的视图", async () => {
		const pending = deferred<string>();
		let signal: AbortSignal | undefined;
		const query = createQuery((current) => {
			signal = current;
			return pending.promise;
		});
		const changed = vi.fn();
		const unsubscribe = query.subscribe(changed);
		const reading = query.refresh();
		expect(signal?.aborted).toBe(false);
		const snapshot = query.getSnapshot();
		query.dispose();
		expect(signal?.aborted).toBe(true);
		pending.resolve("late result");
		await expect(reading).resolves.toBeUndefined();
		expect(query.getSnapshot()).toBe(snapshot);
		expect(changed).toHaveBeenCalledOnce();
		unsubscribe();
	});
	it("发布进行中拒绝重复提交，失败交给调用方且不自动重发", async () => {
		const pending = deferred<string>();
		const action = vi.fn(() => pending.promise);
		const mutation = createMutation(action);
		const running = mutation.run();
		await expect(mutation.run()).rejects.toMatchObject({ code: "conflict" });
		pending.reject(new Error("结果待核对"));
		await expect(running).rejects.toThrow("结果待核对");
		expect(action).toHaveBeenCalledTimes(1);
		expect(mutation.getSnapshot()).toEqual({ pending: false, error: "结果待核对" });
	});
	it("释放提交状态不重发或取消写入，结果仍交给调用方且不回写旧视图", async () => {
		const pending = deferred<string>();
		const action = vi.fn(() => pending.promise);
		const mutation = createMutation(action);
		const changed = vi.fn();
		const unsubscribe = mutation.subscribe(changed);
		const running = mutation.run();
		const snapshot = mutation.getSnapshot();
		mutation.dispose();
		pending.resolve("accepted");
		await expect(running).resolves.toBe("accepted");
		expect(action).toHaveBeenCalledOnce();
		expect(changed).toHaveBeenCalledOnce();
		expect(mutation.getSnapshot()).toBe(snapshot);
		unsubscribe();
	});
});
