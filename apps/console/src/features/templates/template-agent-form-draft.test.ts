import { describe, expect, it } from "vitest";
import {
	agentFormDeclaration,
	agentFormDraftChanged,
	agentFormInput,
	BUILTIN_TOOLS,
	createAgentFormDraft,
} from "./template-agent-form-draft.ts";

describe("基础配置另存草稿", () => {
	it("系统提示词普通链接与原有占位符按正文复制，不推断为脱敏", () => {
		const instructions =
			"  访问 https://example.com 和 https://example.com/search?q=hello#section\n[redacted] 是示例占位符。\n";
		const result = createAgentFormDraft({ name: "原助手", configuration: { model: "auto", instructions } });
		expect(result.error).toBeUndefined();
		expect(result.issues).toEqual([]);
		expect(agentFormInput(result.draft, "revision").instructions).toBe(instructions);
	});
	it("描述的链接和占位符按原文回填与复制，不误判为脱敏", () => {
		const description = "  资料 https://example.com 和 https://example.com/docs?q=hello#section\n[redacted] 是示例。\n";
		const result = createAgentFormDraft({ name: "原助手", description, configuration: { model: "auto" } });
		expect(result.error).toBeUndefined();
		expect(result.issues).toEqual([]);
		expect(result.draft.description).toBe(description);
		expect(agentFormInput(result.draft, "revision").description).toBe(description);
	});
	it("配置权限后禁用工具仍可提交，重新启用恢复页面保留的策略", () => {
		const { draft } = createAgentFormDraft({
			name: "权限助手",
			configuration: {
				model: "auto",
				tools: { builtin: ["read", "write"], default_permission: "ask", permissions: { read: "allow", write: "ask" } },
			},
		});
		const disabled = { ...draft, tools: { ...draft.tools!, builtin: ["write"] } };
		expect(agentFormInput(disabled, "revision").tools).toMatchObject({
			builtin: ["write"],
			default_permission: "ask",
			permissions: { write: "ask" },
		});
		expect(agentFormInput(disabled, "revision").tools?.permissions).not.toHaveProperty("read");
		expect(disabled.tools.permissions).toEqual({ read: "allow", write: "ask" });
		const restored = { ...disabled, tools: { ...disabled.tools, builtin: draft.tools!.builtin } };
		expect(agentFormInput(restored, "revision").tools?.permissions).toEqual(draft.tools!.permissions);
	});
	it("导入默认与单工具审批策略，权限修改触发另存，恢复继承后消除修改并完整保存声明", () => {
		const { draft, error } = createAgentFormDraft({
			name: "权限助手",
			configuration: {
				model: "auto",
				tools: [
					{
						type: "builtin_toolkit",
						default_config: { enabled: false, permission_policy: { type: "always_ask" } },
						configs: [
							{ name: "read", enabled: true, permission_policy: { type: "always_allow" } },
							{ name: "bash", enabled: true },
						],
					},
				],
			},
		});
		expect(error).toBeUndefined();
		expect(draft.tools).toMatchObject({
			builtin: ["read", "bash"],
			default_permission: "ask",
			permissions: { read: "allow" },
		});
		const inherited = { ...draft, tools: { ...draft.tools!, permissions: undefined } };
		expect(agentFormDraftChanged(draft, inherited)).toBe(true);
		expect(agentFormDraftChanged(draft, { ...draft, tools: { ...draft.tools!, default_permission: "allow" } })).toBe(
			true,
		);
		expect(
			agentFormDraftChanged(draft, { ...inherited, tools: { ...inherited.tools, permissions: { read: "allow" } } }),
		).toBe(false);
		const input = agentFormInput(draft, "revision");
		expect(agentFormDeclaration(input, { id: "local" }).tools).toMatchObject(draft.tools!);
	});
	it("导入多 Agent 后另存完整保留名册，关闭模式删除旧声明，重新开启还原选择", () => {
		const multiagent = {
			type: "coordinator" as const,
			agents: [{ type: "self" as const }, "local-worker", { agent_id: "agent_existing" }],
		};
		const result = createAgentFormDraft({ name: "协调者", configuration: { model: "auto", multiagent } });
		expect(result.error).toBeUndefined();
		expect(result.draft.multiAgentEnabled).toBe(true);
		const input = agentFormInput({ ...result.draft, name: "副本" }, "r1");
		expect(input.multiagent).toEqual(multiagent);
		expect(agentFormDeclaration(input, { id: "local", multiagent }).multiagent).toEqual(multiagent);
		const disabled = { ...result.draft, multiAgentEnabled: false };
		expect(agentFormDraftChanged(result.draft, disabled)).toBe(true);
		expect(agentFormDeclaration(agentFormInput(disabled, "r1"), { multiagent })).not.toHaveProperty("multiagent");
		expect(agentFormDraftChanged(result.draft, { ...disabled, multiAgentEnabled: true })).toBe(false);
	});
	it.each([
		{ type: "coordinator", agents: [{ type: "self", agent_id: "agent_other" }] },
		{ type: "coordinator", agents: [{ type: "agent", id: "agent_child", version: 3 }] },
		{ type: "coordinator", agents: [{ agent_id: "agent_child", extension: "must-not-drop" }] },
	])("SDK 无法无损表示的名册阻止另存：%j", (multiagent) => {
		const result = createAgentFormDraft({ name: "原版", configuration: { model: "auto", multiagent } });
		expect(result.error).toBeTruthy();
		expect(result.issues[0]?.field).toMatch(/^multiagent/);
	});
	it("Provider 的空名册按关闭模式导入", () => {
		const result = createAgentFormDraft({
			name: "原版",
			configuration: { multiagent: { type: "coordinator", agents: [] } },
		});
		expect(result.error).toBeUndefined();
		expect(result.draft.multiAgentEnabled).toBe(false);
	});
	it.each(["name", "description", "instructions"] as const)("有损展示投影不能另存：%s", (field) => {
		const result = createAgentFormDraft({
			name: "原助手",
			description: "资料 https://example.com/docs",
			configuration: { model: "auto", instructions: "Use https://example.com/search for lookup." },
			redacted_fields: [field],
		});
		expect(result.error).toBeTruthy();
		expect(result.issues).toContainEqual({ field, reason: expect.stringContaining("已脱敏") });
	});
	it("旧详情响应的名称占位符仍阻止复制，描述占位符按正文处理", () => {
		const result = createAgentFormDraft({
			name: "助手 [redacted]",
			description: "[redacted]",
			configuration: { model: "auto" },
		});
		expect(result.issues.map((issue) => issue.field)).toEqual(["name"]);
	});

	it("还原工具和能力选择后复用原 Agent，提示词实际变化仍视为修改", () => {
		const { draft } = createAgentFormDraft({
			name: "原助手",
			configuration: {
				model: "auto",
				instructions: "原提示词",
				mcp_servers: [{ name: "first" }, { name: "second" }],
				skills: [{ type: "custom", skill_id: "skill_example", name: "旧名", version: "1" }],
			},
		});
		const restored = {
			...draft,
			name: " 原助手 ",
			tools: { builtin: [...BUILTIN_TOOLS].reverse() },
			mcpServers: [...draft.mcpServers].reverse(),
			capabilities: {
				skills: draft.capabilities.skills.map((skill) => ({ ...skill, name: "新展示名" })),
			},
		};
		expect(agentFormDraftChanged(draft, restored)).toBe(false);
		expect(agentFormDraftChanged(draft, { ...restored, instructions: "新提示词" })).toBe(true);
	});
	it("复制具体版本保留工具开关、MCP 工具范围及 Skill 固定版本", () => {
		const result = createAgentFormDraft({
			name: "原助手",
			description: "描述",
			configuration: {
				model: { id: "auto" },
				instructions: "  原文\n",
				tools: [
					{ type: "builtin_toolkit", default_config: { enabled: true }, configs: [{ name: "bash", enabled: false }] },
					{
						type: "mcp_toolkit",
						mcp_server_name: "search",
						default_config: { enabled: false },
						configs: [{ name: "query", enabled: true }],
					},
				],
				mcp_servers: [{ type: "official", name: "search" }],
				skills: [{ type: "customer", skill_id: "skill_report", name: "报告", version: "3" }],
			},
		});
		expect(result.error).toBeUndefined();
		const input = agentFormInput({ ...result.draft, name: "副本" }, "revision");
		expect(input).toMatchObject({
			name: "副本",
			model: "auto",
			instructions: "  原文\n",
			skills: [{ type: "custom", skill_id: "skill_report", version: "3" }],
			mcp_servers: ["search"],
			tools: {
				builtin: BUILTIN_TOOLS.filter((name) => name !== "bash"),
				mcp: [
					{
						mcp_server_name: "search",
						default_config: { enabled: false },
						configs: [{ name: "query", enabled: true }],
					},
				],
			},
		});
	});
	it.each([
		{
			configuration: { mcp_servers: [{ type: "url", url: "https://example.com", name: "custom" }] },
			field: "mcp_servers[0].url",
			reason: "仅支持官方 MCP",
		},
		{ configuration: { tools: [{ type: "unknown" }] }, field: "tools[0].type", reason: "不支持此工具类型" },
		{
			configuration: {
				tools: [
					{
						type: "builtin_toolkit",
						default_config: { enabled: false, permission_policy: { type: "never_allow" } },
						configs: [{ name: "read", enabled: true }],
					},
				],
			},
			field: "tools[0].default_config.permission_policy.type",
			reason: "审批或权限策略",
		},
		{
			configuration: { tools: [{ type: "mcp_toolkit", configs: [{ name: "search", enabled: true }] }] },
			field: "tools[0].mcp_server_name",
			reason: "字段为空",
		},
		{
			configuration: {
				tools: [
					{
						type: "mcp_toolkit",
						mcp_server_name: "server",
						default_config: { enabled: true, permission_policy: { type: "always_ask" } },
					},
				],
			},
			field: "tools[0].default_config.permission_policy.type",
			reason: "MCP 工具审批",
		},
		{
			configuration: { skills: [{ type: "customer", skill_id: "skill_example" }] },
			field: "skills[0].version",
			reason: "固定版本",
		},
	])("不能复制时定位到具体字段：$field", ({ configuration, field, reason }) => {
		const result = createAgentFormDraft({ name: "原助手", configuration });
		expect(result.error).toBeTruthy();
		expect(result.issues).toContainEqual({ field, reason: expect.stringContaining(reason) });
	});
	it("同时报告多个配置区的问题，不回显配置值或动态敏感键", () => {
		const result = createAgentFormDraft({
			name: "原助手",
			configuration: {
				skills: [{ type: "custom", skill_id: "skill_example", version: "latest" }],
				mcp_servers: [
					{
						name: "custom",
						url: "https://example.com?token=do-not-display",
						headers: { "do-not-display": "[redacted]" },
					},
				],
			},
		});
		expect(result.issues.map((issue) => issue.field)).toEqual([
			"mcp_servers[0].headers.[字段]",
			"skills[0].version",
			"mcp_servers[0].url",
		]);
		expect(JSON.stringify(result.issues)).not.toContain("do-not-display");
		expect(JSON.stringify(result.issues)).not.toContain("https://");
	});
	it("编辑本地草稿保留未编辑字段，移除 MCP 与 Skill 不残留旧引用", () => {
		const declaration = agentFormDeclaration(
			{ base_revision: "r2", name: "新名", model: "auto", tools: { builtin: ["read"] } },
			{
				id: "local",
				name: "旧名",
				model: "old",
				instructions: "old",
				skills: ["skill"],
				mcp_servers: [{ name: "old" }],
				environment: "base",
			},
		);
		expect(declaration).toEqual({
			id: "local",
			name: "新名",
			model: "auto",
			instructions: "",
			environment: "base",
			tools: { builtin: ["read"], mcp: [] },
		});
	});
});
