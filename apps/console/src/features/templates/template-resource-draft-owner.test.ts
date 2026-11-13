import { KitError, type ResourceDraftView } from "@openagentpack/kit-sdk/protocol";
import { describe, expect, it, vi } from "vitest";
import {
	createTemplateResourceDraftOwner,
	TemplateResourceDraftUnavailableError,
} from "./template-resource-draft-owner.ts";

function draft(id = "batch-a", status: ResourceDraftView["status"] = "draft"): ResourceDraftView {
	return {
		draft_id: id,
		project_name: id,
		status,
		resources: [],
		cleanup_pending: false,
		created_at: "",
		updated_at: "",
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}
function fixture(active: ResourceDraftView | null = null) {
	const cleanupKey = "1cdbca71-447b-4ba8-b559-5fc1f7877a1a";
	const client = {
		active: vi.fn<() => Promise<ResourceDraftView | null>>().mockResolvedValue(active),
		create: vi.fn<() => Promise<ResourceDraftView>>().mockResolvedValue(draft()),
		get: vi.fn<(id: string) => Promise<ResourceDraftView>>().mockResolvedValue(draft()),
		discard: vi
			.fn<(id: string, options?: { keepalive?: boolean; cleanupKey?: string }) => Promise<{ discarded: boolean }>>()
			.mockResolvedValue({ discarded: true }),
	};
	const releaseLock = vi.fn();
	const claim = vi
		.fn<() => Promise<{ release: () => void; cleanupKey: string }>>()
		.mockResolvedValue({ release: releaseLock, cleanupKey });
	const onDraft = vi.fn();
	const owner = createTemplateResourceDraftOwner({ client, claim, onDraft });
	return { client, claim, releaseLock, onDraft, owner, cleanupKey };
}

describe("模版新建资源页面所有权", () => {
	// StrictMode 不是真实离页；打开页面本身不写，关闭单个资源弹窗也不释放页面所有权。
	it("StrictMode重放不清理；创建单飞，实际离页才清理", async () => {
		const t = fixture();
		const releaseFirst = t.owner.acquire();
		const initial = t.owner.initialize();
		releaseFirst();
		const releaseFinal = t.owner.acquire();
		await initial;
		expect(t.client.create).not.toHaveBeenCalled();
		expect(t.client.discard).not.toHaveBeenCalled();
		const request = t.owner.ensureDraft();
		expect(t.owner.ensureDraft()).toBe(request);
		await request;
		expect(t.client.create).toHaveBeenCalledTimes(1);
		expect(t.client.discard).not.toHaveBeenCalled();
		releaseFinal();
		await Promise.resolve();
		await t.owner.leave();
		expect(t.client.discard.mock.calls).toEqual([["batch-a", { keepalive: false, cleanupKey: t.cleanupKey }]]);
		expect(t.releaseLock).toHaveBeenCalledTimes(1);
	});

	// 迟到的创建不能回填已退出页面，锁须一直保留到旧批次清理结束。
	it("退出后创建晚到，以keepalive清理旧ID后才释放锁", async () => {
		const t = fixture();
		const creation = deferred<ResourceDraftView>();
		const cleanup = deferred<{ discarded: boolean }>();
		t.client.create.mockReturnValue(creation.promise);
		t.client.discard.mockReturnValue(cleanup.promise);
		t.owner.acquire();
		await t.owner.initialize();
		const request = t.owner.ensureDraft();
		await Promise.resolve();
		expect(t.client.create).toHaveBeenCalledTimes(1);
		const leaving = t.owner.leave(true);
		expect(t.releaseLock).not.toHaveBeenCalled();
		creation.resolve(draft("late-old"));
		await expect(request).rejects.toThrow("已离开");
		await Promise.resolve();
		expect(t.client.discard.mock.calls).toEqual([["late-old", { keepalive: true, cleanupKey: t.cleanupKey }]]);
		expect(t.onDraft.mock.calls).toEqual([[null]]);
		expect(t.releaseLock).not.toHaveBeenCalled();
		cleanup.resolve({ discarded: true });
		await leaving;
		expect(t.releaseLock).toHaveBeenCalledTimes(1);
	});

	// HTTP失败后服务端active是可靠重试来源，不能先将旧声明放进候选列表。
	it("重进清理旧批次失败时隐藏旧候选，显式重试成功后才允许新建", async () => {
		const t = fixture(draft("old"));
		t.client.discard.mockRejectedValueOnce(new Error("offline"));
		t.owner.acquire();
		await expect(t.owner.initialize()).rejects.toThrow("清理失败");
		expect(t.onDraft).not.toHaveBeenCalled();
		expect(t.client.create).not.toHaveBeenCalled();
		await expect(t.owner.initialize()).resolves.toBeNull();
		expect(t.client.discard).toHaveBeenCalledTimes(2);
		expect(t.onDraft).toHaveBeenLastCalledWith(null);
		await expect(t.owner.ensureDraft()).resolves.toMatchObject({ draft_id: "batch-a" });
		await t.owner.leave();
		expect(t.client.discard.mock.calls.map(([id]) => id)).toEqual(["old", "old", "batch-a"]);
	});

	// failed DTO 不能代表可以删除；服务端phase是唯一判定依据。
	it("未知发布结果明确拒绝丢弃时保留恢复入口，普通409不冒充未知结果", async () => {
		const t = fixture(draft("uncertain", "failed"));
		t.client.discard.mockRejectedValue(
			new KitError("conflict", "结果待核对", {
				details: { reason: "publication_unresolved" },
			}),
		);
		t.owner.acquire();
		await expect(t.owner.initialize()).resolves.toMatchObject({ status: "failed" });
		expect(t.onDraft).toHaveBeenCalledWith(draft("uncertain", "failed"));
		await t.owner.leave();
		expect(t.releaseLock).toHaveBeenCalled();
		const busy = fixture(draft("busy"));
		busy.client.discard.mockRejectedValue(new KitError("conflict", "目录被占用"));
		busy.owner.acquire();
		await expect(busy.owner.initialize()).rejects.toThrow("清理失败");
		expect(busy.onDraft).not.toHaveBeenCalled();
		await busy.owner.leave();
	});

	// 已发布内容保留receipt，清理只针对后来新建的批次，不能按当前active重新决定目标。
	it("已发布批次退出不discard，下一批只清理自己的ID", async () => {
		const t = fixture();
		t.owner.acquire();
		await t.owner.ensureDraft();
		t.owner.accept(draft("batch-a", "published"));
		t.client.create.mockResolvedValue(draft("batch-b"));
		await t.owner.ensureDraft();
		await t.owner.leave();
		expect(t.client.discard.mock.calls).toEqual([["batch-b", { keepalive: false, cleanupKey: t.cleanupKey }]]);
		const published = fixture({ ...draft("receipt", "published"), cleanup_pending: true });
		published.owner.acquire();
		await published.owner.initialize();
		await published.owner.leave(true);
		expect(published.client.discard).not.toHaveBeenCalled();
	});

	// GET和discard之间完成发布时不能丢掉待清理receipt；旧ID已被清理则幂等接受。
	it("discard返回false后读取最新receipt，404视为已清理", async () => {
		const t = fixture(draft("finished"));
		t.client.discard.mockResolvedValue({ discarded: false });
		t.client.get.mockResolvedValue({ ...draft("finished", "published"), cleanup_pending: true });
		t.owner.acquire();
		await expect(t.owner.initialize()).resolves.toMatchObject({ status: "published", cleanup_pending: true });
		await t.owner.leave();
		expect(t.client.discard).toHaveBeenCalledTimes(1);
		const gone = fixture(draft("gone"));
		gone.client.discard.mockResolvedValue({ discarded: false });
		gone.client.get.mockRejectedValue(new KitError("not_found", "已清理"));
		gone.owner.acquire();
		await expect(gone.owner.initialize()).resolves.toBeNull();
		await gone.owner.leave();
	});

	// 多标签/不支持锁的浏览器不能接管同一批次，但远端资源预览不受影响。
	it("锁不可用时不读写另一页批次，仍可直接预览远端资源", async () => {
		const t = fixture(draft("other-tab"));
		t.claim.mockRejectedValue(new TemplateResourceDraftUnavailableError("另一页正在创建"));
		t.owner.acquire();
		await expect(t.owner.initialize()).rejects.toThrow("另一页");
		await expect(t.owner.readActive()).resolves.toBeNull();
		await expect(t.owner.ensureDraft()).rejects.toThrow("另一页");
		await t.owner.leave();
		expect(t.client.active).not.toHaveBeenCalled();
		expect(t.client.create).not.toHaveBeenCalled();
		expect(t.client.discard).not.toHaveBeenCalled();
	});

	// 空白页浏览不产生批次或清理请求。
	it("没有新建内容时退出不写入任何资源", async () => {
		const t = fixture();
		t.owner.acquire();
		await t.owner.initialize();
		await t.owner.leave(true);
		expect(t.client.create).not.toHaveBeenCalled();
		expect(t.client.discard).not.toHaveBeenCalled();
	});

	it("另一浏览器持有服务端批次时不清理、不恢复其候选，远端资源预览仍可用", async () => {
		const t = fixture();
		t.client.active.mockRejectedValue(
			new KitError("conflict", "原浏览器仍持有批次", { details: { reason: "draft_owned_elsewhere" } }),
		);
		t.owner.acquire();
		await expect(t.owner.initialize()).rejects.toBeInstanceOf(TemplateResourceDraftUnavailableError);
		expect(t.client.active).toHaveBeenCalledWith(undefined, t.cleanupKey);
		await expect(t.owner.readActive()).resolves.toBeNull();
		await expect(t.owner.ensureDraft()).rejects.toThrow("原浏览器");
		await t.owner.leave();
		expect(t.client.create).not.toHaveBeenCalled();
		expect(t.client.discard).not.toHaveBeenCalled();
		expect(t.onDraft).not.toHaveBeenCalled();
	});
});
