import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";
import { confirmTemplateAgentSelection, openTemplateAgentPicker } from "./template-agent-selection-helpers.ts";
import { saveInlineDraft } from "./template-inline-helpers.ts";

const api = process.env.KIT_E2E_API_URL ?? "http://localhost:8787";
const origin = process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174";
const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };
function url(path: string) {
	const target = new URL(path, origin);
	target.searchParams.set("api", api);
	return target.href;
}
async function login(page: Page, path = "/templates") {
	await page.goto(url(path));
	await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
	await page.getByRole("button", { name: "进入", exact: true }).click();
}
async function pathIs(page: Page, path: string) {
	await expect.poll(() => new URL(page.url()).pathname).toBe(path);
	expect(new URL(page.url()).searchParams.get("api")).toBe(api);
}

// 保护静态入口直达、刷新后路由恢复、菜单高亮，以及真实浏览器历史同步。
test("所有一级页面有独立路径，登录保留深链，刷新与前进后退恢复页面", async ({ page }) => {
	await login(page, "/operations");
	await expect(page.getByRole("navigation", { name: "管理端导航", exact: true })).toBeVisible();
	await expect(page.getByTestId("sessions-tab")).toHaveCount(0);
	await expect(page.getByTestId("catalog-tab")).toHaveCount(0);
	const routes = [
		["operations", "/operations"],
		["usage", "/usage"],
		["members", "/members"],
		["branding", "/branding"],
		["eval", "/eval"],
		["template-create", "/templates/new"],
		["template-list", "/templates"],
	];
	for (const [tab, path] of routes) {
		await page.getByTestId(`${tab}-tab`).click();
		await pathIs(page, path!);
		await page.reload();
		await expect(page.getByTestId(`${tab}-tab`)).toHaveAttribute("aria-current", "page");
		await expect(page.getByPlaceholder("ADMIN_TOKEN")).toHaveCount(0);
	}
	await page.getByTestId("members-tab").click();
	await page.getByTestId("usage-tab").click();
	await pathIs(page, "/usage");
	await page.evaluate(() => history.back());
	await pathIs(page, "/members");
	await expect(page.getByRole("heading", { name: "成员管理", exact: true })).toBeVisible();
	await page.evaluate(() => history.forward());
	await pathIs(page, "/usage");
	await expect(page.getByTestId("usage-tab")).toHaveAttribute("aria-current", "page");
	await page.evaluate(() => history.go(-2));
	await pathIs(page, "/templates");
	await expect(page.getByRole("region", { name: "模版列表", exact: true })).toBeVisible();
	await page.evaluate(() => history.go(2));
	await pathIs(page, "/usage");
	await expect(page.getByTestId("usage-tab")).toHaveAttribute("aria-current", "page");
});

test("审计员直达创建成员页也只读，不展示可提交表单", async ({ page }) => {
	await page.goto(url("/members/new"));
	await page.getByPlaceholder("ADMIN_TOKEN").fill("e2e-auditor");
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await expect(page.getByText("当前身份只读，不能创建用户。", { exact: true })).toBeVisible();
	await expect(page.getByRole("textbox")).toHaveCount(0);
	await page.reload();
	await expect(page.getByText("当前身份只读，不能创建用户。", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "返回成员列表", exact: true }).click();
	await pathIs(page, "/members");
	await expect(page.getByRole("heading", { name: "成员管理", exact: true })).toBeVisible();
});

test("旧工作台深链回到模版列表，刷新不恢复 Agent 页面或请求项目数据", async ({ page }) => {
	const projectRequests: string[] = [];
	page.on("request", (request) => {
		if (new URL(request.url()).pathname.startsWith("/api/admin/projects")) projectRequests.push(request.url());
	});
	await login(page, "/?agent=kit-demo-reviewer");
	for (const path of ["/", "/project", "/project/changes", "/project/versions", "/project/debug"]) {
		await page.goto(url(`${path}?agent=kit-demo-reviewer`));
		await pathIs(page, "/templates");
		await expect(page.getByRole("region", { name: "模版列表", exact: true })).toBeVisible();
		expect(new URL(page.url()).searchParams.has("agent")).toBe(false);
		await page.reload();
		await expect(page.getByRole("region", { name: "模版列表", exact: true })).toBeVisible();
		await expect(page.getByRole("navigation", { name: "项目区域", exact: true })).toHaveCount(0);
	}
	expect(projectRequests).toEqual([]);
});

test("模版详情、历史版本与编辑可直达，编辑刷新保留已保存配置，失效 ID 显示错误", async ({ page, request }) => {
	const name = `kit-e2e-route-${Date.now()}`;
	const created = await request.post(`${api}/api/admin/templates`, {
		headers,
		data: { name, category: "general", remote_agent_id: "agent_mock_assistant", agent_version: 1 },
	});
	expect(created.status()).toBe(201);
	const template = (await created.json()).data;
	await request.put(`${api}/api/admin/templates/${template.template_id}`, {
		headers,
		data: {
			name: `${name}-new`,
			category: "general",
			remote_agent_id: "agent_mock_assistant",
			agent_version: 1,
			base_version: template.version,
		},
	});
	const path = `/templates/${template.template_id}`;
	await login(page, `${path}?version=1`);
	const detail = page.getByRole("region", { name: "模版详情", exact: true });
	await expect(detail.getByRole("heading", { name, exact: true })).toBeVisible();
	await page.reload();
	await expect(detail.getByText("模版版本：v1", { exact: true })).toBeVisible();
	await detail.getByRole("button", { name: "编辑", exact: true }).click();
	await pathIs(page, `${path}/edit`);
	await expect(
		page
			.getByRole("region", { name: "展示配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true }),
	).toHaveValue(`${name}-new`);
	await page.reload();
	await expect(
		page
			.getByRole("region", { name: "展示配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true }),
	).toHaveValue(`${name}-new`);
	await page.getByRole("button", { name: "返回模版列表", exact: true }).click();
	await pathIs(page, "/templates");
	await page.goto(url("/templates/nonexistent"));
	await expect(page.getByRole("alert")).toBeVisible();
	await expect(page.getByRole("button", { name: "返回模版列表", exact: true })).toBeVisible();
});

test("成员创建与成员用量可刷新，并保持正确父导航", async ({ page, request }) => {
	const suffix = String(Date.now());
	const response = await request.post(`${api}/api/admin/members`, {
		headers,
		data: { username: `route${suffix}`, display_name: `路由成员${suffix}`, auth_type: "local", password_mode: "auto" },
	});
	expect(response.status()).toBe(201);
	const member = (await response.json()).data.member;
	await login(page, `/members/${member.member_id}/usage?from=usage`);
	await expect(page.getByRole("heading", { name: `${member.display_name}的会话用量` })).toBeVisible();
	await page.reload();
	await expect(page.getByRole("heading", { name: `${member.display_name}的会话用量` })).toBeVisible();
	await expect(page.getByTestId("usage-tab")).toHaveAttribute("aria-current", "page");
	await page.getByRole("button", { name: "返回用量列表", exact: true }).click();
	await pathIs(page, "/usage");
	await page.goto(url("/members/new"));
	await expect(page.getByRole("heading", { name: "创建用户", exact: true })).toBeVisible();
	await page.reload();
	await expect(page.getByRole("heading", { name: "创建用户", exact: true })).toBeVisible();
});

test("浏览器返回遵守未发布资源退出确认，取消保留 URL 与草稿，确认后清理", async ({ page, request }) => {
	await login(page);
	await page.getByTestId("template-create-tab").click();
	await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
	await page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true })
		.fill("保留我的草稿");
	await openTemplateAgentPicker(page);
	await page.getByRole("button", { name: "选择智能体 assistant（agent_mock_assistant）", exact: true }).click();
	await confirmTemplateAgentSelection(page);
	await page.getByRole("textbox", { name: "环境名称", exact: true }).fill(`kit-e2e-route-env-${Date.now()}`);
	const draft = await saveInlineDraft(page);
	await page.evaluate(() => history.back());
	const confirmation = page.getByRole("alertdialog", { name: "确认退出", exact: true });
	await expect(confirmation).toBeVisible();
	await pathIs(page, "/templates/new");
	await confirmation.getByRole("button", { name: "取消", exact: true }).click();
	await expect(
		page
			.getByRole("region", { name: "展示配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true }),
	).toHaveValue("保留我的草稿");
	expect((await request.get(`${api}/api/admin/resource-drafts/${draft.draft_id}`, { headers })).status()).toBe(200);
	await page.evaluate(() => history.back());
	await confirmation.getByRole("button", { name: "确认退出", exact: true }).click();
	await pathIs(page, "/templates");
	await expect
		.poll(async () => (await request.get(`${api}/api/admin/resource-drafts/${draft.draft_id}`, { headers })).status())
		.toBe(404);
	await page.evaluate(() => history.forward());
	await pathIs(page, "/templates/new");
	await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
	await expect(
		page
			.getByRole("region", { name: "展示配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true }),
	).toHaveValue("");
});

test("详情调试请求期间浏览器返回被锁定，完成后可返回并清理会话", async ({ page, request }) => {
	const response = await request.post(`${api}/api/admin/templates`, {
		headers,
		data: {
			name: `kit-e2e-route-busy-${Date.now()}`,
			category: "general",
			remote_agent_id: "agent_mock_assistant",
			agent_version: 1,
		},
	});
	const template = (await response.json()).data;
	await login(page, `/templates/${template.template_id}`);
	let release: (() => void) | undefined;
	await page.route("**/api/admin/debug/sessions", async (route) => {
		if (route.request().method() !== "POST") return route.continue();
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		await route.continue();
	});
	await page.getByRole("tab", { name: "调试", exact: true }).click();
	await expect.poll(() => Boolean(release)).toBe(true);
	await expect(page.getByRole("tab", { name: "模版信息", exact: true })).toBeDisabled();
	// 等浏览器真正处理返回并恢复地址，再断言锁定，避免在 history.back 尚未生效时误通过。
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				const restored = () => {
					if (!location.pathname.endsWith("/debug")) return;
					window.removeEventListener("popstate", restored);
					resolve();
				};
				window.addEventListener("popstate", restored);
				history.back();
			}),
	);
	await pathIs(page, `/templates/${template.template_id}/debug`);
	await expect(page.getByRole("tab", { name: "调试", exact: true })).toHaveAttribute("aria-selected", "true");
	const created = page.waitForResponse((r) => r.url() === `${api}/api/admin/debug/sessions` && r.status() === 201);
	release?.();
	const session = (await (await created).json()).data;
	await expect(page.getByRole("tab", { name: "模版信息", exact: true })).toBeEnabled();
	await page.evaluate(() => history.back());
	await pathIs(page, `/templates/${template.template_id}`);
	await expect
		.poll(async () =>
			(await request.get(`${api}/api/admin/debug/sessions/${session.session_id}`, { headers })).status(),
		)
		.toBe(404);
});

test("手机导航同步地址，直接打开缺少内存草稿的预览回到创建方式选择", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await login(page, "/templates/new?step=preview");
	await expect(page.getByRole("button", { name: "导入现有配置", exact: true })).toBeVisible();
	await expect.poll(() => new URL(page.url()).searchParams.has("step")).toBe(false);
	await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
	await expect(
		page
			.getByRole("region", { name: "展示配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true }),
	).toBeVisible();
	await expect.poll(() => new URL(page.url()).searchParams.has("step")).toBe(false);
	await openConsoleNavigation(page);
	await expect(page.getByTestId("sessions-tab")).toHaveCount(0);
	await expect(page.getByTestId("catalog-tab")).toHaveCount(0);
	await page.getByTestId("members-tab").click();
	await pathIs(page, "/members");
	await expect(page.getByRole("dialog", { name: "管理端导航菜单", exact: true })).toHaveCount(0);
	await page.reload();
	await expect(page.getByRole("heading", { name: "成员管理", exact: true })).toBeVisible();
	await openConsoleNavigation(page);
	await page.getByTestId("template-list-tab").click();
	await pathIs(page, "/templates");
	await expect(page.getByRole("region", { name: "模版列表", exact: true })).toBeVisible();
	await expect(page.getByRole("dialog", { name: "管理端导航菜单", exact: true })).toHaveCount(0);
});

test("旧上架目录和会话运营地址回模版列表，评测报告按 URL 重新读取", async ({ page }) => {
	const catalogRequests: string[] = [];
	page.on("request", (request) => {
		if (new URL(request.url()).pathname === "/api/admin/agents") catalogRequests.push(request.url());
	});
	await login(page, "/catalog");
	await pathIs(page, "/templates");
	for (const path of ["/catalog", "/sessions", "/sessions/route-session/timeline"]) {
		await page.goto(url(path));
		await pathIs(page, "/templates");
		await expect(page.getByTestId("template-list-tab")).toHaveAttribute("aria-current", "page");
		await expect(page.getByRole("region", { name: "模版列表", exact: true })).toBeVisible();
		await page.reload();
		await expect(page.getByRole("region", { name: "模版列表", exact: true })).toBeVisible();
	}
	expect(catalogRequests).toEqual([]);
	// 只替换只读响应，验证独立 URL 不依赖此前打开列表或缓存对象。
	const summary = {
		run_id: "route-run",
		skill: { name: "route-skill", version: "1" },
		pass_rate: 1,
		infra_excluded: 0,
		case_count: 1,
		created_at: "2026-11-02T00:00:00Z",
	};
	await page.route("**/api/admin/eval/**", (route) => {
		const path = new URL(route.request().url()).pathname;
		const data = path.endsWith("workspaces")
			? [{ path: "/route-workspace", name: "路由评测", runs: 1 }]
			: path.endsWith("/route-run")
				? { summary, report_html: "<p>路由报告</p>" }
				: [summary];
		return route.fulfill({ json: { data } });
	});
	await page.goto(url("/eval?workspace=%2Froute-workspace&run=route-run"));
	await expect(page.frameLocator('[title="评测报告"]').getByText("路由报告")).toBeVisible();
	await page.reload();
	await expect(page.frameLocator('[title="评测报告"]').getByText("路由报告")).toBeVisible();
});
