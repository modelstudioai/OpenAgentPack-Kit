import { PROTOCOL_VERSION, type PresetPackPreview } from "@openagentpack/kit-sdk/protocol";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN } from "./helpers.ts";

const api = "https://template-create-entry.example/kit";
const preset: PresetPackPreview = {
	remote_agent_id: "agent_existing",
	remote_agent_name: "已有助手",
	agent_version: 3,
	remote_environment_id: "env_existing",
	remote_environment_name: "已有环境",
	files: [],
	memory_stores: [],
	vault_ids: [],
};
const picker = (page: Page) => page.getByRole("dialog", { name: "导入预设包", exact: true });

/** 保护方式选择、取消及核验成功后才进入表单；只替换 Kit HTTP，不调用 Provider。 */
async function openEntry(page: Page, search = "") {
	const state = { rejectImport: false, writes: [] as { path: string; body: unknown }[] };
	await page.route(`${api}/api/**`, async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname.replace(/^\/kit/, "");
		if (path === "/api/config")
			return route.fulfill({ json: { data: { apiBaseUrl: api, protocolVersion: PROTOCOL_VERSION } } });
		expect(request.headers().authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
		if (request.method() !== "GET") {
			state.writes.push({ path, body: request.postDataJSON() });
			if (path === "/api/admin/preset-packs/preview")
				return state.rejectImport
					? route.fulfill({ status: 409, json: { error: { code: "conflict", message: "配置已变化，请重试" } } })
					: route.fulfill({ json: { data: preset } });
			return route.fulfill({ status: 500, json: { error: { code: "internal", message: "非预期写入" } } });
		}
		const responses: Record<string, unknown> = {
			"/api/admin/identity": { role: "admin", subject: "admin:entry" },
			"/api/admin/resource-drafts/active": null,
			"/api/admin/preset-packs/legacy": { ...preset, preset_pack_id: "legacy", created_at: "2026-11-01T00:00:00Z" },
			"/api/admin/remote/agents": [{ agent_id: "agent_existing", name: "已有助手", version: 3 }],
			"/api/admin/remote/agents/agent_existing/versions/3": {
				agent_id: "agent_existing",
				name: "已有助手",
				version: 3,
				configuration: { model: { id: "test-model", name: "导入模型" }, instructions: "沿用系统提示词" },
			},
			"/api/admin/preset-packs/agents/agent_existing/resources": {
				agent_id: "agent_existing",
				complete: true,
				sessions: [
					{
						session_id: "session_existing",
						status: "idle",
						resources: [{ type: "environment", environment_id: "env_existing", sources: ["session"] }],
					},
				],
			},
			"/api/admin/remote/environments/env_existing": {
				environment_id: "env_existing",
				name: "已有环境",
				configuration: { type: "cloud" },
			},
		};
		return route.fulfill({ json: { data: Object.hasOwn(responses, path) ? responses[path] : [] } });
	});
	const url = new URL(`/templates/new${search}`, process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174");
	url.searchParams.set("api", api);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await expect(page.getByRole("heading", { name: "创建智能体", exact: true })).toBeVisible();
	return state;
}

for (const viewport of [
	{ name: "桌面", width: 1440, height: 900 },
	{ name: "手机", width: 390, height: 844 },
]) {
	test(`${viewport.name}创建入口：初始空态，取消导入后仍可从零创建`, async ({ page }) => {
		await page.setViewportSize(viewport);
		const state = await openEntry(page);
		await expect(page.getByRole("button", { name: "导入现有配置", exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "从零开始创建", exact: true })).toBeVisible();
		await expect(page.getByRole("region", { name: "基础配置", exact: true })).toHaveCount(0);
		await expect(page.getByRole("navigation", { name: "新建模版步骤", exact: true })).toHaveCount(0);
		await page.getByRole("button", { name: "导入现有配置", exact: true }).click();
		await expect(picker(page).getByRole("radio", { name: "选择智能体 已有助手（agent_existing）" })).toBeVisible();
		await picker(page).getByRole("button", { name: "取消", exact: true }).click();
		await expect(picker(page)).toBeHidden();
		await expect(page.getByRole("region", { name: "展示配置", exact: true })).toHaveCount(0);
		await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
		for (const name of ["展示配置", "基础配置", "环境", "文件", "记忆库", "密钥库"])
			await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
		await expect(page.getByRole("navigation", { name: "新建模版步骤", exact: true })).toContainText("选择配置");
		await expect(
			page
				.getByRole("region", { name: "展示配置", exact: true })
				.getByRole("textbox", { name: "智能体名称", exact: true }),
		).toHaveValue("");
		await expect(page.getByRole("button", { name: "导入预设包", exact: true })).toHaveCount(0);
		expect(state.writes).toEqual([]);
	});
}

test("创建入口：导入失败保留选择，重试成功后回填表单，刷新回到方式选择", async ({ page }) => {
	const state = await openEntry(page);
	state.rejectImport = true;
	await page.getByRole("button", { name: "导入现有配置", exact: true }).click();
	await picker(page).getByRole("radio", { name: "选择智能体 已有助手（agent_existing）" }).check();
	await picker(page).getByRole("row", { name: "环境资源 env_existing", exact: true }).click();
	await page
		.getByRole("dialog", { name: "环境配置", exact: true })
		.getByRole("button", { name: "确认选择", exact: true })
		.click();
	await expect(picker(page).getByRole("status", { name: "已选运行时资源" })).toHaveText("已选择 1 个资源");
	await picker(page).getByRole("button", { name: "导入", exact: true }).click();
	await expect(picker(page).getByRole("alert")).toContainText("配置已变化，请重试");
	await expect(page.getByRole("region", { name: "基础配置", exact: true })).toHaveCount(0);
	state.rejectImport = false;
	await picker(page).getByRole("button", { name: "导入", exact: true }).click();
	await expect(picker(page)).toBeHidden();
	await expect(page.getByRole("alert").filter({ hasText: "已导入预设包：已有助手" })).toBeVisible();
	await expect(
		page
			.getByRole("region", { name: "基础配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true }),
	).toHaveValue("已有助手");
	await expect(page.getByRole("region", { name: "基础配置", exact: true })).toContainText("v3");
	await expect(page.getByRole("textbox", { name: "环境名称", exact: true })).toHaveValue("已有环境");
	await expect(
		page
			.getByRole("region", { name: "展示配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true }),
	).toHaveValue("");
	expect(state.writes).toEqual(
		Array.from({ length: 2 }, () => ({
			path: "/api/admin/preset-packs/preview",
			body: {
				remote_agent_id: "agent_existing",
				agent_version: 3,
				resources: [{ type: "environment", resource_id: "env_existing" }],
			},
		})),
	);
	expect(new URL(page.url()).searchParams.has("preset")).toBe(false);
	await page.reload();
	await expect(page.getByRole("button", { name: "从零开始创建", exact: true })).toBeVisible();
	await expect(page.getByRole("region", { name: "基础配置", exact: true })).toHaveCount(0);
});

test("创建入口：历史预设包链接仍直接回填表单", async ({ page }) => {
	const state = await openEntry(page, "?preset=legacy");
	await expect(page.getByRole("alert").filter({ hasText: "已导入预设包：已有助手" })).toBeVisible();
	await expect(page.getByRole("region", { name: "基础配置", exact: true })).toContainText("v3");
	await expect(page.getByRole("textbox", { name: "环境名称", exact: true })).toHaveValue("已有环境");
	await expect(page.getByRole("button", { name: "从零开始创建", exact: true })).toHaveCount(0);
	expect(state.writes).toEqual([]);
});
