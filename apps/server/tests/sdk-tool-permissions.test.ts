import {
	createManagedApiContext,
	type ProjectConfig,
	setDefaultFetch,
	validateProjectConfig,
} from "@openagentpack/sdk";
import { afterEach, expect, it } from "vitest";

afterEach(() => setDefaultFetch(fetch));

// 通过公开 SDK 入口验证实际 HTTP 请求，保护上游 SDK 的审批策略传递与变更比较合同。
it.each(["allow", "ask"] as const)("百炼发布支持默认 %s、单工具覆盖及权限变更差异", async (permission) => {
	const override = permission === "ask" ? "allow" : "ask";
	const config: ProjectConfig = {
		version: "1",
		providers: { bailian: { api_key: "sk-fixture", base_url: "https://provider.example.test/api/v1/agentstudio" } },
		agents: {
			assistant: {
				model: "qwen3.7-max",
				instructions: "权限测试",
				tools: {
					builtin: ["read", "write"],
					default_permission: permission,
					permissions: { read: override, bash: "ask" },
				},
			},
		},
	};
	expect(validateProjectConfig(config)).toEqual([]);
	const posts: Record<string, unknown>[] = [];
	setDefaultFetch(async (_input, init) => {
		if (!init?.method || init.method === "GET") return Response.json({ id: "agent_test", version: 1 });
		const body = JSON.parse(String(init.body)) as Record<string, unknown>;
		posts.push(body);
		return Response.json({ ...body, id: "agent_test", version: 2 });
	});
	const adapter = createManagedApiContext({ providers: config.providers }).providers.get("bailian")!;
	const agent = config.agents!.assistant!;
	const refs = { skill_ids: [] };
	await adapter.createAgent("assistant", agent, refs);
	await adapter.updateAgent("agent_test", "assistant", agent, refs);
	for (const body of posts)
		expect(body.tools).toEqual([
			{
				type: "builtin_toolkit",
				default_config: { enabled: false, permission_policy: { type: `always_${permission}` } },
				configs: [
					{ name: "read", enabled: true, permission_policy: { type: `always_${override}` } },
					{ name: "write", enabled: true },
				],
			},
		]);
	expect(posts).toHaveLength(2);
	expect(posts[1]?.version).toBe(1);
	const desired = adapter.normalizeDesiredResource!("agent", "assistant", agent, refs);
	const unchanged = adapter.normalizeDesiredResource!(
		"agent",
		"assistant",
		{
			...agent,
			tools: {
				builtin: ["read", "write"],
				default_permission: permission,
			},
		},
		refs,
	);
	expect(desired).not.toEqual(unchanged);
	// Provider 可省略继承策略，也可回显等价的显式策略；有效策略相同时不应重复生成更新。
	const explicit = adapter.normalizeDesiredResource!(
		"agent",
		"assistant",
		{
			...agent,
			tools: {
				...agent.tools!,
				permissions: { read: override, write: permission },
			},
		},
		refs,
	);
	expect(desired).toEqual(explicit);
});
