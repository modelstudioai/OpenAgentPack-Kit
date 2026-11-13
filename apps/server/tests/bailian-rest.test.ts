import { afterEach, describe, expect, it, vi } from "vitest";
import { filesFromResources, workspaceBaseUrl } from "../src/gateway/bailian-rest.ts";
import { createSdkGateway } from "../src/gateway/sdk.ts";

afterEach(() => vi.unstubAllGlobals());

/**
 * 保护的是「挂载回显 → kit 契约」的映射与 base url 推导：
 * 这条路径绕过 SDK（原因见 gateway/bailian-rest.ts 与 docs/research/bailian-session-file-mount.md），
 * 没有 SDK 类型兜底，映射写错会让 UI 显示不存在的挂载。
 */
describe("bailian REST 窄口子", () => {
	it("指定 Agent 版本必须写入 agent 对象；省略仍使用字符串，且文件不进创建载荷", async () => {
		const calls: { url: string; body: Record<string, unknown> }[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string, init: RequestInit) => {
				calls.push({ url: input, body: JSON.parse(String(init.body)) });
				return Response.json({ id: "session-version", status: "idle" });
			}),
		);
		const sdk = createSdkGateway({ apiKey: "test-key", baseUrl: "https://provider.example.test/api/v1/agentstudio" });
		await sdk.createSession({
			agentId: "agent-1",
			agentVersion: 1,
			environmentId: "env-1",
			title: "历史版本调试",
			memoryStores: [{ memory_store_id: "memory-1", access: "read_only", instructions: "查阅" }],
			vaultIds: ["vault-1"],
		});
		await sdk.createSession({ agentId: "agent-1" });
		expect(calls).toEqual([
			{
				url: "https://provider.example.test/api/v1/agentstudio/sessions",
				body: {
					agent: { id: "agent-1", version: 1 },
					environment_id: "env-1",
					title: "历史版本调试",
					vault_ids: ["vault-1"],
					resources: [{ type: "memory_store", memory_store_id: "memory-1", access: "read_only", instructions: "查阅" }],
				},
			},
			{ url: "https://provider.example.test/api/v1/agentstudio/sessions", body: { agent: "agent-1" } },
		]);
	});

	it("workspaceBaseUrl：显式 base_url 去尾斜杠，否则由 workspace_id 推导", () => {
		expect(workspaceBaseUrl({ apiKey: "k", baseUrl: "https://example.com/api/v1/agentstudio/" })).toBe(
			"https://example.com/api/v1/agentstudio",
		);
		expect(workspaceBaseUrl({ apiKey: "k", workspaceId: "llm-x" })).toBe(
			"https://llm-x.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio",
		);
		expect(() => workspaceBaseUrl({ apiKey: "k" })).toThrow(/BAILIAN_BASE_URL/);
	});

	it("filesFromResources：只取 file_resource，保留 mount_path，null 视为未指定", () => {
		expect(
			filesFromResources([
				{ type: "file_resource", file_id: "f1", mount_path: "/mnt/a.txt" },
				{ type: "file_resource", file_id: "f2", mount_path: null },
				{ type: "github_repository", file_id: "ignored" },
				{ type: "file_resource" },
			]),
		).toEqual([{ file_id: "f1", mount_path: "/mnt/a.txt" }, { file_id: "f2" }]);
		expect(filesFromResources(undefined)).toEqual([]);
	});
});
