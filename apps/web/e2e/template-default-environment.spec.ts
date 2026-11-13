import { PROTOCOL_VERSION, type TemplateView } from "@openagentpack/kit-sdk/protocol";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";
import {
	confirmTemplateAgentSelection,
	installTemplateAgentDetailFixture,
	openTemplateAgentPicker,
} from "./template-agent-selection-helpers.ts";
import { selectInlineEnvironment } from "./template-inline-helpers.ts";
import { openTemplateSaveDialog } from "./template-publish-helpers.ts";

const apiBase = "https://template-default-environment.example/kit";
const templatesPath = "/api/admin/templates";
const sessionsPath = "/api/admin/debug/sessions";
const timestamp = "2026-11-02T08:00:00.000Z";
const initialTemplate: TemplateView = {
	template_id: "template-default-env",
	name: "默认环境模版",
	category: "general",
	version: 2,
	created_at: timestamp,
	updated_at: timestamp,
	remote_agent_id: "agent_existing",
	remote_agent_name: "项目助手",
	remote_agent_version: 2,
	agent_version: 2,
	files: [],
	memory_stores: [],
	vault_ids: [],
	suggested_prompts: [],
};

interface FixtureState {
	template?: TemplateView;
	debugs: Record<string, unknown>[];
	saves: { method: string; body: Record<string, unknown> }[];
	writes: string[];
}

async function respondWrite(route: Route, state: FixtureState, path: string) {
	const request = route.request();
	const body = request.postData() ? (request.postDataJSON() as Record<string, unknown>) : {};
	state.writes.push(`${request.method()} ${path}`);

	if (path === sessionsPath) {
		state.debugs.push(body);
		return route.fulfill({
			status: 201,
			json: {
				data: {
					...body,
					session_id: `default-env-session-${state.debugs.length}`,
					source: "template",
					status: "idle",
					created_at: timestamp,
				},
			},
		});
	}
	if (path.startsWith(`${sessionsPath}/`) && path.endsWith("/plan"))
		return route.fulfill({ json: { data: { plan_id: "cleanup", confirm_token: "cleanup-token", diff: [] } } });
	if (path.startsWith(`${sessionsPath}/`) && request.method() === "DELETE")
		return route.fulfill({ json: { data: { deleted: true } } });
	if (
		path === templatesPath ||
		(path === `${templatesPath}/${initialTemplate.template_id}` && request.method() === "PUT")
	) {
		return saveResponse(route, state, body);
	}
	return route.fulfill({ status: 500, json: { error: { code: "internal", message: `非预期写请求 ${path}` } } });
}

function saveResponse(route: Route, state: FixtureState, body: Record<string, unknown>) {
	const request = route.request();
	state.saves.push({ method: request.method(), body });
	const { base_version: _base, ...saved } = body;
	state.template = {
		...initialTemplate,
		...saved,
		version: request.method() === "POST" ? 1 : (state.template?.version ?? 0) + 1,
		...(body.remote_environment_id ? { remote_environment_name: "覆盖运行环境" } : {}),
	} as TemplateView;
	return route.fulfill({ status: request.method() === "POST" ? 201 : 200, json: { data: state.template } });
}

async function respondRead(route: Route, state: FixtureState, path: string) {
	if (path.startsWith(`${sessionsPath}/`) && path.endsWith("/stream")) {
		const sessionId = path.split("/").at(-2);
		return route.fulfill({
			contentType: "text/event-stream",
			body: `event: ready\ndata: ${JSON.stringify({ session_id: sessionId, replayed: 0 })}\n\nevent: done\ndata: {"status":"idle"}\n\n`,
		});
	}
	if (path.endsWith("/threads")) return route.fulfill({ json: { data: [], next_page_token: null } });
	if (path.endsWith("/tool-approvals"))
		return route.fulfill({
			json: { data: { requires_action: false, batch_id: null, pending_call_ids: [], requests: [] } },
		});
	const responses: Record<string, unknown> = {
		"/api/admin/identity": { role: "admin", subject: "admin:default-environment" },
		"/api/admin/remote/agents": [{ agent_id: "agent_existing", name: "项目助手", version: 2 }],
		"/api/admin/remote/environments": [{ environment_id: "env_override", name: "覆盖运行环境" }],
		"/api/admin/remote/environments/env_override": {
			environment_id: "env_override",
			name: "覆盖运行环境",
			configuration: { type: "cloud" },
		},
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
		"/api/admin/resource-drafts/active": null,
		[templatesPath]: state.template ? [state.template] : [],
		[`${templatesPath}/${initialTemplate.template_id}`]: state.template,
	};
	return route.fulfill({
		json: { data: path === "/api/admin/resource-drafts/active" ? null : (responses[path] ?? []) },
	});
}

/** 保护默认环境的 UI 状态和请求省略语义；Provider 默认值由服务端合同测试负责。 */
async function openTemplate(page: Page, editing = false) {
	const state: FixtureState = { template: editing ? initialTemplate : undefined, debugs: [], saves: [], writes: [] };
	await page.route(`${apiBase}/api/**`, async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname.replace(/^\/kit/, "");
		if (path.endsWith("/config"))
			return route.fulfill({ json: { data: { apiBaseUrl: apiBase, protocolVersion: PROTOCOL_VERSION } } });
		expect(request.headers().authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
		return request.method() === "GET" ? respondRead(route, state, path) : respondWrite(route, state, path);
	});
	await installTemplateAgentDetailFixture(page, apiBase);
	const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.searchParams.set("api", apiBase);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await openConsoleNavigation(page);
	await page.getByTestId(editing ? "template-list-tab" : "template-create-tab").click();
	if (editing) await page.getByRole("button", { name: "编辑模版 默认环境模版", exact: true }).click();
	else await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
	return state;
}

async function saveTemplate(page: Page, editing: boolean) {
	const label = editing ? "保存修改" : "保存智能体";
	await openTemplateSaveDialog(page);
	const dialog = page.getByRole("dialog", { name: label, exact: true });
	await dialog.getByRole("button", { name: editing ? "保存修改" : "保存", exact: true }).click();
	if (editing)
		await page
			.getByRole("alertdialog", { name: "确认保存修改", exact: true })
			.getByRole("button", { name: "确认", exact: true })
			.click();
	await expect(page.getByRole("region", { name: "模版列表", exact: true })).toBeVisible();
}

test("智能体默认环境：新建不选环境即可保存，请求省略环境覆盖", async ({ page }) => {
	const state = await openTemplate(page);
	await page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true })
		.fill("默认环境模版");
	await openTemplateAgentPicker(page);
	await page.getByRole("button", { name: "选择智能体 项目助手（agent_existing）", exact: true }).click();
	await confirmTemplateAgentSelection(page);
	const environment = page.getByRole("region", { name: "环境", exact: true });
	await expect(environment.getByRole("button", { name: /^选择环境 /, pressed: true })).toHaveCount(0);
	await expect(environment).toContainText("可选，不配置时使用默认环境。");
	await expect(page.getByRole("region", { name: "已选配置预览", exact: true })).toContainText("使用智能体默认环境");
	await expect(
		page
			.locator('footer[aria-label="模版配置操作"]')
			.getByRole("button", { name: /^(下一步：预览调试|保存智能体|保存修改)$/, includeHidden: true }),
	).toBeEnabled();
	await saveTemplate(page, false);
	expect(state.debugs.at(-1)).toMatchObject({ remote_agent_id: "agent_existing" });
	expect(state.saves).toHaveLength(1);
	expect(state.saves[0]?.method).toBe("POST");
	expect(state.saves[0]?.body).not.toHaveProperty("remote_environment_id");
	expect(state.template).not.toHaveProperty("remote_environment_id");
	expect(state.template).not.toHaveProperty("remote_environment_name");
	expect(state.writes.some((write) => write.includes("/projects/") || write.includes("/resource-drafts"))).toBe(false);
});

test("智能体默认环境：编辑无环境模版不虚构覆盖，显式覆盖后可恢复默认并保存", async ({ page }) => {
	const state = await openTemplate(page, true);
	const environmentName = page.getByRole("textbox", { name: "环境名称", exact: true });
	const summary = page.getByRole("region", { name: "已选配置预览", exact: true });
	await expect(environmentName).toHaveValue("");
	await expect(summary).toContainText("使用智能体默认环境");
	await expect(summary).not.toContainText("env_override");
	await expect(
		page
			.locator('footer[aria-label="模版配置操作"]')
			.getByRole("button", { name: /^(下一步：预览调试|保存智能体|保存修改)$/, includeHidden: true }),
	).toBeEnabled();
	await selectInlineEnvironment(page, "选择环境 覆盖运行环境（env_override）");
	await saveTemplate(page, true);
	expect(state.debugs.at(-1)).toMatchObject({ remote_agent_id: "agent_existing" });
	expect(state.saves[0]).toMatchObject({
		method: "PUT",
		body: { base_version: 2, remote_environment_id: "env_override" },
	});
	await page.getByRole("button", { name: "编辑模版 默认环境模版", exact: true }).click();
	await expect(environmentName).toHaveValue("覆盖运行环境");
	await page
		.getByRole("region", { name: "环境", exact: true })
		.getByRole("button", { name: "清空", exact: true })
		.click();
	await expect(environmentName).toHaveValue("");
	await expect(summary).toContainText("使用智能体默认环境");
	await expect(summary).not.toContainText("env_override");
	await saveTemplate(page, true);
	expect(state.debugs.at(-1)).toMatchObject({ remote_agent_id: "agent_existing" });
	expect(state.saves).toHaveLength(2);
	expect(state.saves[1]).toMatchObject({ method: "PUT", body: { base_version: 3 } });
	expect(state.saves[1]?.body).not.toHaveProperty("remote_environment_id");
	expect(state.template).not.toHaveProperty("remote_environment_id");
	expect(state.template).not.toHaveProperty("remote_environment_name");
});
