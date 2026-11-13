import { describe, expect, it, vi } from "vitest";
import { createTemplateDebugSessionOwner } from "./template-debug-session-owner.ts";

function deferredSession() {
	let resolve!: (session: { session_id: string }) => void;
	const promise = new Promise<{ session_id: string }>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

describe("模版调试会话所有权", () => {
	// 保护 StrictMode 重挂与重复点击：共享一个创建请求，仍在使用的会话不能被清理。
	it("StrictMode 同轮重挂复用创建与已有会话，真实释放才清理一次", async () => {
		const creation = deferredSession();
		const create = vi.fn(() => creation.promise);
		const cleanup = vi.fn();
		const owner = createTemplateDebugSessionOwner({ create, cleanup });
		const firstRelease = owner.acquire();
		const firstRequest = owner.create();
		firstRelease();
		const finalRelease = owner.acquire();
		firstRelease();
		expect(owner.create()).toBe(firstRequest);
		await Promise.resolve();
		expect(create).toHaveBeenCalledTimes(1);
		creation.resolve({ session_id: "session-strict" });
		await expect(firstRequest).resolves.toBe("session-strict");
		await expect(owner.create()).resolves.toBe("session-strict");
		expect(create).toHaveBeenCalledTimes(1);
		expect(cleanup).not.toHaveBeenCalled();
		finalRelease();
		finalRelease();
		await Promise.resolve();
		expect(cleanup.mock.calls).toEqual([["session-strict"]]);
	});

	// 保护离开预览时尚未返回的创建：会话不能泄漏，也不能被当作可用会话返回。
	it("释放后晚到的创建结果只清理一次并返回 null", async () => {
		const creation = deferredSession();
		const create = vi.fn(() => creation.promise);
		const cleanup = vi.fn();
		const owner = createTemplateDebugSessionOwner({ create, cleanup });
		const release = owner.acquire();
		const request = owner.create();
		await Promise.resolve();
		expect(create).toHaveBeenCalledTimes(1);
		release();
		await Promise.resolve();
		creation.resolve({ session_id: "session-late" });
		await expect(request).resolves.toBeNull();
		release();
		await expect(owner.create()).resolves.toBeNull();
		expect(create).toHaveBeenCalledTimes(1);
		expect(cleanup.mock.calls).toEqual([["session-late"]]);
	});

	// 保护真实离开后再次使用：已经排队清理的 ID 不得重新交给预览。
	it("真实释放后重新挂载创建新会话，不复用已清理 ID", async () => {
		const create = vi
			.fn<() => Promise<{ session_id: string }>>()
			.mockResolvedValueOnce({ session_id: "session-old" })
			.mockResolvedValueOnce({ session_id: "session-new" });
		const cleanup = vi.fn();
		const owner = createTemplateDebugSessionOwner({ create, cleanup });
		const releaseOld = owner.acquire();
		await expect(owner.create()).resolves.toBe("session-old");
		releaseOld();
		await Promise.resolve();
		expect(cleanup.mock.calls).toEqual([["session-old"]]);
		const releaseNew = owner.acquire();
		await expect(owner.create()).resolves.toBe("session-new");
		expect(create).toHaveBeenCalledTimes(2);
		releaseNew();
		await Promise.resolve();
		expect(cleanup.mock.calls).toEqual([["session-old"], ["session-new"]]);
	});

	// 保护跨生命周期乱序响应：旧请求不能覆盖重新挂载后已经建立的新会话。
	it("重新挂载后旧创建晚到，只回收旧会话并保留新会话", async () => {
		const oldCreation = deferredSession();
		const newCreation = deferredSession();
		const create = vi
			.fn<() => Promise<{ session_id: string }>>()
			.mockReturnValueOnce(oldCreation.promise)
			.mockReturnValueOnce(newCreation.promise);
		const cleanup = vi.fn();
		const owner = createTemplateDebugSessionOwner({ create, cleanup });
		const releaseOld = owner.acquire();
		const oldRequest = owner.create();
		releaseOld();
		await Promise.resolve();
		const releaseNew = owner.acquire();
		const newRequest = owner.create();
		expect(newRequest).not.toBe(oldRequest);
		newCreation.resolve({ session_id: "session-current" });
		await expect(newRequest).resolves.toBe("session-current");
		oldCreation.resolve({ session_id: "session-stale" });
		await expect(oldRequest).resolves.toBeNull();
		await expect(owner.create()).resolves.toBe("session-current");
		expect(create).toHaveBeenCalledTimes(2);
		expect(cleanup.mock.calls).toEqual([["session-stale"]]);
		releaseNew();
		await Promise.resolve();
		expect(cleanup.mock.calls).toEqual([["session-stale"], ["session-current"]]);
	});

	// 保护失败恢复：不自动创建额外资源，用户后续显式操作才重新尝试。
	it("创建失败不自动重试，后续显式创建可以成功", async () => {
		const failure = new Error("创建失败");
		const create = vi
			.fn<() => Promise<{ session_id: string }>>()
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce({ session_id: "session-retry" });
		const cleanup = vi.fn();
		const owner = createTemplateDebugSessionOwner({ create, cleanup });
		const release = owner.acquire();
		await expect(owner.create()).rejects.toBe(failure);
		await Promise.resolve();
		expect(create).toHaveBeenCalledTimes(1);
		expect(cleanup).not.toHaveBeenCalled();
		await expect(owner.create()).resolves.toBe("session-retry");
		expect(create).toHaveBeenCalledTimes(2);
		release();
		await Promise.resolve();
		expect(cleanup.mock.calls).toEqual([["session-retry"]]);
	});
});
