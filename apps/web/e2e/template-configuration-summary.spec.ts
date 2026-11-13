import { PROTOCOL_VERSION, type TemplateView } from "@openagentpack/kit-sdk/protocol";
import type { Locator, Page } from "@playwright/test";
import { selectConsoleOption } from "./console-select-helpers.ts";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";
import { confirmTemplateAgentSelection, openTemplateAgentPicker } from "./template-agent-selection-helpers.ts";

const apiBase = "https://template-summary.example/kit";
const labels = [
	"智能体名称",
	"模型",
	"Multi-Agent 模式",
	"描述",
	"系统提示词",
	"工具",
	"MCP 服务器",
	"技能",
	"环境",
	"文件",
	"记忆库",
	"密钥库",
];
const saved: TemplateView = {
	template_id: "tpl_summary_edit",
	name: "摘要编辑模版",
	category: "writing",
	version: 2,
	created_at: "2026-10-30T01:00:00.000Z",
	updated_at: "2026-10-30T02:00:00.000Z",
	remote_agent_id: "agent_alpha",
	remote_agent_name: "Alpha 助手",
	remote_agent_version: 3,
	agent_version: 1,
	remote_environment_id: "env_default",
	remote_environment_name: "默认环境",
	files: [{ file_id: "file_guide", filename: "项目资料.txt", mount_path: "/mnt/session/reference/guide.txt" }],
	memory_stores: [{ memory_store_id: "memory_guide", access: "read_only", instructions: "仅检索项目资料" }],
	vault_ids: ["vault_project"],
	description: "广场展示描述",
	opening_remarks: "欢迎使用项目助手",
	suggested_prompts: ["总结项目进展"],
};
const agentConfiguration = {
	model: "qwen3.8-max",
	instructions: "根据项目资料给出回答。",
	tools: { builtin: ["bash", "read"], default_permission: "ask" },
	mcp_servers: [{ type: "official", name: "project_search" }],
	skills: [{ type: "custom", skill_id: "skill_project", version: "1", name: "项目检索技能" }],
	multiagent: { type: "coordinator", agents: [{ type: "self" }] },
};

/** 保护摘要读取当前表单/历史导入而不是旧 Agent 引用，不触发保存或调试。 */
async function openWizard(page: Page, editing = false, template = saved) {
	const writes: string[] = [];
	const responses: Record<string, unknown> = {
		"/api/admin/identity": { role: "admin", subject: "summary:test" },
		"/api/admin/remote/agents": [{ agent_id: "agent_alpha", name: "Alpha 助手", version: 3 }],
		"/api/admin/remote/environments": [{ environment_id: "env_default", name: "默认环境" }],
		"/api/admin/remote/environments/env_default": {
			environment_id: "env_default",
			name: "默认环境",
			configuration: { type: "cloud" },
		},
		"/api/admin/remote/files": [{ file_id: "file_guide", filename: "项目资料.txt", size: 24, available: true }],
		"/api/admin/remote/memory-stores": [{ memory_store_id: "memory_guide", name: "项目记忆" }],
		"/api/admin/remote/memory-stores/memory_guide": {
			memory_store_id: "memory_guide",
			name: "项目记忆",
			description: "",
			entries: [],
		},
		"/api/admin/remote/vaults": [{ vault_id: "vault_project", name: "项目密钥" }],
		"/api/admin/remote/vaults/vault_project": { vault_id: "vault_project", name: "项目密钥", credentials: [] },
		"/api/admin/resource-drafts/active": null,
		"/api/admin/templates": [template],
		[`/api/admin/templates/${template.template_id}`]: template,
	};
	await page.route(`${apiBase}/api/**`, async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname.replace(/^\/kit/, "");
		if (path.endsWith("/config"))
			return route.fulfill({ json: { data: { apiBaseUrl: apiBase, protocolVersion: PROTOCOL_VERSION } } });
		expect(request.headers().authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
		if (request.method() !== "GET") {
			writes.push(`${request.method()} ${path}`);
			return route.fulfill({ status: 500, json: { error: { code: "internal", message: "摘要不应触发写入" } } });
		}
		if (path.endsWith("/versions")) return route.fulfill({ json: { data: [{ version: 3 }, { version: 1 }] } });
		const match = /\/remote\/agents\/([^/]+)\/versions\/(\d+)$/.exec(path);
		if (match)
			return route.fulfill({
				json: {
					data: {
						agent_id: match[1],
						name: "Alpha 助手",
						version: Number(match[2]),
						description: "智能体基础描述",
						configuration: { ...agentConfiguration, instructions: `版本 ${match[2]} 的系统提示词` },
					},
				},
			});
		return route.fulfill({ json: { data: Object.hasOwn(responses, path) ? responses[path] : [] } });
	});
	const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.searchParams.set("api", apiBase);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await openConsoleNavigation(page);
	await page.getByTestId(editing ? "template-list-tab" : "template-create-tab").click();
	if (editing) await page.getByRole("button", { name: `编辑模版 ${template.name}`, exact: true }).click();
	else await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
	await expect(page.getByRole("heading", { name: editing ? "编辑智能体" : "创建智能体", exact: true })).toBeVisible();
	return writes;
}

const field = (summary: Locator, name: string) =>
	summary
		.locator("dt")
		.filter({ hasText: new RegExp(`^${name}$`) })
		.locator("..")
		.locator("dd");

test("配置摘要按指定顺序展示12项，导入后实时反映表单修改，MCP只展示一次", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const writes = await openWizard(page, true);
	const summary = page.getByRole("region", { name: "已选配置预览", exact: true });
	const base = page.getByRole("region", { name: "基础配置", exact: true });
	await expect(summary.locator("dt")).toHaveText(labels);
	await expect(field(summary, "模型")).toHaveText("Qwen3.8-Max");
	await expect(field(summary, "Multi-Agent 模式")).toHaveText("已开启");
	await expect(field(summary, "描述")).toHaveText("智能体基础描述");
	await expect(field(summary, "系统提示词")).toHaveText("版本 1 的系统提示词");
	await expect(field(summary, "工具")).toHaveText("bashread");
	await expect(field(summary, "MCP 服务器")).toHaveText("project_search");
	await expect(field(summary, "技能")).toHaveText("项目检索技能");
	for (const value of [
		saved.name,
		"默认环境",
		"项目资料.txt",
		"/mnt/session/reference/guide.txt",
		"memory_guide",
		"只读",
		"仅检索项目资料",
		"vault_project",
	])
		await expect(summary).toContainText(value);
	await expect(summary).not.toContainText(saved.description!);
	await expect(summary).not.toContainText("官方 MCP");
	await selectConsoleOption(page, "模型", "AUTO");
	await expect(field(summary, "模型")).toHaveText("AUTO");
	await base.getByRole("textbox", { name: "智能体描述", exact: true }).fill("正在编辑的智能体描述");
	await base.getByRole("textbox", { name: "系统提示词", exact: true }).fill("尚未保存的系统提示词");
	await base.getByRole("switch", { name: "Multi-Agent 模式" }).uncheck();
	await base.getByRole("checkbox", { name: "bash", exact: true }).uncheck();
	await expect(field(summary, "描述")).toHaveText("正在编辑的智能体描述");
	await expect(field(summary, "系统提示词")).toHaveText("尚未保存的系统提示词");
	await expect(field(summary, "Multi-Agent 模式")).toHaveText("未开启");
	await expect(field(summary, "工具")).toHaveText("read");
	await base.getByRole("textbox", { name: "服务标识", exact: true }).fill("updated_search");
	await expect(field(summary, "MCP 服务器")).toHaveText("updated_search");
	await page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true })
		.fill("实时模版名称");
	await expect(field(summary, "智能体名称")).toHaveText("实时模版名称");
	expect(writes).toEqual([]);
});

test("空白创建填写基础配置后显示摘要，清空后恢复空态，导入历史版本同步配置", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const writes = await openWizard(page);
	const summary = page.getByRole("region", { name: "已选配置预览", exact: true });
	const base = page.getByRole("region", { name: "基础配置", exact: true });
	await expect(summary).toHaveCount(0);
	await base.getByRole("textbox", { name: "智能体名称", exact: true }).fill("草稿助手");
	await expect(summary).toBeVisible();
	await expect(summary.locator("dt")).toHaveText(labels);
	await expect(field(summary, "模型")).toHaveText("未选择");
	await expect(field(summary, "环境")).toHaveText("使用智能体默认环境");
	await base.getByRole("textbox", { name: "系统提示词", exact: true }).fill("正在新建的提示词");
	await expect(field(summary, "系统提示词")).toHaveText("正在新建的提示词");
	await base.getByRole("button", { name: "清空", exact: true }).click();
	await expect(summary).toHaveCount(0);
	await openTemplateAgentPicker(page);
	await page.getByRole("button", { name: "选择智能体 Alpha 助手（agent_alpha）", exact: true }).click();
	await confirmTemplateAgentSelection(page);
	await expect(field(summary, "系统提示词")).toHaveText("版本 3 的系统提示词");
	await page.getByRole("button", { name: "切换版本 Alpha 助手（agent_alpha）", exact: true }).click();
	const versions = page.getByRole("dialog", { name: /^选择版本/ });
	await versions.getByRole("button", { name: "查看智能体版本 v1", exact: true }).click();
	await versions.getByRole("button", { name: "使用版本 v1", exact: true }).click();
	await expect(field(summary, "系统提示词")).toHaveText("版本 1 的系统提示词");
	expect(writes).toEqual([]);
});

test("尚未选择智能体时，模版名称或任一运行时资源修改也展示预览", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const writes = await openWizard(page);
	const summary = page.getByRole("region", { name: "已选配置预览", exact: true });
	const name = page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true });
	await expect(summary).toHaveCount(0);
	await name.fill("仅填写模版名称");
	await expect(summary).toBeVisible();
	await expect(field(summary, "智能体名称")).toHaveText("仅填写模版名称");
	await name.fill("");
	await expect(summary).toHaveCount(0);
	const environment = page.getByRole("region", { name: "环境", exact: true });
	await environment.getByRole("textbox", { name: "环境名称", exact: true }).fill("新环境");
	await expect(summary).toBeVisible();
	await expect(field(summary, "环境")).toHaveText("新环境");
	await environment.getByRole("textbox", { name: "环境名称", exact: true }).fill("改名后的环境");
	await expect(field(summary, "环境")).toHaveText("改名后的环境");
	await environment.getByRole("button", { name: "清空", exact: true }).click();
	await expect(summary).toHaveCount(0);
	const files = page.getByRole("region", { name: "文件", exact: true });
	await files
		.locator('input[type="file"]')
		.setInputFiles({ name: "summary.txt", mimeType: "text/plain", buffer: Buffer.from("summary") });
	await expect(summary).toBeVisible();
	await expect(field(summary, "文件")).toContainText("summary.txt");
	await files.getByRole("button", { name: "清空", exact: true }).click();
	await expect(summary).toHaveCount(0);
	for (const resource of ["记忆库", "密钥库"]) {
		const section = page.getByRole("region", { name: resource, exact: true });
		await section.getByRole("textbox", { name: `${resource}名称`, exact: true }).fill(`新${resource}`);
		await expect(summary).toBeVisible();
		await expect(field(summary, resource)).toContainText(`新${resource}`);
		await section.getByRole("button", { name: "清空", exact: true }).click();
		await expect(summary).toHaveCount(0);
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await name.fill("窄屏名称");
	await page.getByRole("button", { name: "查看已选配置", exact: true }).click();
	const drawer = page.getByRole("dialog", { name: "已选配置预览", exact: true });
	await expect(field(drawer, "智能体名称")).toHaveText("窄屏名称");
	await drawer.getByRole("button", { name: "关闭", exact: true }).click();
	expect(writes).toEqual([]);
});

test("浮动版本查询只更新预览配置，只有显式选择才绑定版本", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const writes = await openWizard(page, true, { ...saved, agent_version: undefined });
	const base = page.getByRole("region", { name: "基础配置", exact: true });
	const summary = page.getByRole("region", { name: "已选配置预览", exact: true });
	const binding = base;
	await expect(binding).toContainText("跟随最新版本（当前 v3）");
	await expect(field(summary, "系统提示词")).toHaveText("版本 3 的系统提示词");
	const trigger = base.getByRole("button", { name: "切换版本 Alpha 助手（agent_alpha）", exact: true });
	const versions = page.getByRole("dialog", { name: /^选择版本/ });
	await trigger.click();
	await versions.getByRole("button", { name: "关闭", exact: true }).click();
	await expect(binding).toContainText("跟随最新版本（当前 v3）");
	await trigger.click();
	await versions.getByRole("button", { name: "查看智能体版本 v1", exact: true }).click();
	await versions.getByRole("button", { name: "使用版本 v1", exact: true }).click();
	await expect(binding).not.toContainText("跟随最新版本");
	await expect(field(summary, "系统提示词")).toHaveText("版本 1 的系统提示词");
	expect(writes).toEqual([]);
});

test("窄屏摘要使用同一字段和草稿，长提示词独立滚动且关闭返回焦点", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const writes = await openWizard(page, true);
	const base = page.getByRole("region", { name: "基础配置", exact: true });
	const prompt = "这是当前正在编辑的系统提示词。".repeat(100);
	await base.getByRole("textbox", { name: "系统提示词", exact: true }).fill(prompt);
	const trigger = page.getByRole("button", { name: "查看已选配置", exact: true });
	await trigger.click();
	const drawer = page.getByRole("dialog", { name: "已选配置预览", exact: true });
	await expect(drawer.locator("dt")).toHaveText(labels);
	await expect(field(drawer, "系统提示词")).toHaveText(prompt);
	await field(drawer, "密钥库").scrollIntoViewIfNeeded();
	await expect(field(drawer, "密钥库")).toBeInViewport();
	await expect(drawer.getByRole("button", { name: "关闭" })).toBeInViewport();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await drawer.press("Escape");
	await expect(drawer).toHaveCount(0);
	await expect(trigger).toBeFocused();
	await trigger.click();
	await expect(field(drawer, "系统提示词")).toHaveText(prompt);
	await drawer.getByRole("button", { name: "关闭" }).click();
	await expect(trigger).toBeFocused();
	expect(writes).toEqual([]);
});
