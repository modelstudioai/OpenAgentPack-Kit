import { PROTOCOL_VERSION, type RemoteEnvironmentDetail } from "@openagentpack/kit-sdk/protocol";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";
import { installAgentPublishReviewFixture } from "./template-agent-publish-fixture.ts";
import {
	confirmTemplateAgentSelection,
	installTemplateAgentDetailFixture,
	openTemplateAgentPicker,
} from "./template-agent-selection-helpers.ts";
import { installResourceDraftFixture, resourceDraftFixture } from "./template-resource-draft-fixture.ts";

const apiBase = "https://template-agent-create.example/kit";
const createPath = "/api/admin/resource-drafts/resource-draft-1/resources/agents";
const agents = Array.from({ length: 12 }, (_, index) => {
	const suffix = String(index + 1).padStart(2, "0");
	return { agent_id: `agent_${suffix}`, name: `Assistant ${suffix}`, version: index + 1 };
});
const created = {
	new_revision: "revision-2",
	agent: { id: "agent_local_new", name: "本地助手", source_path: "agents/agent_local_new/agent.json" },
};
const remoteSkills = {
	custom: [
		{
			skill_id: "skill_custom_report",
			name: "工单分析",
			source: "custom",
			status: "active",
			latest_version: "3",
			available: true,
		},
		{
			skill_id: "skill_custom_translate",
			name: "翻译工具",
			source: "custom",
			status: "active",
			latest_version: "2",
			available: true,
		},
		...Array.from({ length: 9 }, (_, index) => ({
			skill_id: `skill_custom_${index + 3}`,
			name: index === 8 ? "日志摘要" : `项目工具 ${index + 3}`,
			source: "custom",
			status: "active",
			latest_version: "1",
			available: true,
		})),
	],
	official: [
		{
			skill_id: "skill_official_docs",
			name: "文档检索",
			source: "official",
			status: "active",
			latest_version: "8",
			available: true,
		},
		{
			skill_id: "skill_official_rejected",
			name: "失效插件",
			source: "official",
			status: "rejected",
			available: false,
		},
	],
};

/** 创建入口只保存本地声明；SDK 文件、正文及权限合同由 server 测试保护。 */
async function openTemplate(page: Page, create: (route: Route) => Promise<void>, role: "admin" | "auditor" = "admin") {
	const writes: string[] = [];
	const bodies: unknown[] = [];
	const skillSources: string[] = [];
	const responses: Record<string, unknown> = {
		"/api/admin/identity": { role, subject: `${role}:agent-create` },
		"/api/admin/remote/agents": agents,
		"/api/admin/remote/environments": [{ environment_id: "env_existing", name: "当前运行环境" }],
		"/api/admin/remote/environments/env_existing": {
			environment_id: "env_existing",
			name: "当前运行环境",
			configuration: { type: "cloud", packages: {} },
		} satisfies RemoteEnvironmentDetail,
		"/api/admin/remote/files": [{ file_id: "file_guide", filename: "项目说明.txt", available: true }],
		"/api/admin/remote/memory-stores": [{ memory_store_id: "memory_project", name: "项目记忆" }],
		"/api/admin/remote/vaults": [{ vault_id: "vault_project", name: "项目密钥库" }],
		"/api/admin/projects": [{ name: "project", path: "/test/project" }],
		"/api/admin/projects/project": {
			name: "project",
			project_revision: "ordinary-project-revision",
			aligned: false,
			remote_checked: false,
			drift: [],
			agents: [],
			environments: [],
		},
		"/api/admin/resource-drafts/resource-draft-1/resources/resource-bindings": { resources: [] },
		"/api/admin/resource-drafts/resource-draft-1/resources/agent-options": {
			base_revision: "revision-1",
			skills: [],
			mcp_servers: [{ name: "knowledge-search" }, { name: "browser-tools" }],
		},
		"/api/admin/resource-drafts/resource-draft-1/resources": {
			name: "resource-draft-1",
			project_revision: "revision-1",
			aligned: false,
			remote_checked: false,
			drift: [],
			agents: [],
			environments: [],
		},
	};
	const drafts = resourceDraftFixture();
	await page.route(`${apiBase}/api/**`, async (route) => {
		const request = route.request();
		const requestUrl = new URL(request.url());
		const path = requestUrl.pathname.replace(/^\/kit/, "");
		if (path.endsWith("/config")) {
			return route.fulfill({ json: { data: { apiBaseUrl: apiBase, protocolVersion: PROTOCOL_VERSION } } });
		}
		expect(request.headers().authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
		if (request.method() !== "GET") {
			writes.push(`${request.method()} ${path}`);
			if (request.method() === "POST" && path === createPath) {
				bodies.push(request.postDataJSON());
				return create(route);
			}
			return route.fulfill({ status: 500, json: { error: { code: "internal", message: "仅允许保存本地智能体声明" } } });
		}

		if (path.endsWith("/declarations/agent/agent_local_new")) {
			const input = bodies.at(-1) as Record<string, unknown>;
			return route.fulfill({
				json: {
					data: {
						type: "agent",
						id: created.agent.id,
						source_path: created.agent.source_path,
						base_revision: "revision-2",
						declaration: {
							name: input.name,
							model: input.model,
							instructions: input.instructions,
							skills: input.skills,
							tools: input.tools,
							multiagent: input.multiagent,
						},
						read_only_paths: [],
						references: [],
					},
				},
			});
		}
		return route.fulfill({ json: { data: responses[path] ?? [] } });
	});
	await page.route(`${apiBase}/api/admin/remote/skills?*`, async (route) => {
		const requestUrl = new URL(route.request().url());
		const source = requestUrl.searchParams.get("source");
		expect(["custom", "official"]).toContain(source);
		skillSources.push(source ?? "");
		return route.fulfill({ json: { data: source === "official" ? remoteSkills.official : remoteSkills.custom } });
	});
	await installResourceDraftFixture(page, apiBase, drafts);
	await installTemplateAgentDetailFixture(page, apiBase);
	const preparation = await installAgentPublishReviewFixture(
		page,
		apiBase,
		createPath.replace(/\/agents$/, ""),
		() => "revision-1",
	);
	const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.searchParams.set("api", apiBase);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await openConsoleNavigation(page);
	await page.getByTestId("template-create-tab").click();
	await expect(page.getByRole("heading", { name: "创建智能体", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
	return { writes, bodies, skillSources, drafts, preparation };
}

const basic = (page: Page) => page.getByRole("region", { name: "基础配置", exact: true });
const next = (page: Page) => page.getByRole("button", { name: "下一步：预览调试", exact: true });
async function fillBasic(page: Page) {
	await basic(page).getByRole("textbox", { name: "智能体名称", exact: true }).fill("本地助手");
	await basic(page).getByRole("button", { name: "模型", exact: true }).click();
	await page.getByRole("option", { name: "AUTO", exact: true }).click();
}

test("子 Agent 搜索多选：加载失败可重试、排除协调者、最多 20 个且达到上限仍可取消", async ({ page }, testInfo) => {
	const state = await openTemplate(page, async (route) => route.fulfill({ status: 201, json: { data: created } }));
	await fillBasic(page);
	let calls = 0;
	await page.route(`${apiBase}/api/admin/remote/agents`, (route) => {
		if (++calls === 1)
			return route.fulfill({
				status: 503,
				json: { error: { code: "provider_error", message: "子 Agent 目录暂不可用" } },
			});
		return route.fulfill({
			json: {
				data: [
					...Array.from({ length: 21 }, (_, index) => ({ agent_id: `agent_child_${index}`, name: `Worker ${index}` })),
					{ agent_id: "agent_coordinator", name: "Coordinator", is_coordinator: true },
				],
			},
		});
	});
	await basic(page).getByRole("switch", { name: "Multi-Agent 模式", exact: true }).check();
	await expect(basic(page).getByText("子 Agent 目录暂不可用", { exact: true })).toBeVisible();
	await basic(page).getByRole("button", { name: "重试", exact: true }).click();
	const list = basic(page).getByRole("list", { name: "子 Agent 列表", exact: true });
	await expect(list.getByRole("checkbox")).toHaveCount(22);
	await expect(list.getByRole("checkbox", { name: /Coordinator/ })).toHaveCount(0);
	for (let index = 0; index < 20; index++)
		await list.getByRole("checkbox", { name: `子 Agent Worker ${index}（agent_child_${index}）`, exact: true }).check();
	const last = list.getByRole("checkbox", { name: "子 Agent Worker 20（agent_child_20）", exact: true });
	await expect(last).toBeDisabled();
	await expect(list.getByRole("checkbox", { name: "子 Agent Self（当前智能体自己）", exact: true })).toBeDisabled();
	await list.getByRole("checkbox", { name: "子 Agent Worker 0（agent_child_0）", exact: true }).uncheck();
	await expect(last).toBeEnabled();
	await last.focus();
	await page.keyboard.press("Space");
	await expect(last).toBeChecked();
	await basic(page).getByRole("searchbox", { name: "搜索子 Agent", exact: true }).fill("agent_child_20");
	await expect(list.getByRole("checkbox")).toHaveCount(1);
	await expect(last).toBeChecked();
	await basic(page).getByRole("switch", { name: "Multi-Agent 模式", exact: true }).uncheck();
	await expect(list).toBeHidden();
	await basic(page).getByRole("switch", { name: "Multi-Agent 模式", exact: true }).check();
	await expect(last).toBeChecked();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({ path: testInfo.outputPath("multiagent-selection-mobile.png") });
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	expect(state.bodies).toHaveLength(0);
	expect(state.drafts.created).toBe(0);
});

test("Self 可单独选择：空远端目录仍可保存，取消发布后保留 Self", async ({ page }) => {
	const state = await openTemplate(page, async (route) => route.fulfill({ status: 201, json: { data: created } }));
	await page.route(`${apiBase}/api/admin/remote/agents`, (route) => route.fulfill({ json: { data: [] } }));
	await fillBasic(page);
	await page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true })
		.fill("Self 模版");
	await basic(page).getByRole("switch", { name: "Multi-Agent 模式", exact: true }).check();
	const self = basic(page).getByRole("checkbox", { name: "子 Agent Self（当前智能体自己）", exact: true });
	await self.check();
	await expect(basic(page).getByRole("list", { name: "子 Agent 列表", exact: true }).getByRole("checkbox")).toHaveCount(
		1,
	);
	expect(state.drafts.created).toBe(0);
	await expect(next(page)).toBeEnabled();
	await next(page).click();
	const review = page.getByRole("dialog", { name: "确认发布", exact: true });
	await expect(review).toBeVisible();
	expect(state.bodies).toHaveLength(1);
	expect(state.bodies[0]).toMatchObject({ multiagent: { type: "coordinator", agents: [{ type: "self" }] } });
	await review.getByRole("button", { name: "取消", exact: true }).click();
	await expect(self).toBeChecked();
	expect(state.writes).toEqual([`POST ${createPath}`]);
});

test("基础配置直接新建：校验、模型选择、多来源能力和本地保存单飞", async ({ page }, testInfo) => {
	const gate = Promise.withResolvers<void>();
	const state = await openTemplate(page, async (route) => {
		await gate.promise;
		await route.fulfill({ status: 201, json: { data: created } });
	});
	expect(state.drafts.created).toBe(0);
	await expect(basic(page).getByRole("region", { name: "版本", exact: true })).toHaveText("版本--");
	await expect(basic(page).getByRole("button", { name: "保存基础配置", exact: true })).toHaveCount(0);
	await expect(next(page)).toBeDisabled();
	await fillBasic(page);
	await basic(page).getByRole("switch", { name: "Multi-Agent 模式", exact: true }).check();
	await expect(basic(page).getByRole("alert")).toContainText("请至少选择一个子 Agent");
	await expect(next(page)).toBeDisabled();
	await basic(page).getByRole("searchbox", { name: "搜索子 Agent", exact: true }).fill("agent_12");
	await basic(page).getByRole("checkbox", { name: "子 Agent Assistant 12（agent_12）", exact: true }).check();
	await basic(page).getByRole("searchbox", { name: "搜索子 Agent", exact: true }).fill("self");
	await basic(page).getByRole("checkbox", { name: "子 Agent Self（当前智能体自己）", exact: true }).check();
	expect(state.drafts.created).toBe(0);
	await basic(page).getByRole("textbox", { name: "系统提示词", exact: true }).fill("  指令正文\n\n保留空白\n");
	await page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true })
		.fill("模版草稿");
	await page
		.getByRole("region", { name: "环境", exact: true })
		.getByRole("button", { name: "导入现有配置", exact: true })
		.click();
	await page.getByRole("button", { name: "选择环境 当前运行环境（env_existing）", exact: true }).click();
	await page
		.getByRole("dialog", { name: "环境详情", exact: true })
		.getByRole("button", { name: "确认选择", exact: true })
		.click();
	await basic(page).getByRole("button", { name: "添加 Skill", exact: true }).click();
	const skill = page.getByRole("dialog", { name: "选择 Skill", exact: true });
	await skill.getByRole("button", { name: "选择 Skill 工单分析（skill_custom_report）", exact: true }).click();
	await skill.getByRole("button", { name: "官方 Skill", exact: true }).click();
	await skill.getByRole("button", { name: "选择 Skill 文档检索（skill_official_docs）", exact: true }).click();
	await skill.getByRole("button", { name: "完成", exact: true }).click();
	await basic(page).getByRole("button", { name: "添加 MCP", exact: true }).click();
	await basic(page).getByRole("textbox", { name: "MCP 服务标识", exact: true }).fill("knowledge-search");
	await basic(page).getByRole("checkbox", { name: "bash", exact: true }).uncheck();
	const tools = basic(page).getByRole("region", { name: "工具", exact: true });
	await tools.getByRole("combobox", { name: "默认审批策略", exact: true }).selectOption("ask");
	await tools.getByRole("combobox", { name: "read 权限控制", exact: true }).selectOption("allow");
	await expect(tools.getByRole("combobox", { name: "bash 权限控制", exact: true })).toBeDisabled();
	await basic(page).getByRole("textbox", { name: "智能体名称", exact: true }).scrollIntoViewIfNeeded();
	await page.screenshot({ path: testInfo.outputPath("basic-configuration-desktop.png") });
	await basic(page).getByRole("textbox", { name: "智能体名称", exact: true }).press("Enter");
	expect(state.bodies).toHaveLength(0);
	await next(page).click();
	try {
		await expect.poll(() => state.bodies.length).toBe(1);
		await expect(next(page)).toBeDisabled();
		await expect(page.getByTestId("template-list-tab")).toBeDisabled();
		await page.keyboard.press("Enter");
		expect(state.bodies).toHaveLength(1);
	} finally {
		gate.resolve();
	}
	const review = page.getByRole("dialog", { name: "确认发布", exact: true });
	await expect(review).toBeVisible();
	expect(state.preparation).toEqual(["validate", "plan"]);
	await review.getByRole("button", { name: "取消", exact: true }).click();
	await expect(basic(page).getByRole("textbox", { name: "智能体名称", exact: true })).toHaveValue("本地助手");
	await expect(next(page)).toBeEnabled();
	await expect(tools.getByRole("combobox", { name: "默认审批策略", exact: true })).toHaveValue("ask");
	await expect(tools.getByRole("combobox", { name: "read 权限控制", exact: true })).toHaveValue("allow");
	await expect(page.getByRole("region", { name: "已选配置预览", exact: true })).toContainText("当前运行环境");
	await expect(
		page
			.getByRole("region", { name: "展示配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true }),
	).toHaveValue("模版草稿");
	expect(state.bodies[0]).toMatchObject({
		name: "本地助手",
		model: "auto",
		instructions: "  指令正文\n\n保留空白\n",
		multiagent: { type: "coordinator", agents: [{ agent_id: "agent_12" }, { type: "self" }] },
		skills: [
			{ type: "custom", skill_id: "skill_custom_report", version: "3" },
			{ type: "official", skill_id: "skill_official_docs", version: "8" },
		],
		mcp_servers: ["knowledge-search"],
		tools: { default_permission: "ask", permissions: { read: "allow" } },
	});
	expect(state.writes).toEqual([`POST ${createPath}`]);
	const picker = await openTemplateAgentPicker(page);
	await expect(picker.getByRole("button", { name: "新建", exact: true })).toHaveCount(0);
});

test("已有智能体修改另存新智能体：失败保留草稿、所选版本与运行资源", async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	let attempts = 0;
	const state = await openTemplate(page, async (route) => {
		if (++attempts === 1)
			return route.fulfill({ status: 409, json: { error: { code: "conflict", message: "项目已变化，请重试" } } });
		return route.fulfill({ status: 201, json: { data: created } });
	});
	await page.route(`${apiBase}/api/admin/remote/agents/agent_01/versions/1`, (route) =>
		route.fulfill({
			json: {
				data: {
					agent_id: "agent_01",
					name: "原助手",
					version: 1,
					description: "原描述",
					configuration: {
						model: { id: "auto", max_tokens: null },
						instructions: "原提示词",
						multiagent: { type: "coordinator", agents: [{ type: "self" }, { agent_id: "agent_02" }] },
						tools: [
							{
								type: "builtin_toolkit",
								default_config: { enabled: false, permission_policy: { type: "always_ask" } },
								configs: [{ name: "read", enabled: true }],
							},
						],
						mcp_servers: [{ type: "official", name: "source-mcp" }],
						skills: [{ type: "customer", skill_id: "skill_custom_report", name: "工单分析", version: "2" }],
					},
				},
			},
		}),
	);
	await openTemplateAgentPicker(page);
	await page.getByRole("button", { name: "选择智能体 Assistant 01（agent_01）", exact: true }).click();
	await confirmTemplateAgentSelection(page);
	await expect(basic(page).getByRole("textbox", { name: "智能体名称", exact: true })).toHaveValue("原助手");
	await expect(basic(page).getByRole("checkbox", { name: "read", exact: true })).toBeChecked();
	await expect(basic(page).getByRole("checkbox", { name: "bash", exact: true })).not.toBeChecked();
	await expect(basic(page).getByRole("button", { name: "保存基础配置", exact: true })).toHaveCount(0);
	expect(state.drafts.created).toBe(0);
	await page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true })
		.fill("副本模版");
	await expect(basic(page).getByRole("switch", { name: "Multi-Agent 模式", exact: true })).toBeChecked();
	await expect(
		basic(page).getByRole("checkbox", { name: "子 Agent Self（当前智能体自己）", exact: true }),
	).toBeChecked();
	await expect(
		basic(page).getByRole("checkbox", { name: "子 Agent Assistant 02（agent_02）", exact: true }),
	).toBeChecked();
	await expect(
		basic(page).getByRole("checkbox", { name: "子 Agent Assistant 01（agent_01）", exact: true }),
	).toHaveCount(0);
	const toolPolicy = basic(page).getByRole("combobox", { name: "read 权限控制", exact: true });
	await expect(basic(page).getByRole("combobox", { name: "默认审批策略", exact: true })).toHaveValue("ask");
	await expect(toolPolicy).toHaveValue("default");
	await toolPolicy.selectOption("ask");
	await toolPolicy.selectOption("default");
	await expect(basic(page).getByRole("region", { name: "版本", exact: true })).not.toHaveText("版本--");
	await toolPolicy.selectOption("allow");
	await expect(basic(page).getByRole("region", { name: "版本", exact: true })).toHaveText("版本--");
	await basic(page)
		.getByRole("region", { name: "工具", exact: true })
		.screenshot({ path: testInfo.outputPath("tool-permissions-mobile.png") });
	await basic(page)
		.getByRole("region", { name: "Multi-Agent 模式", exact: true })
		.screenshot({ path: testInfo.outputPath("self-selection-mobile.png") });
	await page.screenshot({ path: testInfo.outputPath("basic-configuration-mobile.png") });
	await next(page).click();
	await expect(basic(page).getByRole("alert")).toContainText("项目已变化");
	await expect(basic(page).getByRole("textbox", { name: "系统提示词", exact: true })).toHaveValue("原提示词");
	await expect(toolPolicy).toHaveValue("allow");
	await next(page).click();
	const review = page.getByRole("dialog", { name: "确认发布", exact: true });
	await expect(review).toBeVisible();
	await review.getByRole("button", { name: "取消", exact: true }).click();
	expect(state.bodies).toHaveLength(2);
	expect(state.bodies[1]).toMatchObject({
		name: "原助手",
		model: "auto",
		description: "原描述",
		instructions: "原提示词",
		multiagent: { type: "coordinator", agents: [{ type: "self" }, { agent_id: "agent_02" }] },
		mcp_servers: ["source-mcp"],
		mcp_configurations: [{ name: "source-mcp", type: "official" }],
		skills: [{ type: "custom", skill_id: "skill_custom_report", version: "2" }],
		tools: { builtin: ["read"], default_permission: "ask", permissions: { read: "allow" } },
	});
	expect(state.writes.every((path) => path === `POST ${createPath}`)).toBe(true);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("审计员可选择已有版本，基础配置不能编辑或保存", async ({ page }) => {
	const state = await openTemplate(page, async () => {}, "auditor");
	await expect(next(page)).toBeDisabled();
	await expect(basic(page).getByRole("textbox", { name: "智能体名称", exact: true })).toBeDisabled();
	await openTemplateAgentPicker(page);
	await page.getByRole("button", { name: "选择智能体 Assistant 01（agent_01）", exact: true }).click();
	await confirmTemplateAgentSelection(page);
	await expect(
		basic(page).getByRole("button", { name: "切换版本 Assistant 01（agent_01）", exact: true }),
	).toBeEnabled();
	expect(state.writes).toEqual([]);
	expect(state.drafts.created).toBe(0);
});

test("URL 裁剪无占位符时仍禁止另存，原版本可继续使用", async ({ page }) => {
	const state = await openTemplate(page, async () => {});
	await page.route(`${apiBase}/api/admin/remote/agents/agent_01/versions/1`, (route) =>
		route.fulfill({
			json: {
				data: {
					agent_id: "agent_01",
					name: "原助手",
					version: 1,
					redacted_fields: ["instructions"],
					configuration: { model: "auto", instructions: "Use https://example.com/search for lookup." },
				},
			},
		}),
	);
	await page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true })
		.fill("原版本模版");
	await openTemplateAgentPicker(page);
	await page.getByRole("button", { name: "选择智能体 Assistant 01（agent_01）", exact: true }).click();
	await confirmTemplateAgentSelection(page);
	const status = basic(page).getByRole("status").filter({ hasText: "此版本暂时无法编辑另存" });
	await expect(status).toContainText("instructions");
	await expect(status).toContainText("字段已脱敏");
	await expect(basic(page)).toContainText("Use https://example.com/search for lookup.");
	await expect(basic(page).getByRole("textbox", { name: "智能体名称", exact: true })).toHaveCount(0);
	await expect(next(page)).toBeEnabled();
	expect(state.writes).toEqual([]);
	expect(state.drafts.created).toBe(0);
});

test("复制受限时展示具体字段与原因，保留原版本可用并支持更换", async ({ page }, testInfo) => {
	const state = await openTemplate(page, async () => {});
	await page.route(`${apiBase}/api/admin/remote/agents/agent_01/versions/1`, (route) =>
		route.fulfill({
			json: {
				data: {
					agent_id: "agent_01",
					name: "原助手",
					version: 1,
					configuration: {
						model: { id: "auto", max_tokens: "[redacted]" },
						skills: [{ type: "custom", skill_id: "skill_example" }],
						mcp_servers: [{ name: "custom", type: "url", url: "https://example.com?token=do-not-display" }],
					},
				},
			},
		}),
	);
	await page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true })
		.fill("诊断示例");
	await openTemplateAgentPicker(page);
	await page.getByRole("button", { name: "选择智能体 Assistant 01（agent_01）", exact: true }).click();
	await confirmTemplateAgentSelection(page);
	const status = basic(page).getByRole("status").filter({ hasText: "此版本暂时无法编辑另存" });
	await expect(status).toContainText("model.max_tokens");
	await expect(status).toContainText("字段已脱敏");
	await expect(status).toContainText("skills[0].version");
	await expect(status).toContainText("需要明确的固定版本");
	await expect(status).toContainText("mcp_servers[0].url");
	await expect(status).not.toContainText("do-not-display");
	await expect(basic(page).getByRole("textbox", { name: "智能体名称", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "下一步：预览调试", exact: true })).toBeEnabled();
	await status.scrollIntoViewIfNeeded();
	await page.screenshot({ path: testInfo.outputPath("diagnostic-field-details.png") });
	expect(state.writes).toEqual([]);
	expect(state.drafts.created).toBe(0);
	await openTemplateAgentPicker(page);
	await page.getByRole("button", { name: "选择智能体 Assistant 02（agent_02）", exact: true }).click();
	await confirmTemplateAgentSelection(page);
	await expect(basic(page).getByRole("textbox", { name: "智能体名称", exact: true })).toBeEnabled();
	await expect(status).toHaveCount(0);
});
