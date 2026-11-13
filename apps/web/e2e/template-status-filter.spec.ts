import { PROTOCOL_VERSION, type TemplateView } from "@openagentpack/kit-sdk/protocol";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";

const apiBase = process.env.KIT_E2E_API_URL ?? "http://localhost:8787";
const templatesUrl = `${apiBase}/api/admin/templates`;
const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };
const list = (page: Page) => page.getByRole("region", { name: "模版列表", exact: true });

async function searchTemplates(page: Page, value: string) {
	const response = page.waitForResponse((response) => {
		const url = new URL(response.url());
		return url.pathname.endsWith("/api/admin/templates") && (url.searchParams.get("search") ?? "") === value.trim();
	});
	await list(page).getByRole("searchbox", { name: "搜索模版", exact: true }).fill(value);
	await response;
}

async function seed(request: APIRequestContext, name: string, listed: boolean) {
	const created = await request.post(templatesUrl, {
		headers,
		data: {
			name,
			category: "general",
			remote_agent_id: "agent_mock_assistant",
			remote_environment_id: "env_mock_default",
		},
	});
	expect(created.status()).toBe(201);
	const { data: template } = (await created.json()) as { data: TemplateView };
	if (listed) {
		const url = `${templatesUrl}/${template.template_id}/listing`;
		const input = { display_name: name };
		const planned = await request.post(`${url}/plan`, { headers, data: input });
		expect(planned.status()).toBe(200);
		const { data: plan } = await planned.json();
		const confirmed = await request.post(url, {
			headers,
			data: { ...input, plan_id: plan.plan_id, confirm_token: plan.confirm_token },
		});
		expect(confirmed.status()).toBe(200);
	}
	return template;
}

async function openList(page: Page, search: string) {
	const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.searchParams.set("api", apiBase);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await openConsoleNavigation(page);
	await page.getByTestId("template-list-tab").click();
	await searchTemplates(page, search);
	await expect(list(page).getByRole("table")).toBeVisible();
}

// 保护服务端筛选与分页的 UI 接线；上下架移出当前筛选时必须恢复可用页，且不允许忙碌时切换条件。
test("模版状态筛选：搜索分页保留条件，末页下架后退回上一页，窄屏上架自动移出结果", async ({ page, request }) => {
	const prefix = `状态筛选-${Date.now()}`;
	for (let index = 0; index < 21; index++) await seed(request, `${prefix}-已上架-${index}`, true);
	const unpublished = await seed(request, `${prefix}-未关联`, false);
	await openList(page, prefix);
	const status = list(page).getByRole("combobox", { name: "上架状态", exact: true });
	const search = list(page).getByRole("searchbox", { name: "搜索模版", exact: true });
	const rows = list(page).getByRole("button", { name: /^查看模版 / });
	const pagination = list(page).getByRole("navigation", { name: "模版列表分页", exact: true });
	await expect(status).toHaveValue("");
	await expect(list(page).getByRole("button", { name: "刷新列表", exact: true })).toHaveCount(0);
	await expect(list(page).getByRole("button", { name: "搜索", exact: true })).toHaveCount(0);
	await expect(rows).toHaveCount(20);
	await pagination.getByRole("button", { name: "下一页", exact: true }).click();
	await expect(rows).toHaveCount(2);
	await status.selectOption("listed");
	await expect(pagination).toContainText("第 1 页");
	await expect(rows).toHaveCount(20);
	await expect(list(page).getByRole("cell", { name: "已上架", exact: true })).toHaveCount(20);
	await pagination.getByRole("button", { name: "下一页", exact: true }).click();
	await expect(rows).toHaveCount(1);
	await expect(status).toHaveValue("listed");
	await status.selectOption("unlisted");
	await expect(rows).toHaveCount(1);
	await expect(list(page).getByRole("button", { name: `查看模版 ${unpublished.name}`, exact: true })).toBeVisible();
	await expect(pagination).toHaveCount(0);
	await searchTemplates(page, unpublished.name);
	await expect(status).toHaveValue("unlisted");
	await expect(rows).toHaveCount(1);
	await status.selectOption("listed");
	await expect(list(page).getByText("未找到匹配的模版", { exact: true })).toBeVisible();
	await expect(rows).toHaveCount(0);
	await searchTemplates(page, prefix);
	await expect(rows).toHaveCount(20);
	await expect(status).toHaveValue("listed");
	await pagination.getByRole("button", { name: "下一页", exact: true }).click();
	await expect(rows).toHaveCount(1);
	const unlist = list(page).getByRole("button", { name: /^下架模版 / });
	const removedName = (await unlist.getAttribute("aria-label"))?.replace("下架模版 ", "");
	expect(removedName).toBeTruthy();
	const gate = Promise.withResolvers<void>();
	await page.route(`${apiBase}/api/admin/agents/*`, async (route) => {
		if (route.request().method() === "PATCH") await gate.promise;
		await route.continue();
	});
	await unlist.click();
	const confirmation = page.getByRole("alertdialog", { name: "确认下架", exact: true });
	await confirmation.getByRole("button", { name: "确认下架", exact: true }).click();
	try {
		await expect(page.getByRole("combobox", { name: "上架状态", exact: true, includeHidden: true })).toBeDisabled();
		await expect(page.getByRole("searchbox", { name: "搜索模版", exact: true, includeHidden: true })).toBeDisabled();
	} finally {
		gate.resolve();
	}
	await expect(confirmation).toHaveCount(0);
	await expect(rows).toHaveCount(20);
	await expect(pagination).toHaveCount(0);
	await expect(search).toHaveValue(prefix);
	await expect(status).toHaveValue("listed");
	await expect(list(page).getByRole("button", { name: `查看模版 ${removedName}`, exact: true })).toHaveCount(0);
	await page.setViewportSize({ width: 390, height: 844 });
	await status.selectOption("unlisted");
	await expect(rows).toHaveCount(2);
	await expect(list(page).getByRole("button", { name: `查看模版 ${removedName}`, exact: true })).toBeVisible();
	await list(page)
		.getByRole("button", { name: `上架模版 ${unpublished.name}`, exact: true })
		.click();
	const listing = page.getByRole("alertdialog", { name: "确认上架", exact: true });
	await listing.getByRole("button", { name: "确认上架", exact: true }).click();
	await expect(listing).toHaveCount(0);
	await expect(rows).toHaveCount(1);
	await expect(list(page).getByRole("button", { name: `查看模版 ${removedName}`, exact: true })).toBeVisible();
	await expect(list(page).getByRole("button", { name: `查看模版 ${unpublished.name}`, exact: true })).toHaveCount(0);
	await expect(status).toHaveValue("unlisted");
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

// 虚拟时间推进防抖与中文输入组合，延迟旧请求验证当前结果不会被过期查询覆盖。
test("模版自动搜索：停止输入后查询，中文组词不请求，清空恢复且旧响应不覆盖新结果", async ({ page }) => {
	const fixtureBase = "https://template-search.example/kit";
	const records: TemplateView[] = ["old", "new", "中文"].map((name) => ({
		template_id: `template_${name}`,
		category: "general",
		name,
		remote_agent_id: "agent_mock_assistant",
		remote_agent_name: "assistant",
		agent_version: 1,
		remote_agent_version: 1,
		remote_environment_id: "env_mock_default",
		remote_environment_name: "默认环境",
		files: [],
		memory_stores: [],
		vault_ids: [],
		suggested_prompts: [],
		created_at: "2026-10-30T00:00:00.000Z",
		updated_at: "2026-10-30T00:00:00.000Z",
		version: 1,
	}));
	const queries: { search: string; status: string | null }[] = [];
	const oldStarted = Promise.withResolvers<void>();
	const oldReleased = Promise.withResolvers<void>();
	const oldFinished = Promise.withResolvers<void>();
	await page.route(`${fixtureBase}/api/**`, async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname.endsWith("/config"))
			return route.fulfill({ json: { data: { apiBaseUrl: fixtureBase, protocolVersion: PROTOCOL_VERSION } } });
		if (url.pathname.endsWith("/identity"))
			return route.fulfill({ json: { data: { role: "auditor", subject: "auditor:test" } } });
		if (!url.pathname.endsWith("/templates")) return route.fulfill({ json: { data: [] } });
		const search = url.searchParams.get("search") ?? "";
		queries.push({ search, status: url.searchParams.get("status") });
		if (search === "old") {
			oldStarted.resolve();
			await oldReleased.promise;
		}
		try {
			await route.fulfill({ json: { data: records.filter((record) => record.name.includes(search)) } });
		} finally {
			if (search === "old") oldFinished.resolve();
		}
	});
	const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.searchParams.set("api", fixtureBase);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await openConsoleNavigation(page);
	await page.getByTestId("template-list-tab").click();
	const search = list(page).getByRole("searchbox", { name: "搜索模版", exact: true });
	const rows = list(page).getByRole("button", { name: /^查看模版 / });
	const status = list(page).getByRole("combobox", { name: "上架状态", exact: true });
	await expect(rows).toHaveCount(3);
	const filtered = page.waitForResponse(
		(response) => new URL(response.url()).searchParams.get("status") === "unlisted",
	);
	await status.selectOption("unlisted");
	await filtered;
	await expect(rows).toHaveCount(3);
	await expect(list(page).getByRole("button", { name: "搜索", exact: true })).toHaveCount(0);
	await page.clock.install({ time: new Date("2026-10-30T00:00:00Z") });
	await page.clock.pauseAt(new Date("2026-10-30T00:00:01Z"));
	queries.length = 0;
	await search.fill("n");
	await page.clock.runFor(150);
	await search.fill("ne");
	await page.clock.runFor(150);
	await search.fill("new");
	await page.clock.runFor(299);
	expect(queries).toEqual([]);
	await page.clock.runFor(1);
	await expect(list(page).getByRole("button", { name: "查看模版 new", exact: true })).toBeVisible();
	await expect(rows).toHaveCount(1);
	expect(queries).toEqual([{ search: "new", status: "unlisted" }]);

	await search.dispatchEvent("compositionstart");
	await search.fill("zhong");
	await page.clock.runFor(1000);
	await search.fill("中文");
	await page.clock.runFor(1000);
	expect(queries).toHaveLength(1);
	await search.dispatchEvent("compositionend", { data: "中文" });
	await page.clock.runFor(300);
	await expect(list(page).getByRole("button", { name: "查看模版 中文", exact: true })).toBeVisible();
	expect(queries.at(-1)).toEqual({ search: "中文", status: "unlisted" });

	await search.fill("old");
	await page.clock.runFor(300);
	await oldStarted.promise;
	try {
		await search.fill("new");
		await page.clock.runFor(300);
		await expect(list(page).getByRole("button", { name: "查看模版 new", exact: true })).toBeVisible();
	} finally {
		oldReleased.resolve();
	}
	await oldFinished.promise;
	await page.clock.runFor(1000);
	await expect(list(page).getByRole("button", { name: "查看模版 old", exact: true })).toHaveCount(0);
	await expect(list(page).getByRole("button", { name: "查看模版 new", exact: true })).toBeVisible();
	await search.fill("");
	await page.clock.runFor(300);
	await expect(rows).toHaveCount(3);
	await expect(status).toHaveValue("unlisted");
	expect(queries.at(-1)).toEqual({ search: "", status: "unlisted" });
});
