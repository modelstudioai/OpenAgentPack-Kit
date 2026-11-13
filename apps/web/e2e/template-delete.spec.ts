import type { TemplateView } from "@openagentpack/kit-sdk/protocol";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";

const apiBase = process.env.KIT_E2E_API_URL ?? "http://localhost:8787";
const templatesUrl = `${apiBase}/api/admin/templates`;
const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };
const selected = {
	category: "general",
	remote_agent_id: "agent_mock_assistant",
	remote_environment_id: "env_mock_default",
};
const list = (page: Page) => page.getByRole("region", { name: "模版列表", exact: true });
const dialog = (page: Page) => page.getByRole("alertdialog", { name: "确认删除", exact: true });

async function seed(request: APIRequestContext, name: string): Promise<TemplateView> {
	const response = await request.post(templatesUrl, { headers, data: { ...selected, name } });
	expect(response.status()).toBe(201);
	return (await response.json()).data;
}

async function openList(page: Page, search: string, token = ADMIN_TOKEN) {
	const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.searchParams.set("api", apiBase);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(token);
	const identity = page.waitForResponse((response) => response.url() === `${apiBase}/api/admin/identity`);
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await identity;
	await openConsoleNavigation(page);
	await page.getByTestId("template-list-tab").click();
	const filtered = page.waitForResponse((response) => {
		const url = new URL(response.url());
		return url.pathname.endsWith("/api/admin/templates") && url.searchParams.get("search") === search.trim();
	});
	await list(page).getByRole("searchbox", { name: "搜索模版" }).fill(search);
	await filtered;
	await expect(list(page).getByRole("table")).toBeVisible();
}

async function openDelete(page: Page, name: string) {
	await list(page)
		.getByRole("button", { name: `删除模版 ${name}`, exact: true })
		.click();
	await expect(dialog(page)).toBeVisible();
	await expect(page.getByRole("alertdialog")).toHaveCount(1);
	await expect(page.getByRole("dialog")).toHaveCount(0);
}

// 删除整个模版及关联入口，取消无写入；已存在会话不随目录一起删除。
test("删除模版：取消保留，确认删除已上架模版与目录并保留既有会话", async ({ page, request }) => {
	const name = `删除闭环-${Date.now()}`;
	const template = await seed(request, name);
	const target = `${templatesUrl}/${template.template_id}`;
	const edited = await request.put(target, {
		headers,
		data: { ...selected, name, base_version: 1, description: "新版配置" },
	});
	expect((await edited.json()).data.version).toBe(2);
	const input = { display_name: name };
	const planned = await request.post(`${target}/listing/plan`, { headers, data: input });
	const { data: plan } = await planned.json();
	const listed = await request.post(`${target}/listing`, {
		headers,
		data: { ...input, plan_id: plan.plan_id, confirm_token: plan.confirm_token },
	});
	expect(listed.status()).toBe(200);
	const { data: entry } = await listed.json();
	const created = await request.post(`${apiBase}/api/kit/sessions`, { data: { agent_slug: entry.slug } });
	expect(created.status()).toBe(201);
	const { data: session } = await created.json();
	let deletes = 0;
	page.on("request", (outgoing) => {
		if (outgoing.method() === "DELETE" && outgoing.url() === target) deletes++;
	});
	await openList(page, name);
	await openDelete(page, name);
	await expect(dialog(page).getByText("是否删除该模版", { exact: true })).toBeVisible();
	await expect(dialog(page).getByRole("button", { name: "确认删除", exact: true })).toBeEnabled();
	await expect(dialog(page)).not.toContainText(name);
	await expect(dialog(page)).not.toContainText("全部历史版本");
	await dialog(page).getByRole("button", { name: "取消", exact: true }).click();
	await expect(dialog(page)).toHaveCount(0);
	expect(deletes).toBe(0);
	expect((await request.get(target, { headers })).status()).toBe(200);
	await openDelete(page, name);
	await dialog(page).getByRole("button", { name: "确认删除", exact: true }).click();
	await expect(dialog(page)).toHaveCount(0);
	await expect(list(page).getByRole("status").filter({ hasText: "已删除" })).toBeVisible();
	await expect(list(page).getByRole("button", { name: `查看模版 ${name}`, exact: true })).toHaveCount(0);
	expect(deletes).toBe(1);
	expect((await request.get(target, { headers })).status()).toBe(404);
	expect((await request.get(`${apiBase}/api/kit/agents/${entry.slug}`)).status()).toBe(404);
	expect((await request.get(`${apiBase}/api/kit/sessions/${session.session_id}`)).status()).toBe(200);
	const catalog = await request.get(`${apiBase}/api/admin/agents`, { headers });
	expect((await catalog.json()).data.some((item: { id: string }) => item.id === entry.id)).toBe(false);
});

// 计划和提交失败都保留弹窗，重试不能静默执行删除；只读角色看到资源但没有删除入口。
test("删除模版：窄屏失败重试仍需确认，auditor 只读", async ({ page, request, browser }) => {
	const name = `删除重试-${Date.now()}`;
	const template = await seed(request, name);
	const target = `${templatesUrl}/${template.template_id}`;
	const auditor = await browser.newContext();
	try {
		const auditPage = await auditor.newPage();
		await openList(auditPage, name, "e2e-auditor");
		await expect(list(auditPage).getByRole("button", { name: `查看模版 ${name}`, exact: true })).toBeVisible();
		await expect(list(auditPage).getByRole("button", { name: /^删除模版 / })).toHaveCount(0);
	} finally {
		await auditor.close();
	}
	await page.setViewportSize({ width: 390, height: 844 });
	let plans = 0;
	let deletes = 0;
	const failure = {
		status: 503,
		json: { error: { code: "provider_error", message: "临时失败，请重试", retryable: true } },
	};
	await page.route(`${target}/delete/plan`, async (route) => {
		plans++;
		if (plans === 1) await route.fulfill(failure);
		else await route.continue();
	});
	await page.route(target, async (route) => {
		if (route.request().method() !== "DELETE") return route.continue();
		deletes++;
		if (deletes === 1) await route.fulfill(failure);
		else await route.continue();
	});
	await openList(page, name);
	await openDelete(page, name);
	await expect(dialog(page)).toContainText("临时失败");
	await dialog(page).getByRole("button", { name: "重试", exact: true }).click();
	await expect(dialog(page).getByRole("button", { name: "确认删除", exact: true })).toBeEnabled();
	expect(plans).toBe(2);
	expect(deletes).toBe(0);
	await dialog(page).getByRole("button", { name: "确认删除", exact: true }).click();
	await expect(dialog(page)).toContainText("临时失败");
	expect(deletes).toBe(1);
	await dialog(page).getByRole("button", { name: "重试", exact: true }).click();
	await expect(dialog(page).getByRole("button", { name: "确认删除", exact: true })).toBeEnabled();
	expect(plans).toBe(3);
	expect(deletes).toBe(1);
	await dialog(page).getByRole("button", { name: "确认删除", exact: true }).click();
	await expect(dialog(page)).toHaveCount(0);
	await expect(list(page).getByRole("status").filter({ hasText: "已删除" })).toBeVisible();
	expect(deletes).toBe(2);
});

test("删除模版：删除末页唯一记录返回上一页并保留搜索", async ({ page, request }) => {
	const prefix = `删除分页-${Date.now()}`;
	for (let i = 0; i < 21; i++) await seed(request, `${prefix}-${i}`);
	await openList(page, prefix);
	await list(page).getByRole("button", { name: "下一页", exact: true }).click();
	await expect(list(page).getByRole("button", { name: /^删除模版 / })).toHaveCount(1);
	await list(page)
		.getByRole("button", { name: /^删除模版 / })
		.click();
	await dialog(page).getByRole("button", { name: "确认删除", exact: true }).click();
	await expect(dialog(page)).toHaveCount(0);
	await expect(list(page).getByRole("searchbox", { name: "搜索模版" })).toHaveValue(prefix);
	await expect(list(page).getByRole("button", { name: /^删除模版 / })).toHaveCount(20);
	await expect(list(page).getByRole("navigation", { name: "模版列表分页" })).toHaveCount(0);
});
