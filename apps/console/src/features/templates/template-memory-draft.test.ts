import { describe, expect, it, vi } from "vitest";
import {
	emptyTemplateMemory,
	hasPendingMemories,
	importedTemplateMemory,
	loadImportedMemories,
	memoryCreateInput,
	mergeImportedMemories,
	prepareTemplateMemories,
	type TemplateMemoryDraft,
	validateTemplateMemories,
} from "./template-memory-draft.ts";

const cloud: TemplateMemoryDraft = {
	key: "cloud",
	memory_store_id: "memory-cloud",
	name: "云端记忆",
	access: "read_only",
	instructions: "只检索项目资料",
};

describe("记忆库默认表单与导入", () => {
	it("确认导入时完整回填条目，保留现有编辑，失败不改变原草稿", async () => {
		const draft = { ...emptyTemplateMemory(), name: "本地草稿" };
		const other = { ...cloud, key: "other", memory_store_id: "memory-other" };
		const read = vi.fn(async (row: TemplateMemoryDraft) => ({
			memory_store_id: row.memory_store_id,
			name: row.name!,
			description: "原描述",
			entries: [{ key: "guide.md", content: "完整正文" }],
		}));
		const current = [draft];
		const result = await loadImportedMemories(current, [cloud], read);
		expect(result[0]).toBe(draft);
		expect(result[1]?.configuration?.entries).toMatchObject([{ key: "guide.md", content: "完整正文" }]);
		expect(hasPendingMemories([result[1]!])).toBe(false);
		read.mockResolvedValueOnce({
			memory_store_id: cloud.memory_store_id,
			name: cloud.name!,
			description: "原描述",
			entries: [{ key: "latest.md", content: "最新正文" }],
		});
		const refreshed = await loadImportedMemories([result[1]!], [cloud], read);
		expect(refreshed[0]?.configuration?.entries[0]?.content).toBe("最新正文");
		const changed = { ...result[1]!, name: "已有编辑" };
		read.mockClear();
		const repeated = await loadImportedMemories([changed], [cloud], read);
		expect(repeated[0]).toBe(changed);
		expect(read).not.toHaveBeenCalled();
		read.mockRejectedValueOnce(new Error("条目读取失败"));
		await expect(loadImportedMemories(current, [other], read)).rejects.toThrow("条目读取失败");
		expect(current).toEqual([draft]);
		expect(cloud).not.toHaveProperty("configuration");
	});
	it("导入和只改挂载配置复用原库，修改条目后创建包含未改条目的新库", async () => {
		const imported = importedTemplateMemory(cloud, {
			memory_store_id: cloud.memory_store_id,
			name: cloud.name!,
			description: "原描述",
			entries: [
				{ key: "a.md", content: "原正文" },
				{ key: "b.md", content: "保留正文" },
			],
		});
		const create = vi.fn(async () => ({ memory_store_id: "memory-copy", name: "副本" }));
		const original = [{ ...imported, access: "read_write" as const, instructions: "新挂载说明" }];
		expect(await prepareTemplateMemories(original, create, vi.fn())).toBe(original);
		expect(create).not.toHaveBeenCalled();
		const changed = {
			...imported,
			configuration: {
				...imported.configuration!,
				entries: imported.configuration!.entries.map((entry) =>
					entry.key === "a.md" ? { ...entry, content: "新正文" } : entry,
				),
			},
		};
		expect(hasPendingMemories([changed])).toBe(true);
		expect(memoryCreateInput(changed, "revision").entries).toEqual([
			{ key: "a.md", content: "新正文" },
			{ key: "b.md", content: "保留正文" },
		]);
		const saved = await prepareTemplateMemories([changed], create, vi.fn());
		expect(create).toHaveBeenCalledTimes(1);
		expect(saved[0]).toMatchObject({
			memory_store_id: "memory-copy",
			key: cloud.key,
			access: cloud.access,
			instructions: cloud.instructions,
		});
		expect(saved[0]).not.toHaveProperty("configuration");
		expect(imported.configuration!.entries[0]?.content).toBe("原正文");
		expect(hasPendingMemories([imported])).toBe(false);
	});
	it("重复路径拒绝复制；敏感投影可复用原库但不能另存", () => {
		const imported = importedTemplateMemory(cloud, {
			memory_store_id: cloud.memory_store_id,
			name: cloud.name!,
			description: "",
			entries: [],
			copy_restricted_fields: ["正文"],
		});
		expect(validateTemplateMemories([imported])).toBeNull();
		expect(validateTemplateMemories([{ ...imported, name: "修改名称" }])).toContain("无法完整复制");
		const row = {
			...emptyTemplateMemory(),
			name: "新库",
			creation: {
				description: "",
				entries: [
					{ id: "a", key: "a.md", content: "" },
					{ id: "b", key: "/a.md", content: "" },
				],
			},
		};
		expect(validateTemplateMemories([row])).toBe("条目路径不能重复");
	});
	it("空配置可跳过，填写新库须校验名称，权限与说明不作为创建输入", () => {
		expect(validateTemplateMemories([])).toBeNull();
		const row = emptyTemplateMemory();
		expect(validateTemplateMemories([row])).toBe("请输入记忆库名称");
		row.name = "  新记忆库  ";
		row.creation!.description = " 本地描述 ";
		row.access = "read_only";
		row.instructions = "使用说明";
		expect(memoryCreateInput(row, "revision")).toEqual({
			base_revision: "revision",
			name: "新记忆库",
			description: "本地描述",
		});
	});
	it("导入保持已有权限、说明和新库表单，不重复加入同一引用", () => {
		const pending = { ...emptyTemplateMemory(), name: "待创建" };
		expect(mergeImportedMemories([cloud, pending], [{ ...cloud, access: "read_write", instructions: "" }])).toEqual([
			cloud,
			pending,
		]);
		expect(mergeImportedMemories([cloud, pending], [])).toEqual([pending]);
	});
	it("已有库调整挂载配置不创建资源，部分成功后重试只创建剩余新库", async () => {
		const create = vi.fn(async (row: TemplateMemoryDraft) => ({
			memory_store_id: `local:${row.key}`,
			name: row.name!,
		}));
		const onPrepared = vi.fn();
		const existing = [{ ...cloud, access: "read_write" as const, instructions: "新的挂载说明" }];
		expect(await prepareTemplateMemories(existing, create, onPrepared)).toBe(existing);
		expect(create).not.toHaveBeenCalled();
		const first = { ...emptyTemplateMemory(), name: "第一个" };
		const second = { ...emptyTemplateMemory(), name: "第二个" };
		let current: TemplateMemoryDraft[] = [cloud, first, second];
		create
			.mockResolvedValueOnce({ memory_store_id: "local:first", name: "第一个" })
			.mockRejectedValueOnce(new Error("创建失败"));
		await expect(
			prepareTemplateMemories(current, create, (rows) => {
				current = rows;
			}),
		).rejects.toThrow("创建失败");
		expect(current[1]).not.toHaveProperty("creation");
		expect(current[1]?.memory_store_id).toBe("local:first");
		expect(hasPendingMemories(current)).toBe(true);
		const result = await prepareTemplateMemories(current, create, (rows) => {
			current = rows;
		});
		expect(create.mock.calls.map(([row]) => row.name)).toEqual(["第一个", "第二个", "第二个"]);
		expect(hasPendingMemories(result)).toBe(false);
		expect(result[0]).toBe(cloud);
		expect(result[2]).toMatchObject({ access: "read_write", instructions: "" });
	});
});
