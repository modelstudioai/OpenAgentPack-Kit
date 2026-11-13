import { PLAZA_CATEGORY_LABELS, type PlazaCategory, type TemplateView } from "@openagentpack/kit-sdk/protocol";
import type { APIRequestContext, Page } from "@playwright/test";
import { selectConsoleOption, selectedConsoleOption } from "./console-select-helpers.ts";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";
import { openTemplateSaveDialog } from "./template-publish-helpers.ts";

const apiBase = process.env.KIT_E2E_API_URL ?? "http://localhost:8787";
const templatesUrl = `${apiBase}/api/admin/templates`;
const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };
const list = (page: Page) => page.getByRole("region", { name: "模版列表", exact: true });

async function seed(request: APIRequestContext, name: string, category: PlazaCategory, listed = false) {
	const response = await request.post(templatesUrl, {
		headers,
		data: {
			name,
			category,
			remote_agent_id: "agent_mock_assistant",
			agent_version: 1,
			remote_environment_id: "env_mock_default",
		},
	});
	expect(response.status()).toBe(201);
	const template = ((await response.json()) as { data: TemplateView }).data;
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

async function openList(page: Page, prefix: string) {
	const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.searchParams.set("api", apiBase);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await openConsoleNavigation(page);
	await page.getByTestId("template-list-tab").click();
	const searched = page.waitForResponse((response) => {
		const url = new URL(response.url());
		return url.pathname.endsWith("/api/admin/templates") && url.searchParams.get("search") === prefix;
	});
	await list(page).getByRole("searchbox", { name: "搜索模版", exact: true }).fill(prefix);
	await searched;
}

// 保护分类、搜索和状态组合的真实分页；末页唯一项改类后回到有效页，窄屏仍能筛选和清空。
test("模版分类筛选：组合查询保留翻页条件，末页编辑改类后回退，窄屏可切换和清空", async ({ page, request }) => {
	const prefix = `分类筛选-${Date.now()}`;
	const editable: TemplateView[] = [];
	for (let index = 0; index < 21; index++) editable.push(await seed(request, `${prefix}-编程-${index}`, "coding"));
	const published = await seed(request, `${prefix}-已上架`, "coding", true);
	const writing = await seed(request, `${prefix}-写作`, "writing");
	await openList(page, prefix);
	const category = selectedConsoleOption(page, "分类");
	const status = selectedConsoleOption(page, "上架状态");
	const search = list(page).getByRole("searchbox", { name: "搜索模版", exact: true });
	const rows = list(page).getByRole("button", { name: /^查看模版 / });
	const pagination = list(page).getByRole("navigation", { name: "模版列表分页", exact: true });
	await expect(list(page).getByRole("columnheader", { name: "分类", exact: true })).toHaveCount(0);
	await expect(category).toContainText("全部");
	await page.getByRole("combobox", { name: "分类", exact: true }).click();
	await expect(page.locator(".ant-select-dropdown:visible .ant-select-item-option-content")).toHaveText([
		"全部",
		...Object.values(PLAZA_CATEGORY_LABELS),
	]);
	await page.keyboard.press("Escape");
	await selectConsoleOption(page, "分类", "编程");
	await expect(rows).toHaveCount(20);
	await expect(list(page).getByRole("button", { name: `查看模版 ${writing.name}`, exact: true })).toHaveCount(0);
	await pagination.getByRole("button", { name: "下一页", exact: true }).click();
	await expect(rows).toHaveCount(2);
	await expect(pagination).toContainText("第 2 页");
	await expect(category).toContainText("编程");
	await selectConsoleOption(page, "分类", "写作");
	await expect(rows).toHaveCount(1);
	await expect(rows).toHaveAccessibleName(`查看模版 ${writing.name}`);
	await expect(list(page).getByRole("button", { name: `查看模版 ${published.name}`, exact: true })).toHaveCount(0);
	await selectConsoleOption(page, "分类", "编程");
	await expect(rows).toHaveCount(20);
	await expect(pagination).toContainText("第 1 页");
	await selectConsoleOption(page, "上架状态", "未上架");
	await expect(list(page).getByRole("cell", { name: "未上架", exact: true })).toHaveCount(20);
	await expect(list(page).getByRole("button", { name: `查看模版 ${published.name}`, exact: true })).toHaveCount(0);
	await pagination.getByRole("button", { name: "下一页", exact: true }).click();
	await expect(rows).toHaveCount(1);
	await expect(category).toContainText("编程");
	await expect(status).toContainText("未上架");
	await expect(search).toHaveValue(prefix);
	const edit = list(page).getByRole("button", { name: /^编辑模版 / });
	const name = (await edit.getAttribute("aria-label"))!.replace("编辑模版 ", "");
	const target = editable.find((template) => template.name === name)!;
	expect(target).toBeDefined();
	let updates = 0;
	page.on("request", (outgoing) => {
		if (outgoing.method() === "PUT" && outgoing.url() === `${templatesUrl}/${target.template_id}`) updates += 1;
	});
	await edit.click();
	await expect(page.getByRole("heading", { name: "编辑智能体", exact: true })).toBeVisible();
	const editCategory = selectedConsoleOption(page, "分类");
	await expect(editCategory).toContainText("编程");
	await selectConsoleOption(page, "分类", "写作");
	await openTemplateSaveDialog(page);
	const save = page.getByRole("dialog", { name: "保存修改", exact: true });
	await save.getByRole("button", { name: "保存修改", exact: true }).click();
	const confirmation = page.getByRole("dialog", { name: "确认保存修改", exact: true });
	await expect(confirmation).toContainText("修改后会自动生效，是否确认？");
	expect(updates).toBe(0);
	await confirmation.getByRole("button", { name: "确认", exact: true }).click();
	await expect(list(page)).toBeVisible();
	await expect(rows).toHaveCount(20);
	await expect(pagination).toHaveCount(0);
	await expect(category).toContainText("编程");
	await expect(status).toContainText("未上架");
	await expect(search).toHaveValue(prefix);
	await expect(list(page).getByRole("button", { name: `查看模版 ${name}`, exact: true })).toHaveCount(0);
	expect(updates).toBe(1);
	const saved = await request.get(`${templatesUrl}/${target.template_id}`, { headers });
	expect((await saved.json()).data).toMatchObject({ version: 2, category: "writing" });
	await page.setViewportSize({ width: 390, height: 844 });
	await selectConsoleOption(page, "分类", "写作");
	await expect(rows).toHaveCount(2);
	await expect(list(page).getByRole("button", { name: `查看模版 ${name}`, exact: true })).toBeVisible();
	await expect(list(page).getByRole("button", { name: `查看模版 ${writing.name}`, exact: true })).toBeVisible();
	await selectConsoleOption(page, "分类", "全部");
	await expect(rows).toHaveCount(20);
	await expect(category).toContainText("全部");
	await expect(status).toContainText("未上架");
	await expect(search).toHaveValue(prefix);
	await expect(list(page).getByRole("button", { name: `查看模版 ${writing.name}`, exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
