import type { PresetPackSession } from "@openagentpack/kit-sdk/protocol";
import { expect, it } from "vitest";
import { groupPresetPackResources } from "./preset-pack-resource-groups.ts";

// 保护跨会话的资源身份与信息保真：底层 ID 相同只显示一行，不能丢失挂载差异。
it("按底层 ID 合并不同会话和挂载记录，并保留路径、权限与来源", () => {
	const sessions: PresetPackSession[] = [
		{
			session_id: "session_a",
			status: "idle",
			resources: [
				{
					type: "file",
					file_id: "file_shared",
					resource_id: "mount_a",
					mount_path: "/uploads/a.txt",
					access: "read_only",
					sources: ["session"],
				},
				{ type: "environment", environment_id: "env_shared", sources: ["session"] },
			],
		},
		{
			session_id: "session_b",
			status: "idle",
			resources: [
				{
					type: "file",
					file_id: "file_shared",
					resource_id: "mount_b",
					mount_path: "/uploads/b.txt",
					access: "read_write",
					sources: ["runtime"],
				},
				{ type: "environment", environment_id: "env_shared", sources: ["session"] },
			],
		},
	];
	const groups = groupPresetPackResources(sessions);
	expect(groups.map((group) => [group.type, group.rows.length])).toEqual([
		["file", 1],
		["environment", 1],
	]);
	expect(groups[0]?.rows[0]).toMatchObject({
		id: "file_shared",
		mountPaths: ["/uploads/a.txt", "/uploads/b.txt"],
		accesses: ["read_only", "read_write"],
		sources: ["session", "runtime"],
	});
});

it("不同类型相同 ID 分开分组，未知类型可按资源 ID 去重", () => {
	const resources: PresetPackSession["resources"] = [
		{ type: "file", file_id: "shared_id", sources: ["runtime"] },
		{ type: "memory_store", memory_store_id: "shared_id", sources: ["session"] },
		{ type: "future_resource", resource_id: "resource_unknown", sources: ["runtime"] },
	];
	const groups = groupPresetPackResources([
		{ session_id: "session_a", status: "idle", resources },
		{ session_id: "session_b", status: "idle", resources },
	]);
	expect(groups.map((group) => [group.type, group.rows.length])).toEqual([
		["file", 1],
		["memory_store", 1],
		["future_resource", 1],
	]);
	expect(new Set(groups.flatMap((group) => group.rows.map((row) => row.key))).size).toBe(3);
});

it("缺少资源 ID 时不跨会话误合并，并保留可识别的仓库地址", () => {
	const groups = groupPresetPackResources(
		["session_a", "session_b"].map((session_id) => ({
			session_id,
			status: "idle",
			resources: [
				{ type: "github_repository", repository_url: "https://github.com/example/repo", sources: ["session"] },
			],
		})),
	);
	expect(groups[0]?.rows).toHaveLength(2);
	expect(groups[0]?.rows.map((row) => row.id)).toEqual([undefined, undefined]);
	expect(groups[0]?.rows[0]?.repositoryUrls).toEqual(["https://github.com/example/repo"]);
});
