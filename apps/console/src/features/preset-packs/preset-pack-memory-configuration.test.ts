import type { MemoryStoreConfiguration } from "@openagentpack/kit-sdk/protocol";
import { expect, it, vi } from "vitest";
import { loadPresetPackMemoryConfiguration } from "./preset-pack-memory-configuration.ts";

const store = { memory_store_id: "memory_large", name: "大型记忆库" };
const unavailable = async (): Promise<MemoryStoreConfiguration> => {
	throw new Error("记忆库条目超出可编辑范围；可继续复用原库。");
};

// 保护查看后关联原库的流程：完整条目快照受复制上限限制时，仍能显示已核验的可用库摘要。
it("条目无法完整读取时，返回可用原库摘要供确认引用，不伪造空条目", async () => {
	expect(
		await loadPresetPackMemoryConfiguration(
			store.memory_store_id,
			new AbortController().signal,
			unavailable,
			async () => [store],
		),
	).toEqual({ kind: "reference", store });
});

it("完整条目可读时仍展示真实配置", async () => {
	const configuration: MemoryStoreConfiguration = {
		...store,
		description: "原库描述",
		entries: [{ key: "guide.md", content: "使用说明" }],
	};
	expect(
		await loadPresetPackMemoryConfiguration(
			store.memory_store_id,
			new AbortController().signal,
			async () => configuration,
			async () => [],
		),
	).toEqual({ kind: "complete", configuration });
});

it.each(["missing", "offline"])("元数据无法确认原库可用时仍拒绝选择：%s", async (mode) => {
	await expect(
		loadPresetPackMemoryConfiguration(store.memory_store_id, new AbortController().signal, unavailable, async () => {
			if (mode === "offline") throw new Error("目录暂不可用");
			return [{ memory_store_id: "memory_other", name: "另一个可用库" }];
		}),
	).rejects.toThrow(mode === "offline" ? "目录暂不可用" : "记忆库不存在或已不可访问");
});

it("取消详情后不再为了降级摘要读取目录", async () => {
	const controller = new AbortController();
	const listStores = vi.fn(async () => [store]);
	const result = loadPresetPackMemoryConfiguration(
		store.memory_store_id,
		controller.signal,
		async () => {
			controller.abort();
			return unavailable();
		},
		listStores,
	);
	await expect(result).rejects.toMatchObject({ name: "AbortError" });
	expect(listStores).not.toHaveBeenCalled();
});
