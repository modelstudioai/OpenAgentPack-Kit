import { ProjectAgentMultiagentSchema, RemoteAgentVersionDetailSchema } from "@openagentpack/kit-sdk/protocol";
import { setDefaultFetch } from "@openagentpack/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSdkGateway } from "../src/gateway/sdk.ts";

const gateway = () =>
	createSdkGateway({ apiKey: "sk-unit-test-credential", baseUrl: "https://provider.example.test/api/v1/agentstudio" });
afterEach(() => setDefaultFetch(fetch));

describe("远端 Agent 列表的 SDK HTTP 契约", () => {
	it("目录标记协调 Agent，普通 Agent 与已清空名册仍可作为子 Agent", async () => {
		setDefaultFetch(async () =>
			Response.json({
				data: [
					{ id: "agent_child", name: "子 Agent" },
					{
						id: "agent_coordinator",
						name: "协调者",
						multiagent: { type: "coordinator", agents: [{ type: "agent", id: "agent_child" }] },
					},
					{ id: "agent_disabled", multiagent: { type: "coordinator", agents: [] } },
				],
			}),
		);
		expect(await gateway().listRemoteAgents()).toEqual([
			{ agent_id: "agent_child", name: "子 Agent" },
			{ agent_id: "agent_coordinator", name: "协调者", is_coordinator: true },
			{ agent_id: "agent_disabled", name: "agent_disabled" },
		]);
	});
	it("遍历 Provider 游标，保留第 100 条后的 Agent，并按 ID 合并跨页重复项", async () => {
		const calls: URL[] = [];
		const agents = Array.from({ length: 101 }, (_, index) => ({
			id: `agent-${index + 1}`,
			name: `Agent ${index + 1}`,
			version: 1,
		}));
		const nextPage = "opaque+next/page=";
		setDefaultFetch(async (input) => {
			const url = new URL(String(input));
			calls.push(url);
			if (!url.searchParams.has("page")) {
				return Response.json({ data: agents.slice(0, 100), next_page: nextPage });
			}
			return Response.json({ data: agents.slice(99), has_more: false, next_page: null });
		});

		const result = await gateway().listRemoteAgents();
		expect(result).toEqual(agents.map(({ id, name, version }) => ({ agent_id: id, name, version })));
		expect(calls.map((url) => url.searchParams.get("page"))).toEqual([null, nextPage]);
		for (const url of calls) {
			expect(url.pathname).toBe("/api/v1/agentstudio/agents");
			expect(url.searchParams.get("limit")).toBe("100");
		}
	});

	it("has_more 缺少游标时拒绝返回不完整列表", async () => {
		setDefaultFetch(async () =>
			Response.json({ data: [{ id: "agent-visible", name: "Visible agent" }], has_more: true, next_page: null }),
		);
		await expect(gateway().listRemoteAgents()).rejects.toMatchObject({
			code: "provider_error",
			message: "远端 Agent 列表缺少下一页游标，请重试",
		});
	});

	it("循环游标中止请求，避免无限加载或返回截断结果", async () => {
		const calls: (string | null)[] = [];
		setDefaultFetch(async (input) => {
			const page = new URL(String(input)).searchParams.get("page");
			calls.push(page);
			return Response.json({
				data: [{ id: `agent-${calls.length}`, name: "Visible agent" }],
				has_more: true,
				next_page: page === "cursor-a" ? "cursor-b" : "cursor-a",
			});
		});
		await expect(gateway().listRemoteAgents()).rejects.toMatchObject({
			code: "provider_error",
			message: "远端 Agent 列表分页游标重复，请重试",
		});
		expect(calls).toEqual([null, "cursor-a", "cursor-b"]);
	});
});

describe("远端 Agent 历史版本的 SDK HTTP 契约", () => {
	it("Self 的空身份与版本占位按未设置导入，不标记为有损配置", async () => {
		setDefaultFetch(async () =>
			Response.json({
				id: "agent-1",
				version: 1,
				multiagent: { type: "coordinator", agents: [{ type: "self", id: null, version: null }] },
			}),
		);
		const detail = await gateway().getRemoteAgentVersionDetail("agent-1", 1);
		expect(ProjectAgentMultiagentSchema.parse(detail?.configuration.multiagent)).toEqual({
			type: "coordinator",
			agents: [{ type: "self" }],
		});
		expect(detail?.redacted_fields).toBeUndefined();
	});
	it.each([{ id: "agent_other" }, { version: 2 }, { extension: true }])(
		"Self 的实际身份、版本或扩展仍保留并拒绝另存：%j",
		async (extra) => {
			setDefaultFetch(async () =>
				Response.json({
					id: "agent-1",
					version: 1,
					multiagent: { type: "coordinator", agents: [{ type: "self", id: null, version: null, ...extra }] },
				}),
			);
			const detail = await gateway().getRemoteAgentVersionDetail("agent-1", 1);
			expect(detail?.configuration.multiagent).toEqual({ type: "coordinator", agents: [{ type: "self", ...extra }] });
			expect(ProjectAgentMultiagentSchema.safeParse(detail?.configuration.multiagent).success).toBe(false);
		},
	);
	it.each([false, true])("多 Agent 历史配置无损转换远端引用并保留 Self 与固定版本信息：config=%s", async (wrapped) => {
		const multiagent = {
			type: "coordinator",
			agents: [
				{ type: "agent", id: "agent_child" },
				"agent_other",
				{ type: "agent", id: "agent_pinned", version: 3 },
				{ type: "self" },
			],
		};
		setDefaultFetch(async () =>
			Response.json({ id: "agent-1", version: 1, ...(wrapped ? { config: { multiagent } } : { multiagent }) }),
		);
		const detail = await gateway().getRemoteAgentVersionDetail("agent-1", 1);
		expect(RemoteAgentVersionDetailSchema.parse(detail).configuration.multiagent).toEqual({
			type: "coordinator",
			agents: [{ agent_id: "agent_child" }, { agent_id: "agent_other" }, multiagent.agents[2], multiagent.agents[3]],
		});
	});
	it("多 Agent 扩展字段内的凭据脱敏并标记有损，不能作为可复制配置", async () => {
		setDefaultFetch(async () =>
			Response.json({
				id: "agent-1",
				version: 1,
				multiagent: { type: "coordinator", agents: [{ type: "agent", id: "agent_child", token: "do-not-expose" }] },
			}),
		);
		const detail = await gateway().getRemoteAgentVersionDetail("agent-1", 1);
		expect(detail?.redacted_fields).toContain("multiagent");
		expect(JSON.stringify(detail)).not.toContain("do-not-expose");
	});
	// 脱敏 URL 不一定包含占位符；显式标记有损字段，阻止浏览器把展示投影另存成配置。
	it("名称继续标记脱敏，描述和系统提示词保留完整 URL 与正文", async () => {
		setDefaultFetch(async () =>
			Response.json({
				id: "agent-1",
				version: 1,
				name: "助手 Bearer do-not-expose-name",
				description: "资料 https://example.com/docs?lang=zh#guide",
				model: { id: "auto", max_tokens: null },
				system: "Use https://example.com/search?q=hello#section for lookup.",
			}),
		);
		const sdk = gateway();
		const detail = await sdk.getRemoteAgentVersionDetail("agent-1", 1);
		expect(detail).toMatchObject({
			name: "助手 [redacted]",
			description: "资料 https://example.com/docs?lang=zh#guide",
			configuration: { instructions: "Use https://example.com/search?q=hello#section for lookup." },
			redacted_fields: ["name"],
		});
		expect(JSON.stringify(detail)).not.toMatch(/do-not-expose/);
		expect(RemoteAgentVersionDetailSchema.parse(detail).redacted_fields).toEqual(["name"]);
		setDefaultFetch(async () =>
			Response.json({ id: "agent-1", version: 1, name: "助手", model: { id: "auto" }, system: "  保留正文\n" }),
		);
		const unchanged = await sdk.getRemoteAgentVersionDetail("agent-1", 1);
		expect(unchanged?.configuration.instructions).toBe("  保留正文\n");
		expect(unchanged).not.toHaveProperty("redacted_fields");
	});

	it("描述和提示词原有 URL、占位符和空白不改写，也不标记为受损配置", async () => {
		const system =
			"  请访问 https://example.com 和 https://example.com/search?q=hello#section\n输出 [redacted] 表示占位。\n";
		const description = "  参考 https://example.com 和 https://example.com/docs?q=hello#section\n[redacted] 为示例。\n";
		setDefaultFetch(async () =>
			Response.json({ id: "agent-1", version: 1, name: "助手", description, model: "auto", system }),
		);
		const sdk = gateway();
		const original = await sdk.getRemoteAgentVersionDetail("agent-1", 1);
		expect(original?.configuration.instructions).toBe(system);
		expect(original?.description).toBe(description);
		expect(original).not.toHaveProperty("redacted_fields");
	});

	// 用户查看任意历史版配置时必须读取该快照，并在服务端截断 Provider 原始属性与凭据。
	it.each([false, true])("历史配置详情按白名单投影并脱敏，兼容 config 快照形状：%s", async (wrapped) => {
		const configuration = {
			name: "历史助手",
			description: "历史版本描述",
			model: {
				name: "qwen-test",
				max_tokens: wrapped ? null : 8192,
				maxTokens: "8192",
				api_key: "do-not-expose-model-key",
				token: "do-not-expose-model-token",
			},
			system: "根据历史资料回答",
			tools: { builtin: ["read-file"], permissions: { ReadFile: "allow" }, credentials: "do-not-expose-tools" },
			skills: [{ id: "skill-v1", version: "1", name: "历史技能" }],
			mcp_servers: [
				{
					name: "search",
					url: `${wrapped ? "HTTPS" : "https"}://user:do-not-expose-password@mcp.example.test/sse?key=do-not-expose-query#secret`,
					headers: { Authorization: "Bearer do-not-expose-header" },
					env: { PRIVATE: "do-not-expose-env" },
					args: ["--password", "do-not-expose-argument"],
				},
			],
		};
		const calls: URL[] = [];
		setDefaultFetch(async (input) => {
			calls.push(new URL(String(input)));
			return Response.json({
				id: "agent-1",
				version: 1,
				created_at: "2026-10-30T00:00:00Z",
				metadata: { private: "do-not-expose-metadata" },
				...(wrapped ? { config: configuration } : configuration),
			});
		});
		const detail = await gateway().getRemoteAgentVersionDetail("agent-1", 1);
		expect(detail).toEqual({
			agent_id: "agent-1",
			name: "历史助手",
			version: 1,
			created_at: "2026-10-30T00:00:00Z",
			description: "历史版本描述",
			configuration: {
				model: {
					name: "qwen-test",
					max_tokens: wrapped ? null : 8192,
					maxTokens: "8192",
					api_key: "[redacted]",
					token: "[redacted]",
				},
				instructions: "根据历史资料回答",
				tools: { builtin: ["read-file"], permissions: { ReadFile: "allow" }, credentials: "[redacted]" },
				skills: [{ id: "skill-v1", version: "1", name: "历史技能" }],
				mcp_servers: [
					{
						name: "search",
						url: "https://mcp.example.test/sse",
						headers: "[redacted]",
						env: "[redacted]",
						args: "[redacted]",
					},
				],
			},
			redacted_fields: ["model", "tools", "mcp_servers"],
		});
		expect(JSON.stringify(detail)).not.toContain("do-not-expose");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.pathname).toBe("/api/v1/agentstudio/agents/agent-1");
		expect(calls[0]?.searchParams.get("version")).toBe("1");
	});

	// 名称来自同一 Skill 版本；只取名称，不把下载内容、原始属性或凭据带进浏览器。
	it("缺名 Skill 按绑定版本补全并去重，已有名称与声明名称不查询", async () => {
		const skills = [
			{ skill_id: "skill-history", version: 1, name: "skill-history", type: "official", extension: "keep" },
			{ skillId: "skill-history", version: "1" },
			{ id: "skill-unversioned" },
			{ skill_id: "skill-named", version: "2", name: "快照名称" },
			{ skill_id: "skill-snake", skill_name: "蛇形名称" },
			{ skill_id: "skill-camel", skillName: "驼峰名称" },
			"local-skill-name",
		] as const;
		const calls: string[] = [];
		setDefaultFetch(async (input) => {
			const path = new URL(String(input)).pathname;
			calls.push(path);
			if (path.endsWith("/agents/agent-1")) return Response.json({ id: "agent-1", version: 1, config: { skills } });
			if (path.endsWith("/skills/skill-history/versions/1"))
				return Response.json({
					skill_id: "skill-history",
					version: "1",
					name: "历史技能 sk-do-not-expose-name",
					description: "do-not-expose-description",
					content: "do-not-expose-content",
					metadata: { private: "do-not-expose-metadata" },
				});
			if (path.endsWith("/skills/skill-unversioned"))
				return Response.json({ id: "skill-unversioned", name: "未绑定版本的技能", latest_version: "9" });
			throw new Error(`Unexpected request: ${path}`);
		});
		const detail = await gateway().getRemoteAgentVersionDetail("agent-1", 1);
		expect(detail?.configuration.skills).toEqual([
			{ ...skills[0], name: "历史技能 [redacted]" },
			{ ...skills[1], name: "历史技能 [redacted]" },
			{ ...skills[2], name: "未绑定版本的技能" },
			...skills.slice(3),
		]);
		expect(calls).toHaveLength(3);
		expect(calls.filter((path) => path.endsWith("/skills/skill-history/versions/1"))).toHaveLength(1);
		expect(JSON.stringify(detail)).not.toContain("do-not-expose");
	});

	// 同一元数据从候选或详情补名进入浏览器时，必须遵守同一凭据脱敏边界。
	it("Skill 候选与 Agent 历史详情补名一致隐藏 Basic、完整 Bearer 和键值凭据", async () => {
		const name =
			"资料研究 Authorization: Basic Zml4dHVyZTpwYXNzd29yZA==; Authorization: Bearer abc+/token==; api_key=do-not-expose-key";
		const safeName = "资料研究 Authorization=[redacted]; Authorization=[redacted]; api_key=[redacted]";
		const skill = { id: "skill-one", name, source: "customer", status: "active", latest_version: "1.0" };
		setDefaultFetch(async (input) => {
			const path = new URL(String(input)).pathname;
			if (path.endsWith("/skills")) return Response.json({ data: [skill], has_more: false });
			if (path.endsWith("/skills/skill-one/versions/1.0"))
				return Response.json({ skill_id: skill.id, version: "1.0", name, status: "active" });
			if (path.endsWith("/agents/agent-1"))
				return Response.json({
					id: "agent-1",
					version: 1,
					config: { skills: [{ skill_id: skill.id, version: "1.0" }] },
				});
			throw new Error(`Unexpected request: ${path}`);
		});
		const sdk = gateway();
		const candidates = await sdk.listRemoteSkills("custom");
		const detail = await sdk.getRemoteAgentVersionDetail("agent-1", 1);
		expect(candidates[0]?.name).toBe(safeName);
		expect(detail?.configuration.skills).toEqual([{ skill_id: skill.id, version: "1.0", name: safeName }]);
		expect(JSON.stringify({ candidates, detail })).not.toMatch(/Zml4dHVyZTpwYXNzd29yZA|abc\+\/token|do-not-expose/);
	});

	it("Skill 名称查询失败或身份不匹配保留原引用，非法路径不请求且不回退最新版本", async () => {
		const skills = [
			{ skill_id: "skill-missing", version: "1.0" },
			{ skill_id: "skill-wrong-id", version: "1.0" },
			{ skill_id: "skill-wrong-version", version: "1.0" },
			{ skill_id: "../unsafe", version: "1.0" },
			{ skill_id: "skill-invalid-version", version: ".." },
			{ skill_id: "skill-floating-version", version: "latest" },
		];
		const calls: string[] = [];
		setDefaultFetch(async (input) => {
			const path = new URL(String(input)).pathname;
			calls.push(path);
			if (path.endsWith("/agents/agent-1")) return Response.json({ id: "agent-1", version: 1, skills });
			if (path.endsWith("/skills/skill-missing/versions/1.0"))
				return Response.json({ message: "Not found" }, { status: 404 });
			if (path.endsWith("/skills/skill-wrong-id/versions/1.0"))
				return Response.json({ skill_id: "another-skill", version: "1.0", name: "错误技能" });
			if (path.endsWith("/skills/skill-wrong-version/versions/1.0"))
				return Response.json({ skill_id: "skill-wrong-version", version: "2.0", name: "最新技能" });
			throw new Error(`Unexpected request: ${path}`);
		});
		const detail = await gateway().getRemoteAgentVersionDetail("agent-1", 1);
		expect(detail?.configuration.skills).toEqual(skills);
		expect(calls).toHaveLength(4);
		expect(calls.slice(1).every((path) => path.endsWith("/versions/1.0"))).toBe(true);
	});

	it("遍历完整版本游标，兼容无 id 的快照条目，去重降序且不返回配置正文", async () => {
		const calls: URL[] = [];
		const nextPage = "opaque+version/page=";
		setDefaultFetch(async (input) => {
			const url = new URL(String(input));
			calls.push(url);
			return Response.json(
				url.searchParams.has("page")
					? {
							data: [
								{ agent_id: "agent-1", version: 2 },
								{ agent_id: "agent-1", version: 1 },
							],
							next_page: null,
						}
					: {
							data: [
								{ agent_id: "agent-1", version: 2, config: { system: "private agent instructions" } },
								{ agent_id: "agent-1", version: 3 },
							],
							next_page: nextPage,
						},
			);
		});
		expect(await gateway().listRemoteAgentVersions("agent-1")).toEqual([
			{ version: 3 },
			{ version: 2 },
			{ version: 1 },
		]);
		expect(calls.map((url) => url.searchParams.get("page"))).toEqual([null, nextPage]);
		for (const url of calls) {
			expect(url.pathname).toBe("/api/v1/agentstudio/agents/agent-1/versions");
			expect(url.searchParams.get("limit")).toBe("100");
		}
	});

	it.each([
		{ next_page: undefined, message: "智能体版本列表缺少下一页游标，请重试" },
		{ next_page: "repeated-cursor", message: "智能体版本列表分页游标重复，请重试" },
	])("不将分页故障作为完整版本列表：$message", async ({ next_page, message }) => {
		setDefaultFetch(async () => Response.json({ data: [{ version: 1 }], has_more: true, next_page }));
		await expect(gateway().listRemoteAgentVersions("agent-1")).rejects.toMatchObject({
			code: "provider_error",
			message,
		});
	});

	it("非正整数、字符串或缺失版本不得转换为 latest 或可选择版本", async () => {
		for (const version of [0, -1, 1.5, "2", undefined]) {
			setDefaultFetch(async () => Response.json({ data: [{ version }], next_page: null }));
			await expect(gateway().listRemoteAgentVersions("agent-1")).rejects.toMatchObject({ code: "provider_error" });
		}
	});

	it.each(["getRemoteAgentVersion", "getRemoteAgentVersionDetail"] as const)(
		"%s 按请求版本查询，不存在或归档返回 null，忽略版本或错 ID 必须拒绝",
		async (method) => {
			const calls: URL[] = [];
			const replies = [
				{ id: "agent-1", name: "旧版本名称", version: 1, system: "private agent instructions" },
				{ id: "agent-1", version: 1, archived_at: "2026-10-30T00:00:00Z" },
				{ id: "agent-1", version: 3 },
				{ id: "agent-other", version: 1 },
			];
			setDefaultFetch(async (input) => {
				calls.push(new URL(String(input)));
				const reply = replies.shift();
				return reply
					? Response.json(reply)
					: Response.json({ code: "NotFound", message: "not found" }, { status: 404 });
			});
			const sdk = gateway();
			expect(await sdk[method]("agent-1", 1)).toMatchObject({
				agent_id: "agent-1",
				name: "旧版本名称",
				version: 1,
			});
			expect(await sdk[method]("agent-1", 1)).toBeNull();
			for (let index = 0; index < 2; index += 1)
				await expect(sdk[method]("agent-1", 1)).rejects.toMatchObject({ code: "provider_error" });
			expect(await sdk[method]("agent-1", 1)).toBeNull();
			for (const url of calls) {
				expect(url.pathname).toBe("/api/v1/agentstudio/agents/agent-1");
				expect(url.searchParams.get("version")).toBe("1");
			}
		},
	);

	it("拒绝路径注入及非法版本，并将 Provider 错误转换为安全摘要", async () => {
		const fetcher = vi.fn(async () =>
			Response.json({ message: "sk-unit-test-credential provider-secret" }, { status: 403 }),
		);
		setDefaultFetch(fetcher);
		const sdk = gateway();
		for (const id of ["agent-1/versions", "agent-1?version=3", "../agents", "agent%2Fother"]) {
			await expect(sdk.listRemoteAgentVersions(id)).rejects.toMatchObject({ code: "invalid_request" });
			await expect(sdk.getRemoteAgentVersion(id, 1)).rejects.toMatchObject({ code: "invalid_request" });
			await expect(sdk.getRemoteAgentVersionDetail(id, 1)).rejects.toMatchObject({ code: "invalid_request" });
		}
		await expect(sdk.getRemoteAgentVersion("agent-1", 0)).rejects.toMatchObject({ code: "invalid_request" });
		await expect(sdk.getRemoteAgentVersionDetail("agent-1", 0)).rejects.toMatchObject({ code: "invalid_request" });
		expect(fetcher).not.toHaveBeenCalled();
		await expect(sdk.listRemoteAgentVersions("agent-1")).rejects.toMatchObject({
			code: "provider_error",
			message: "智能体版本列表查询失败，请稍后重试",
		});
		await expect(sdk.getRemoteAgentVersion("agent-1", 1)).rejects.toMatchObject({
			code: "provider_error",
			message: "智能体版本查询失败，请稍后重试",
		});
		await expect(sdk.getRemoteAgentVersionDetail("agent-1", 1)).rejects.toMatchObject({
			code: "provider_error",
			message: "智能体版本查询失败，请稍后重试",
		});
	});
});
