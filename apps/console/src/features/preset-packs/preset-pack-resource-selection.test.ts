import { expect, it } from "vitest";
import { selectPresetPackResource } from "./preset-pack-resource-selection.ts";

// 保护运行时资源的选择数量合同，避免导入时才发现多环境或资源超量。
it("确认其他环境替换原选择，支持取消且保留其他类型的资源", () => {
	const current = new Map([
		["environment", ["env_a"]],
		["file", ["file_a", "file_b"]],
	]);
	const replaced = selectPresetPackResource(current, "environment", "env_b", true);
	expect(replaced.get("environment")).toEqual(["env_b"]);
	expect(replaced.get("file")).toEqual(["file_a", "file_b"]);
	expect(current.get("environment")).toEqual(["env_a"]);
	expect(selectPresetPackResource(replaced, "environment", "env_b", false).get("environment")).toEqual([]);
	expect(selectPresetPackResource(current, "environment", "env_b", false).get("environment")).toEqual(["env_a"]);
});

it.each([
	{ type: "file", max: 10 },
	{ type: "memory_store", max: 8 },
	{ type: "vault", max: 10 },
])("$type 支持多选和去重，最多 $max 个，取消后可补选", ({ type, max }) => {
	let selected = new Map([["environment", ["env_keep"]]]);
	for (let index = 0; index < max; index++)
		selected = selectPresetPackResource(selected, type, `resource_${index}`, true);
	const full = selected.get(type);
	expect(full).toHaveLength(max);
	selected = selectPresetPackResource(selected, type, "resource_0", true);
	expect(selected.get(type)).toEqual(full);
	selected = selectPresetPackResource(selected, type, "resource_extra", true);
	expect(selected.get(type)).toEqual(full);
	selected = selectPresetPackResource(selected, type, "resource_0", false);
	selected = selectPresetPackResource(selected, type, "resource_extra", true);
	expect(selected.get(type)).toHaveLength(max);
	expect(selected.get(type)).toContain("resource_extra");
	expect(selected.get(type)).not.toContain("resource_0");
	expect(selected.get("environment")).toEqual(["env_keep"]);
});
