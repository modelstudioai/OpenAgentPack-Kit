import type { PresetPackPreview, PresetPackView } from "@openagentpack/kit-sdk/protocol";
import { expect, it } from "vitest";
import { createTemplateDraft, mergeTemplateRuntimeResources } from "./template-draft.ts";

// 预设包不能自动保存/发布模版或把远端名称误填为新的展示名称；版本与已选绑定必须完整保留。
it("预设包回填固定版本、资源与挂载配置，展示配置仍由用户填写", () => {
	const preset: PresetPackView = {
		preset_pack_id: "preset_one",
		created_at: "2026-11-10T00:00:00Z",
		remote_agent_id: "agent_one",
		remote_agent_name: "源智能体",
		agent_version: 2,
		remote_environment_id: "env_one",
		remote_environment_name: "源环境",
		files: [{ file_id: "file_one", filename: "guide.txt", mount_path: "/mnt/guide.txt", size: 2 }],
		memory_stores: [{ memory_store_id: "mem_one", access: "read_only" }],
		vault_ids: ["vlt_one"],
	};
	const draft = createTemplateDraft(undefined, preset);
	expect(draft.agent).toMatchObject({ agent_id: "agent_one", name: "源智能体", version: 2, agent_version: 2 });
	expect(draft.environment).toEqual({ environment_id: "env_one", name: "源环境" });
	expect(draft.files).toEqual([{ ...preset.files[0], available: true }]);
	expect(draft.memories).toEqual([
		{
			key: "mem_one",
			name: "mem_one",
			memory_store_id: "mem_one",
			access: "read_only",
			instructions: "",
			referenceOnly: true,
		},
	]);
	expect(draft.vaults).toEqual([{ vault_id: "vlt_one", name: "vlt_one" }]);
	expect(draft.name).toBe("");
	expect(draft.category).toBe("general");
	expect(draft.presentation).toEqual({ description: "", opening_remarks: "", suggested_prompts: "" });
	const display = {
		name: "已填写的展示名称",
		category: "coding" as const,
		presentation: { description: "已有说明", opening_remarks: "你好", suggested_prompts: "已有问题" },
	};
	const imported = createTemplateDraft(undefined, preset, display);
	expect(imported).toMatchObject(display);
	expect(imported.agent?.agent_version).toBe(2);
	expect(imported.files).toEqual(draft.files);
	draft.files[0]!.mount_path = "/mnt/changed.txt";
	expect(preset.files[0]?.mount_path).toBe("/mnt/guide.txt");
});

const associatedResources: PresetPackPreview = {
	remote_agent_id: "agent_one",
	remote_agent_name: "源智能体",
	agent_version: 2,
	files: [{ file_id: "file_one", filename: "guide.txt", mount_path: "/mnt/guide.txt" }],
	memory_stores: [{ memory_store_id: "mem_one", access: "read_only" }],
	vault_ids: ["vlt_one"],
};

// 关联选中资源应补充已有草稿，不能清掉独立配置或覆盖相同资源的用户编辑。
it("关联资源按 ID 补充，保留原有草稿、路径及权限，不重建基础配置", () => {
	const current = createTemplateDraft();
	current.name = "已填名称";
	current.agent = { agent_id: "agent_one", name: "已有配置", agent_version: 2 };
	current.environment = { environment_id: "env_keep", name: "原环境" };
	current.files = [
		{ file_id: "file_one", filename: "edited.txt", mount_path: "/mnt/edited.txt", available: true },
		{ file_id: "file_keep", filename: "keep.txt", mount_path: "/mnt/keep.txt", available: true },
	];
	current.memories = [{ key: "mem_one", memory_store_id: "mem_one", access: "read_write", instructions: "保留说明" }];
	current.vaults = [{ vault_id: "vlt_keep", name: "保留密钥库" }];
	const result = mergeTemplateRuntimeResources(current, associatedResources);
	expect(result.environment).toBe(current.environment);
	expect(result.files).toEqual(current.files);
	expect(result.memories).toEqual(current.memories);
	expect(result.vaults.map((vault) => vault.vault_id)).toEqual(["vlt_keep", "vlt_one"]);
	expect(current.vaults).toHaveLength(1);
	expect({ ...current, ...result }).toMatchObject({ name: "已填名称", agent: current.agent });
	const repeated = mergeTemplateRuntimeResources(result, associatedResources);
	expect(repeated).toEqual(result);
	const selectedEnvironment = mergeTemplateRuntimeResources(result, {
		...associatedResources,
		remote_environment_id: "env_selected",
		remote_environment_name: "所选环境",
	});
	expect(selectedEnvironment.environment).toEqual({ environment_id: "env_selected", name: "所选环境" });
});

it("新关联的文件路径与记忆权限按发现结果保留，路径冲突时不修改原配置", () => {
	const current = createTemplateDraft();
	const result = mergeTemplateRuntimeResources(current, associatedResources);
	expect(result.files[0]).toMatchObject({ file_id: "file_one", mount_path: "/mnt/guide.txt" });
	expect(result.memories[0]).toMatchObject({ memory_store_id: "mem_one", access: "read_only", referenceOnly: true });
	current.files = [{ file_id: "different_file", filename: "other.txt", mount_path: "/mnt/guide.txt", available: true }];
	expect(() => mergeTemplateRuntimeResources(current, associatedResources)).toThrow("文件挂载路径不能重复");
	expect(current.files).toHaveLength(1);
	expect(current.memories).toEqual([]);
});

it.each(["files", "memories", "vaults"] as const)("关联与现有 %s 合并后超限时全部拒绝，保留当前资源", (type) => {
	const current = createTemplateDraft();
	if (type === "files")
		current.files = Array.from({ length: 10 }, (_, i) => ({
			file_id: `file_keep_${i}`,
			filename: `${i}.txt`,
			available: true,
		}));
	if (type === "memories")
		current.memories = Array.from({ length: 8 }, (_, i) => ({
			key: String(i),
			memory_store_id: `mem_keep_${i}`,
			access: "read_only",
			instructions: "",
		}));
	if (type === "vaults")
		current.vaults = Array.from({ length: 10 }, (_, i) => ({ vault_id: `vlt_keep_${i}`, name: String(i) }));
	const before = structuredClone(current);
	expect(() => mergeTemplateRuntimeResources(current, associatedResources)).toThrow("最多选择");
	expect(current).toEqual(before);
});
