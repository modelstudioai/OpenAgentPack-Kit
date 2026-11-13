import { PROTOCOL_VERSION } from "@openagentpack/kit-sdk/protocol";
import type { Locator, Page, Request, Route } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";
import { confirmTemplateAgentSelection, openTemplateAgentPicker } from "./template-agent-selection-helpers.ts";
import { selectInlineEnvironment } from "./template-inline-helpers.ts";

const apiBase = "https://template-create.example/kit";
const environmentResponses: Record<string, unknown> = {
	"/api/admin/remote/environments": [{ environment_id: "env_default", name: "默认环境" }],
	"/api/admin/remote/environments/env_default": {
		environment_id: "env_default",
		name: "默认环境",
		configuration: { type: "cloud" },
	},
};
const agents = Array.from({ length: 23 }, (_, index) => {
	const suffix = String(index + 1).padStart(2, "0");
	return { agent_id: `agent_0${suffix}`, name: `Assistant ${suffix}`, version: index + 1 };
});

function versionDetail(agentId: string, version: number) {
	return {
		agent_id: agentId,
		name: agents.find((agent) => agent.agent_id === agentId)?.name ?? agentId,
		version,
		created_at: "2026-11-01T01:00:00Z",
		description: `历史版本 ${version} 的说明`,
		configuration: {
			model: {
				id: `model-v${version}`,
				name: `模型 v${version}`,
				temperature: 0,
				max_tokens: 8192,
				enable_thinking: false,
			},
			instructions: `版本 ${version} 系统指令`,
			tools:
				version === 1
					? {
							builtin: ["read-file"],
							default_permission: "allow",
							permissions: { ReadFile: "ask" },
							mcp: [
								{
									type: "mcp_toolkit",
									mcpServerName: "project-search",
									defaultConfig: { enabled: true },
									configs: [{ name: "project_search" }],
								},
							],
						}
					: [
							{
								type: "builtin_toolkit",
								default_config: { enabled: true, permission_policy: { type: "always_ask" } },
								configs: [
									{ name: "read-file", enabled: false, permission_policy: { type: "always_allow" } },
									{ name: "web_search", description: "搜索公开信息" },
								],
							},
							{
								type: "mcp_toolkit",
								mcp_server_name: "project-search",
								default_config: { enabled: false },
								configs: [
									{ name: "project_search", enabled: true, permission_policy: "always_ask" },
									{ name: "archive", enabled: false },
								],
							},
						],
			skills: [
				{
					skill_id: `skill-version-${version}`,
					...(version === 1 ? { name: `skill-version-${version}`, skill_name: "项目知识" } : { name: "项目知识" }),
					version: `v${version}`,
					type: "official",
					description: "项目资料检索",
				},
			],
			mcp_servers: [
				{
					serverCode: "project-search",
					serverName: "项目搜索",
					serverUrl: "https://mcp.example.test/project",
					serverProtocol: "streamableHttp",
					type: "official",
				},
			],
		},
	};
}

const versionDrawer = (page: Page) => page.getByRole("dialog", { name: "选择版本", exact: true });

async function expectVersionOrder(drawer: Locator, expected: number[]) {
	const buttons = drawer.getByRole("button", { name: /^查看智能体版本 / });
	await expect(buttons).toHaveCount(expected.length);
	for (const [index, version] of expected.entries()) {
		await expect(buttons.nth(index)).toHaveAccessibleName(`查看智能体版本 v${version}`);
	}
}

/** 仅替换 Kit HTTP 响应，验证用户选择流程；Provider 游标遍历由 gateway 合同保护。 */
async function openCreateTemplate(
	page: Page,
	list: (route: Route) => Promise<void>,
	versions = (route: Route) => route.fulfill({ json: { data: [{ version: 23 }, { version: 2 }, { version: 1 }] } }),
	detail = (route: Route, agentId: string, version: number) =>
		route.fulfill({ json: { data: versionDetail(agentId, version) } }),
) {
	const writes: string[] = [];
	await page.route(`${apiBase}/api/**`, async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname.replace(/^\/kit/, "");
		if (path.endsWith("/config")) {
			return route.fulfill({ json: { data: { apiBaseUrl: apiBase, protocolVersion: PROTOCOL_VERSION } } });
		}
		expect(request.headers().authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
		if (request.method() !== "GET") {
			writes.push(`${request.method()} ${path}`);
			return route.fulfill({ status: 500, json: { error: { code: "internal", message: "选择阶段不应写入" } } });
		}
		if (path.endsWith("/remote/agents")) return list(route);
		if (path.endsWith("/versions")) return versions(route);
		const match = /\/remote\/agents\/([^/]+)\/versions\/(\d+)$/.exec(path);
		if (match) return detail(route, match[1]!, Number(match[2]));
		if (Object.hasOwn(environmentResponses, path)) return route.fulfill({ json: { data: environmentResponses[path] } });
		if (path.endsWith("/identity")) return route.fulfill({ json: { data: { role: "admin", subject: "admin:test" } } });
		return route.fulfill({ json: { data: [] } });
	});
	await page.route(`${apiBase}/api/admin/resource-drafts/active`, (route) => route.fulfill({ json: { data: null } }));
	const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.searchParams.set("api", apiBase);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
	await page.getByRole("button", { name: /^进\s*入$/ }).click();
	await openConsoleNavigation(page);
	await page.getByTestId("template-create-tab").click();
	await expect(page.getByRole("heading", { name: "创建智能体", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
	return writes;
}

test("新建模版：分页搜索和历史版本选择，弹窗确认后保留上下文", async ({ page }) => {
	const versionRequests: string[] = [];
	page.on("request", (request) => {
		if (request.url().endsWith("/versions")) versionRequests.push(request.url());
	});
	const writes = await openCreateTemplate(page, (route) => route.fulfill({ json: { data: agents } }));
	const list = page.getByRole("list", { name: "智能体列表", exact: true });
	const pagination = page.getByRole("navigation", { name: "智能体列表分页", exact: true });
	const search = page.getByRole("searchbox", { name: "搜索智能体", exact: true });
	const saveAction = page.getByRole("button", { name: "下一步：预览调试", exact: true, includeHidden: true });
	const summary = page.getByRole("region", { name: "已选配置预览", exact: true });
	await expect(page.getByRole("button", { name: /^第 \d 步：/ })).toHaveCount(2);
	const configuration = page.getByRole("region", { name: "基础配置", exact: true });
	for (const name of ["名称", "版本", "模型", "描述", "系统提示词", "工具", "MCP 服务器", "技能"]) {
		await expect(configuration.getByRole("region", { name, exact: true })).toBeVisible();
	}
	await openTemplateAgentPicker(page);
	await expect(list.getByRole("button", { name: /^选择智能体 / })).toHaveCount(10);
	await expect(list.getByRole("button", { name: /^切换版本 / })).toHaveCount(10);
	await expect(saveAction).toBeDisabled();
	await expect(pagination).toContainText("第 1 / 3 页");
	await expect(pagination.getByRole("button", { name: "上一页", exact: true })).toBeDisabled();
	await pagination.getByRole("button", { name: "下一页", exact: true }).click();
	await expect(pagination).toContainText("第 2 / 3 页");
	await pagination.getByRole("button", { name: "下一页", exact: true }).click();
	await expect(pagination).toContainText("第 3 / 3 页");
	await expect(list.getByRole("button", { name: /^选择智能体 / })).toHaveCount(3);
	await expect(pagination.getByRole("button", { name: "下一页", exact: true })).toBeDisabled();
	const lastAgent = list.getByRole("button", { name: "选择智能体 Assistant 23（agent_023）", exact: true });
	const lastRow = list.getByRole("listitem").filter({
		has: page.getByRole("button", { name: "选择智能体 Assistant 23（agent_023）", exact: true }),
	});
	const chooseVersion = lastRow.getByRole("button", { name: "切换版本 Assistant 23（agent_023）", exact: true });
	expect(versionRequests).toEqual([]);
	const drawer = versionDrawer(page);
	await expect(lastRow.getByText("v23", { exact: true })).toBeVisible();
	await expect(drawer).toHaveCount(0);
	await chooseVersion.click();
	await expect(drawer).toBeVisible();
	await expectVersionOrder(drawer, [23, 2, 1]);
	await expect(drawer.getByRole("button", { name: "查看智能体版本 v23", exact: true })).toHaveAttribute(
		"aria-expanded",
		"true",
	);
	for (const value of ["模型 v23", "版本 23 系统指令", "read-file", "项目知识", "project-search"]) {
		await expect(drawer).toContainText(value);
	}
	// 保护真实配置的可读语义：工具覆盖与继承、技能版本保留，模型只展示名称。
	const model = drawer.getByRole("region", { name: "模型", exact: true });
	await expect(model).toContainText("模型 v23");
	for (const hidden of ["model-v23", "温度", "Top P", "最大回复 Token", "深度思考", "思考预算"]) {
		await expect(model).not.toContainText(hidden);
	}
	const builtin = drawer.getByRole("table", { name: "内置工具工具配置", exact: true });
	await expect(builtin.getByRole("row", { name: /read-file/ })).toContainText("已禁用");
	await expect(builtin.getByRole("row", { name: /read-file/ })).toContainText("总是允许");
	await expect(builtin.getByRole("row", { name: /web_search/ })).toContainText("已启用");
	await expect(builtin.getByRole("row", { name: /web_search/ })).toContainText("每次询问");
	await expect(builtin.getByRole("row", { name: /web_search/ })).toContainText("跟随默认");
	const mcp = drawer.getByRole("region", { name: "MCP 服务器", exact: true });
	await expect(mcp).toContainText("https://mcp.example.test/project");
	await expect(mcp.getByRole("row", { name: /project_search/ })).toContainText("每次询问");
	await expect(mcp.getByRole("row", { name: /archive/ })).toContainText("已禁用");
	await expect(drawer.getByRole("list", { name: "技能列表", exact: true })).toContainText("项目知识@v23官方");
	await expect(drawer.getByRole("list", { name: "技能列表", exact: true })).not.toContainText("skill-version-23");
	await expect(drawer).not.toContainText('"default_config"');
	await expect(drawer).not.toContainText("[object Object]");
	await drawer.getByRole("button", { name: "查看智能体版本 v1", exact: true }).click();
	await expect(drawer).toContainText("版本 1 系统指令");
	await expect(drawer).not.toContainText("版本 23 系统指令");
	await expect(builtin.getByRole("row", { name: /read-file/ })).toContainText("已启用");
	await expect(builtin.getByRole("row", { name: /read-file/ })).toContainText("每次询问");
	await expect(mcp.getByRole("row", { name: /project_search/ })).toContainText("已启用");
	await expect(mcp.getByRole("row", { name: /project_search/ })).toContainText("总是允许");
	await expect(drawer.getByRole("list", { name: "技能列表", exact: true })).toContainText("项目知识@v1官方");
	await drawer.press("Escape");
	await expect(drawer).toHaveCount(0);
	await expect(chooseVersion).toBeFocused();
	await expect(lastRow.getByText("v23", { exact: true })).toBeVisible();
	await expect(lastAgent).toHaveAttribute("aria-pressed", "false");
	await expect(summary).toHaveCount(0);
	await chooseVersion.press("Enter");
	await drawer.getByRole("button", { name: "查看智能体版本 v1", exact: true }).click();
	await drawer.getByRole("button", { name: "使用版本 v1", exact: true }).click();
	await expect(drawer).toHaveCount(0);
	await expect(lastRow.getByText("v1", { exact: true })).toBeVisible();
	await expect(lastAgent).toHaveAttribute("aria-pressed", "false");
	await expect(saveAction).toBeDisabled();
	// 名称与 ID 共用配置入口，确认之前不选中。
	await lastAgent.click();
	await confirmTemplateAgentSelection(page);
	await expect(saveAction).toBeDisabled();
	await expect(page.getByRole("region", { name: "环境", exact: true })).toBeVisible();
	await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toHaveCount(0);
	await expect(page.getByRole("region", { name: "基础配置", exact: true })).toContainText("Assistant 23");
	await expect(
		page.getByRole("region", { name: "基础配置", exact: true }).getByRole("region", { name: "版本", exact: true }),
	).toContainText("v1");
	await page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true })
		.fill("智能体选择模版");
	const prompts = page.getByRole("textbox", { name: "示例问题（每行一条）", exact: true });
	await prompts.fill(Array.from({ length: 9 }, (_, index) => `问题 ${index}`).join("\n"));
	await expect(saveAction).toBeDisabled();
	await prompts.fill("");
	await expect(saveAction).toBeEnabled();
	await selectInlineEnvironment(page, "选择环境 默认环境（env_default）");
	await openTemplateAgentPicker(page);
	await expect(pagination).toContainText("第 3 / 3 页");
	await expect(lastAgent).toHaveAttribute("aria-pressed", "true");
	await expect(lastRow.getByText("v1", { exact: true })).toBeVisible();
	expect(versionRequests).toEqual([`${apiBase}/api/admin/remote/agents/agent_023/versions`]);

	await search.fill("  aSsIsTaNt 2  ");
	await expect(list.getByRole("button", { name: /^选择智能体 / })).toHaveCount(4);
	await expect(pagination).toContainText("第 1 / 1 页");
	await search.fill("  AGENT_002  ");
	await expect(list.getByRole("button", { name: /^选择智能体 / })).toHaveCount(1);
	const secondAgent = list.getByRole("button", { name: "选择智能体 Assistant 02（agent_002）", exact: true });
	await expect(secondAgent).toBeVisible();
	await search.fill("not-an-existing-agent");
	await expect(page.getByText("未找到匹配的智能体", { exact: true })).toBeVisible();
	await expect(list.getByRole("button", { name: /^选择智能体 / })).toHaveCount(0);
	await search.fill("AGENT_002");
	await secondAgent.press("Enter");
	await confirmTemplateAgentSelection(page);
	await expect(page.getByRole("region", { name: "基础配置", exact: true })).toContainText("Assistant 02");
	await expect(
		page.getByRole("region", { name: "基础配置", exact: true }).getByRole("region", { name: "版本", exact: true }),
	).toContainText("v2");
	await expect(configuration.getByRole("region", { name: "模型", exact: true })).toContainText("模型 v2");
	await openTemplateAgentPicker(page);
	await expect(search).toHaveValue("AGENT_002");
	await expect(secondAgent).toHaveAttribute("aria-pressed", "true");
	expect(writes).toEqual([]);
});

test("导入只读配置：Multi-Agent 模式保持在模型下方", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const writes = await openCreateTemplate(
		page,
		(route) => route.fulfill({ json: { data: [agents[1]] } }),
		(route) => route.fulfill({ json: { data: [{ version: 2 }] } }),
	);
	await openTemplateAgentPicker(page);
	await page.getByRole("button", { name: "选择智能体 Assistant 02（agent_002）", exact: true }).click();
	await expect(page.getByRole("dialog", { name: /^智能体详情(?:\s|$)/ })).toContainText("版本 2 系统指令");
	await confirmTemplateAgentSelection(page);
	const configuration = page.getByRole("region", { name: "基础配置", exact: true });
	// 此版本包含无法另存的 MCP 权限，主页面切换到只读详情后仍须与可编辑表单保持相同顺序。
	await expect(configuration).toContainText("此版本暂时无法编辑另存");
	const orderedFields = configuration.locator(
		'section[aria-label="模型"], section[aria-label="Multi-Agent 模式"], section[aria-label="描述"], section[aria-label="系统提示词"]',
	);
	await expect(orderedFields).toHaveCount(4);
	expect(await orderedFields.evaluateAll((fields) => fields.map((field) => field.getAttribute("aria-label")))).toEqual([
		"模型",
		"Multi-Agent 模式",
		"描述",
		"系统提示词",
	]);
	expect(writes).toEqual([]);
});

test("基础配置平铺：配置读取失败可重试，切换版本时清空旧配置，迟到响应不覆盖新版本", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	let failNext = false;
	let delayNext = false;
	const started = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const settled = Promise.withResolvers<void>();
	const writes = await openCreateTemplate(
		page,
		(route) => route.fulfill({ json: { data: [agents[1]] } }),
		(route) => route.fulfill({ json: { data: [{ version: 2 }, { version: 1 }] } }),
		async (route, id, version) => {
			if (failNext) {
				failNext = false;
				return route.fulfill({ status: 503, json: { error: { code: "provider_error", message: "配置暂不可用" } } });
			}
			if (delayNext && version === 1) {
				delayNext = false;
				started.resolve();
				await release.promise;
				await route.fulfill({ json: { data: versionDetail(id, version) } });
				settled.resolve();
				return;
			}
			return route.fulfill({ json: { data: versionDetail(id, version) } });
		},
	);
	const configuration = page.getByRole("region", { name: "基础配置", exact: true });
	const versions = versionDrawer(page);
	await openTemplateAgentPicker(page);
	await page.getByRole("button", { name: "选择智能体 Assistant 02（agent_002）", exact: true }).click();
	await expect(page.getByRole("dialog", { name: /^智能体详情(?:\s|$)/ })).toContainText("版本 2 系统指令");
	failNext = true;
	await confirmTemplateAgentSelection(page);
	await expect(configuration.getByRole("alert")).toContainText("配置暂不可用");
	await expect(configuration).toContainText("配置加载失败");
	await configuration.getByRole("button", { name: /^重\s*试$/ }).click();
	await expect(configuration.getByRole("region", { name: "模型", exact: true })).toContainText("模型 v2");
	await expect(configuration.getByRole("region", { name: "系统提示词", exact: true })).toContainText("版本 2 系统指令");
	await expect(configuration.getByRole("region", { name: "技能", exact: true })).toContainText("项目知识");

	const environment = page.getByRole("textbox", { name: "环境名称", exact: true });
	await selectInlineEnvironment(page, "选择环境 默认环境（env_default）");
	try {
		await configuration.getByRole("button", { name: /^切换版本 / }).click();
		await versions.getByRole("button", { name: "查看智能体版本 v1", exact: true }).click();
		await expect(versions).toContainText("版本 1 系统指令");
		delayNext = true;
		await versions.getByRole("button", { name: "使用版本 v1", exact: true }).click();
		await started.promise;
		await expect(configuration).not.toContainText("版本 2 系统指令");
		await expect(configuration).toContainText("正在加载配置");
		await configuration.getByRole("button", { name: /^切换版本 / }).click();
		await versions.getByRole("button", { name: "查看智能体版本 v2", exact: true }).click();
		await versions.getByRole("button", { name: "使用版本 v2", exact: true }).click();
		await expect(configuration).toContainText("版本 2 系统指令");
		release.resolve();
		await settled.promise;
		await expect(configuration).not.toContainText("版本 1 系统指令");
		await expect(configuration.getByRole("region", { name: "版本", exact: true })).toContainText("v2");
		await expect(environment).toHaveValue("默认环境");
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
		expect(writes).toEqual([]);
	} finally {
		release.resolve();
	}
});

test("基础配置详情：查看取消不改变选择，加载失败禁用确认，确认后应用候选版本", async ({ page }) => {
	const reads: string[] = [];
	let fail = true;
	const writes = await openCreateTemplate(
		page,
		(route) => route.fulfill({ json: { data: agents.slice(0, 2) } }),
		(route) => route.fulfill({ json: { data: [{ version: 2 }, { version: 1 }] } }),
		(route, agentId, version) => {
			reads.push(`${agentId}:${version}`);
			if (fail && agentId === "agent_002") {
				fail = false;
				return route.fulfill({ status: 503, json: { error: { code: "provider_error", message: "详情暂不可用" } } });
			}
			return route.fulfill({ json: { data: versionDetail(agentId, version) } });
		},
	);
	const selected = page.getByRole("button", { name: "选择智能体 Assistant 01（agent_001）", exact: true });
	const other = page.getByRole("button", { name: "选择智能体 Assistant 02（agent_002）", exact: true });
	expect(reads).toEqual([]);
	await openTemplateAgentPicker(page);
	await selected.click();
	await confirmTemplateAgentSelection(page);
	await expect(page.getByRole("region", { name: "基础配置", exact: true })).toContainText("版本 1 系统指令");
	await openTemplateAgentPicker(page);
	await expect(selected).toHaveAttribute("aria-pressed", "true");
	const trigger = page.getByRole("button", { name: "选择智能体 Assistant 02（agent_002）", exact: true });
	const drawer = page.getByRole("dialog", { name: "智能体详情", exact: true });
	await trigger.click();
	await expect(drawer.getByRole("alert")).toContainText("详情暂不可用");
	await expect(drawer.getByRole("button", { name: "确认选择", exact: true })).toBeDisabled();
	await drawer.getByRole("button", { name: "重试", exact: true }).click();
	for (const value of ["Assistant 02", "模型 v2", "版本 2 系统指令", "read-file", "项目知识", "项目搜索"]) {
		await expect(drawer).toContainText(value);
	}
	await expect(drawer.getByRole("region", { name: "模型", exact: true })).not.toContainText("model-v2");
	await expect(drawer).not.toContainText('"default_config"');
	await expect(drawer.getByRole("button", { name: /^使用版本/ })).toHaveCount(0);
	await expect(drawer.getByRole("button", { name: "确认选择", exact: true })).toBeEnabled();
	await drawer.press("Escape");
	await expect(trigger).toBeFocused();
	await expect(selected).toHaveAttribute("aria-pressed", "true");
	await expect(other).toHaveAttribute("aria-pressed", "false");
	await page.getByRole("button", { name: "切换版本 Assistant 02（agent_002）", exact: true }).click();
	await versionDrawer(page).getByRole("button", { name: "查看智能体版本 v1", exact: true }).click();
	await versionDrawer(page).getByRole("button", { name: "使用版本 v1", exact: true }).click();
	await trigger.click();
	await expect(drawer).toContainText("版本 1 系统指令");
	await expect(drawer).not.toContainText("版本 2 系统指令");
	expect(reads.at(-1)).toBe("agent_002:1");
	await confirmTemplateAgentSelection(page);
	await expect(
		page
			.getByRole("region", { name: "基础配置", exact: true })
			.getByRole("button", { name: "导入现有配置", exact: true }),
	).toBeFocused();
	await expect(
		page.getByRole("region", { name: "基础配置", exact: true }).getByRole("region", { name: "版本", exact: true }),
	).toContainText("v1");
	await openTemplateAgentPicker(page);
	await expect(selected).toHaveAttribute("aria-pressed", "false");
	await expect(other).toHaveAttribute("aria-pressed", "true");

	expect(writes).toEqual([]);
});

test("详情内版本切换：窄屏失败可重试，取消还原，确认更新版本并保留运行资源", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	let versionLists = 0;
	let oldVersionReads = 0;
	const writes = await openCreateTemplate(
		page,
		(route) => route.fulfill({ json: { data: [agents[1]] } }),
		(route) => {
			versionLists += 1;
			return route.fulfill(
				versionLists === 1
					? { status: 503, json: { error: { code: "provider_error", message: "版本列表暂不可用" } } }
					: { json: { data: [{ version: 2 }, { version: 1 }] } },
			);
		},
		(route, agentId, version) => {
			if (version === 1 && ++oldVersionReads === 2) {
				return route.fulfill({ status: 503, json: { error: { code: "provider_error", message: "历史配置暂不可用" } } });
			}
			return route.fulfill({
				json: { data: { ...versionDetail(agentId, version), created_at: `2026-11-0${version}T01:00:00Z` } },
			});
		},
	);
	const trigger = page.getByRole("button", { name: "选择智能体 Assistant 02（agent_002）", exact: true });
	const row = page.getByRole("listitem").filter({ has: trigger });
	const detail = page.getByRole("dialog", { name: "智能体详情", exact: true });
	const versions = versionDrawer(page);
	await openTemplateAgentPicker(page);
	await trigger.click();
	await confirmTemplateAgentSelection(page);
	const environment = page.getByRole("textbox", { name: "环境名称", exact: true });
	await selectInlineEnvironment(page, "选择环境 默认环境（env_default）");
	await openTemplateAgentPicker(page);
	await trigger.click();
	const switchVersion = detail.getByRole("button", { name: "切换版本 Assistant 02（agent_002）", exact: true });
	await expect(detail.locator("header time")).toHaveAttribute("datetime", "2026-11-02T01:00:00Z");
	await switchVersion.click();
	await expect(versions.getByRole("alert")).toContainText("版本列表暂不可用");
	await versions.getByRole("button", { name: "重试", exact: true }).click();
	await versions.getByRole("button", { name: "查看智能体版本 v1", exact: true }).click();
	await versions.getByRole("button", { name: "使用版本 v1", exact: true }).click();
	await expect(versions).toHaveCount(0);
	await expect(detail.getByRole("alert")).toContainText("历史配置暂不可用");
	await expect(detail.getByRole("button", { name: "确认选择", exact: true })).toBeDisabled();
	await expect(detail).not.toContainText("版本 2 系统指令");
	await expect(detail.locator("header time")).toHaveCount(0);
	await detail.getByRole("button", { name: "重试", exact: true }).click();
	await expect(detail).toContainText("版本 1 系统指令");
	await expect(detail.locator("header time")).toHaveAttribute("datetime", "2026-11-01T01:00:00Z");
	await detail.press("Escape");
	await expect(trigger).toBeFocused();
	await expect(row.getByText("v2", { exact: true })).toBeVisible();
	await trigger.click();
	await expect(detail).toContainText("版本 2 系统指令");
	await switchVersion.click();
	await versions.getByRole("button", { name: "查看智能体版本 v1", exact: true }).click();
	await versions.getByRole("button", { name: "使用版本 v1", exact: true }).click();
	await expect(switchVersion).toBeFocused();
	await expect(detail).toContainText("版本 1 系统指令");
	await expect(detail.getByRole("button", { name: "确认选择", exact: true })).toBeInViewport({ ratio: 1 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await confirmTemplateAgentSelection(page);
	await expect(
		page.getByRole("region", { name: "基础配置", exact: true }).getByRole("region", { name: "版本", exact: true }),
	).toContainText("v1");
	await expect(environment).toHaveValue("默认环境");
	await openTemplateAgentPicker(page);
	await trigger.click();
	await expect(detail).toContainText("版本 1 系统指令");
	await detail.press("Escape");
	expect(writes).toEqual([]);
});

test("基础配置详情：窄屏关闭后迟到响应不串 Agent，重开重新读取", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const started = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const settled = Promise.withResolvers<void>();
	let pending: Request | undefined;
	const observeSettled = (request: Request) => {
		if (request === pending) settled.resolve();
	};
	page.on("requestfinished", observeSettled);
	page.on("requestfailed", observeSettled);
	let secondReads = 0;
	const writes = await openCreateTemplate(
		page,
		(route) => route.fulfill({ json: { data: agents.slice(0, 2) } }),
		undefined,
		async (route, agentId, version) => {
			if (agentId === "agent_002" && ++secondReads === 1) {
				pending = route.request();
				started.resolve();
				await release.promise;
			}
			return route.fulfill({ json: { data: versionDetail(agentId, version) } });
		},
	);
	const drawer = page.getByRole("dialog", { name: "智能体详情", exact: true });
	const second = page.getByRole("button", { name: "选择智能体 Assistant 02（agent_002）", exact: true });
	try {
		await openTemplateAgentPicker(page);
		await second.click();
		await started.promise;
		await expect(drawer).toContainText("正在加载智能体详情");
		await expect(drawer.getByRole("button", { name: "确认选择", exact: true })).toBeDisabled();
		await drawer.press("Escape");
		await expect(second).toBeFocused();
		await openTemplateAgentPicker(page);
		await page.getByRole("button", { name: "选择智能体 Assistant 01（agent_001）", exact: true }).click();
		await expect(drawer).toContainText("版本 1 系统指令");
		release.resolve();
		await settled.promise;
		await expect(drawer).not.toContainText("Assistant 02");
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
		await drawer.getByRole("region", { name: "技能", exact: true }).scrollIntoViewIfNeeded();
		await expect(drawer.getByRole("region", { name: "技能", exact: true })).toBeInViewport();
		await expect(drawer.getByRole("button", { name: "确认选择", exact: true })).toBeInViewport({ ratio: 1 });
		await drawer.press("Escape");
		await second.click();
		await expect(drawer).toContainText("版本 2 系统指令");
		expect(secondReads).toBe(2);
		await confirmTemplateAgentSelection(page);
		await expect(page.getByRole("region", { name: "基础配置", exact: true })).toContainText("Assistant 02");
		expect(writes).toEqual([]);
	} finally {
		release.resolve();
	}
});

test("新建模版：智能体未返回版本时等待实际版本，默认选择最高版本后才能继续", async ({ page }) => {
	const responseGate = Promise.withResolvers<void>();
	let versionRequests = 0;
	const writes = await openCreateTemplate(
		page,
		(route) => route.fulfill({ json: { data: [{ agent_id: "agent_without_version", name: "Unversioned" }] } }),
		async (route) => {
			versionRequests += 1;
			await responseGate.promise;
			return route.fulfill({ json: { data: [{ version: 1 }, { version: 3 }, { version: 2 }] } });
		},
	);
	const agent = page.getByRole("button", { name: "选择智能体 Unversioned（agent_without_version）", exact: true });
	const row = page.getByRole("listitem").filter({ has: agent });
	const drawer = versionDrawer(page);
	const saveAction = page.getByRole("button", { name: "下一步：预览调试", exact: true, includeHidden: true });
	try {
		await openTemplateAgentPicker(page);
		await expect.poll(() => versionRequests).toBe(1);
		await expect(agent).toBeDisabled();
		await expect(saveAction).toBeDisabled();
	} finally {
		responseGate.resolve();
	}
	await expect(row.getByText("v3", { exact: true })).toBeVisible();
	await row.getByRole("button", { name: "切换版本 Unversioned（agent_without_version）", exact: true }).click();
	await expectVersionOrder(drawer, [3, 2, 1]);
	await expect(drawer).toContainText("版本 3 系统指令");
	await drawer.press("Escape");
	await agent.click();
	await confirmTemplateAgentSelection(page);
	await expect(saveAction).toBeDisabled();
	await expect(page.getByRole("region", { name: "基础配置", exact: true })).toContainText("v3");
	expect(writes).toEqual([]);
});

test("新建模版：窄屏列表失败可重试，版本读取失败或空列表不丢失已选版本", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	let requests = 0;
	let versionRequests = 0;
	const responseGate = Promise.withResolvers<void>();
	const writes = await openCreateTemplate(
		page,
		async (route) => {
			requests += 1;
			if (requests === 1) {
				await route.fulfill({
					status: 503,
					json: { error: { code: "provider_error", message: "智能体列表暂不可用" } },
				});
				return;
			}
			await responseGate.promise;
			await route.fulfill({ json: { data: [{ agent_id: "agent_002", name: "Assistant 02" }] } });
		},
		async (route) => {
			versionRequests += 1;
			if (versionRequests === 2) {
				return route.fulfill({ status: 503, json: { error: { code: "provider_error", message: "版本列表暂不可用" } } });
			}
			return route.fulfill({ json: { data: versionRequests === 1 ? [{ version: 2 }, { version: 1 }] : [] } });
		},
	);
	const saveAction = page.getByRole("button", { name: "下一步：预览调试", exact: true, includeHidden: true });
	const section = page.getByRole("region", { name: "智能体列表", exact: true });
	const agent = page.getByRole("button", { name: "选择智能体 Assistant 02（agent_002）", exact: true });
	const row = page.getByRole("listitem").filter({ has: agent });
	await expect(page.getByRole("button", { name: "查看已选配置", exact: true })).toHaveCount(0);
	await openTemplateAgentPicker(page);
	await expect(section.getByRole("alert")).toContainText("智能体列表暂不可用");
	await expect(saveAction).toBeDisabled();
	await section.getByRole("button", { name: "重试", exact: true }).click();
	try {
		await expect.poll(() => requests).toBe(2);
		await expect(page.getByRole("status")).toContainText("正在加载智能体");
		await expect(page.getByRole("list", { name: "智能体列表", exact: true }).getByRole("button")).toHaveCount(0);
		await expect(saveAction).toBeDisabled();
	} finally {
		responseGate.resolve();
	}
	await expect(row.getByText("v2", { exact: true })).toBeVisible();
	await expect(section.getByRole("alert")).toHaveCount(0);
	await expect(saveAction).toBeDisabled();
	expect(versionRequests).toBe(1);
	await agent.click();
	await confirmTemplateAgentSelection(page);
	await page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true })
		.fill("智能体恢复模版");
	await expect(page.getByRole("button", { name: "查看已选配置", exact: true })).toBeVisible();
	await expect(page.getByTestId("selected-template-agent")).toHaveCount(0);
	const drawer = versionDrawer(page);
	const chooseVersion = page.getByRole("button", { name: "切换版本 Assistant 02（agent_002）", exact: true });
	await chooseVersion.click();
	await expect(drawer.getByRole("alert")).toContainText("版本列表暂不可用");
	await drawer.getByRole("button", { name: "重试", exact: true }).click();
	await expect(drawer.getByRole("alert")).toHaveCount(0);
	await expect.poll(() => versionRequests).toBe(3);
	await expectVersionOrder(drawer, [2]);
	await expect(drawer).toContainText("版本 2 系统指令");
	await drawer.press("Escape");
	await expect(drawer).toHaveCount(0);
	await expect(chooseVersion).toBeFocused();
	await expect(
		page.getByRole("region", { name: "基础配置", exact: true }).getByRole("region", { name: "版本", exact: true }),
	).toContainText("v2");
	await expect(page.getByRole("dialog", { name: "管理端导航菜单", exact: true })).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	expect(writes).toEqual([]);
});

// 保护远端版本配置的读取恢复：失败不能使用，切版后迟到响应不能覆盖当前详情或改变草稿。
test("智能体版本抽屉：窄屏配置失败可重试，迟到详情不串版本，确认后才更新选择", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const release = Promise.withResolvers<void>();
	const lateStarted = Promise.withResolvers<void>();
	const lateSettled = Promise.withResolvers<void>();
	let pending: Request | undefined;
	let currentAttempts = 0;
	let historyAttempts = 0;
	const observeSettled = (request: Request) => {
		if (request === pending) lateSettled.resolve();
	};
	page.on("requestfinished", observeSettled);
	page.on("requestfailed", observeSettled);
	const writes = await openCreateTemplate(
		page,
		(route) => route.fulfill({ json: { data: [agents[1]] } }),
		(route) => route.fulfill({ json: { data: [{ version: 2 }, { version: 1 }] } }),
		async (route, agentId, version) => {
			if (version === 2 && ++currentAttempts === 1) {
				return route.fulfill({ status: 503, json: { error: { code: "provider_error", message: "版本配置暂不可用" } } });
			}
			if (version === 1 && ++historyAttempts === 1) {
				pending = route.request();
				lateStarted.resolve();
				await release.promise;
			}
			return route.fulfill({ json: { data: versionDetail(agentId, version) } });
		},
	);
	const drawer = versionDrawer(page);
	const trigger = page.getByRole("button", { name: "切换版本 Assistant 02（agent_002）", exact: true });
	const selectAgent = page.getByRole("button", { name: "选择智能体 Assistant 02（agent_002）", exact: true });
	const row = page.getByRole("listitem").filter({ has: selectAgent });
	try {
		await openTemplateAgentPicker(page);
		await trigger.click();
		await expect(drawer.getByRole("alert")).toContainText("版本配置暂不可用");
		await expect(drawer.getByRole("button", { name: "使用版本 v2", exact: true })).toBeDisabled();
		await drawer.getByRole("button", { name: "重试", exact: true }).click();
		await expect(drawer).toContainText("版本 2 系统指令");
		await expect(drawer.getByRole("button", { name: "使用版本 v2", exact: true })).toBeEnabled();
		await drawer.getByRole("button", { name: "查看智能体版本 v1", exact: true }).click();
		await lateStarted.promise;
		await expect(drawer).not.toContainText("版本 2 系统指令");
		await expect(drawer.getByRole("button", { name: "使用版本 v1", exact: true })).toBeDisabled();
		await drawer.getByRole("button", { name: "查看智能体版本 v2", exact: true }).click();
		await expect(drawer).toContainText("版本 2 系统指令");
		release.resolve();
		await lateSettled.promise;
		await expect(drawer).toContainText("版本 2 系统指令");
		await expect(drawer).not.toContainText("版本 1 系统指令");
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
		const bounds = await drawer.boundingBox();
		expect(bounds!.x).toBeGreaterThanOrEqual(0);
		expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
		await drawer.press("Escape");
		await expect(trigger).toBeFocused();
		await expect(row.getByText("v2", { exact: true })).toBeVisible();
		await expect(selectAgent).toHaveAttribute("aria-pressed", "false");
		await trigger.click();
		await drawer.getByRole("button", { name: "查看智能体版本 v1", exact: true }).click();
		await expect(drawer).toContainText("版本 1 系统指令");
		await drawer.getByRole("button", { name: "使用版本 v1", exact: true }).click();
		await expect(drawer).toHaveCount(0);
		await expect(row.getByText("v1", { exact: true })).toBeVisible();
		await expect(selectAgent).toHaveAttribute("aria-pressed", "false");
		expect(writes).toEqual([]);
	} finally {
		release.resolve();
	}
});
