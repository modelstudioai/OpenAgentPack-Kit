import { KitError, type OperationView } from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminClient } from "./client.ts";
import { createAdminOperation } from "./operation.ts";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

const operation = (status: OperationView["status"]): OperationView => ({
	operation_id: "op1",
	kind: "project.publish",
	status,
	progress: status === "succeeded" ? 1 : 0,
	log: [],
	created_at: "2026-10-23T00:00:00Z",
	updated_at: "2026-10-23T00:00:00Z",
});

describe("管理操作观测", () => {
	afterEach(() => vi.useRealTimers());
	it("刷新恢复时较早GET不能覆盖SSE终态", async () => {
		const initial = deferred<OperationView>();
		const client = {
			operations: {
				get: () => initial.promise,
				stream: async (_id: string, accept: (value: OperationView) => void) => {
					accept(operation("succeeded"));
				},
			},
		} as unknown as AdminClient;
		const observer = createAdminOperation(client, "op1");
		await observer.start();
		initial.resolve(operation("pending"));
		await Promise.resolve();
		expect(observer.getSnapshot().operation?.status).toBe("succeeded");
		observer.dispose();
	});
	it("进度自然断流仅重连观测；完成后停止重连，取消后不交付迟到结果", async () => {
		vi.useFakeTimers();
		const initial = deferred<OperationView>();
		const stream = vi
			.fn()
			.mockImplementationOnce(async (_id: string, accept: (value: OperationView) => void) => {
				accept(operation("running"));
				throw new KitError("provider_error", "unexpected EOF", { retryable: true });
			})
			.mockImplementationOnce(async (_id: string, accept: (value: OperationView) => void) => {
				accept(operation("succeeded"));
			});
		const client = { operations: { get: () => initial.promise, stream } } as unknown as AdminClient;
		const observer = createAdminOperation(client, "op1");
		const observing = observer.start();
		await vi.runAllTimersAsync();
		await observing;
		expect(stream).toHaveBeenCalledTimes(2);
		expect(observer.getSnapshot()).toMatchObject({ operation: { status: "succeeded" }, error: null });
		observer.dispose();
		initial.resolve(operation("running"));
		await Promise.resolve();
		expect(observer.getSnapshot().operation?.status).toBe("succeeded");
	});
	it("只接受当前操作，终态不回退，释放后不再接收流更新", async () => {
		let accept!: (value: OperationView) => void;
		const client = {
			operations: {
				get: async () => operation("pending"),
				stream: async (_id: string, callback: typeof accept) => {
					accept = callback;
					callback({ ...operation("failed"), operation_id: "other" });
					callback(operation("running"));
					callback(operation("succeeded"));
					callback(operation("running"));
				},
			},
		} as unknown as AdminClient;
		const observer = createAdminOperation(client, "op1");
		const statuses: Array<OperationView["status"] | undefined> = [];
		const unsubscribe = observer.subscribe(() => statuses.push(observer.getSnapshot().operation?.status));
		await observer.start();
		expect(statuses).toEqual([undefined, "running", "succeeded"]);
		const snapshot = observer.getSnapshot();
		observer.dispose();
		accept(operation("failed"));
		expect(observer.getSnapshot()).toBe(snapshot);
		unsubscribe();
	});
});
