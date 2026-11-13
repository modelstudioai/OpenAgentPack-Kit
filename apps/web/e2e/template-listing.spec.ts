import type { CatalogAgentView, TemplateCreateInput, TemplateView } from "@openagentpack/kit-sdk/protocol";
import type { APIRequestContext, Page } from "@playwright/test";
import { selectConsoleOption } from "./console-select-helpers.ts";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";

const apiBase = process.env.KIT_E2E_API_URL ?? "http://localhost:8787";
const templatesUrl = `${apiBase}/api/admin/templates`;
const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };
const list = (page: Page) => page.getByRole("region", { name: "模版列表", exact: true });
const confirmation = (page: Page, action = "上架") => page.getByRole("dialog", { name: `确认${action}`, exact: true });

async function login(page: Page, token = ADMIN_TOKEN) {
	const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.searchParams.set("api", apiBase);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(token);
	await page.getByRole("button", { name: "进入", exact: true }).click();
}

async function openList(page: Page, name: string) {
	await openConsoleNavigation(page);
	await page.getByTestId("template-list-tab").click();
	await expect(list(page)).toBeVisible();
	const search = list(page).getByRole("searchbox", { name: "搜索模版", exact: true });
	const searched = page.waitForResponse((response) => {
		const url = new URL(response.url());
		return url.pathname === "/api/admin/templates" && url.searchParams.get("search") === name;
	});
	await search.fill(name);
	await searched;
	await expect(list(page).getByRole("button", { name: `查看模版 ${name}`, exact: true })).toBeVisible();
}

async function seedTemplate(request: APIRequestContext, input: Partial<TemplateCreateInput> & { name: string }) {
	const response = await request.post(templatesUrl, {
		headers,
		data: {
			category: "general",
			remote_agent_id: "agent_mock_assistant",
			remote_environment_id: "env_mock_analysis",
			...input,
		},
	});
	expect(response.status()).toBe(201);
	return ((await response.json()) as { data: TemplateView }).data;
}

async function catalog(request: APIRequestContext): Promise<CatalogAgentView[]> {
	const response = await request.get(`${apiBase}/api/admin/agents`, { headers });
	expect(response.ok()).toBeTruthy();
	return (await response.json()).data;
}

async function seedListedTemplate(request: APIRequestContext, template: TemplateView): Promise<CatalogAgentView> {
	const url = `${templatesUrl}/${template.template_id}/listing`;
	const input = { display_name: template.name };
	const planned = await request.post(`${url}/plan`, { headers, data: input });
	expect(planned.status()).toBe(200);
	const { data: plan } = await planned.json();
	const listed = await request.post(url, {
		headers,
		data: { ...input, plan_id: plan.plan_id, confirm_token: plan.confirm_token },
	});
	expect(listed.ok()).toBeTruthy();
	return (await listed.json()).data;
}

async function openListing(page: Page, name: string, action = "上架") {
	await list(page)
		.getByRole("button", { name: `${action}模版 ${name}`, exact: true })
		.click();
	await expect(confirmation(page, action)).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(1);
	await expect(confirmation(page, action)).toContainText(`是否${action}模版「${name}」？`);
	await expect(confirmation(page, action).getByRole("textbox")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "预览上架计划", exact: true })).toHaveCount(0);
}

// 保护上架→下架→重新上架的闭环：状态、员工可见性和原目录身份一致，取消不写且提交单飞。
test("模版上下架：取消不写目录，确认后状态可见，重新上架复用完整配置", async ({ page, request }) => {
	const name = `上架闭环-${Date.now()}`;
	const uploaded = await request.post(`${apiBase}/api/kit/files`, {
		multipart: { file: { name: `${name}.txt`, mimeType: "text/plain", buffer: Buffer.from("项目资料") } },
	});
	expect(uploaded.status()).toBe(201);
	const { data: file } = (await uploaded.json()) as { data: { file_id: string } };
	const saved = await seedTemplate(request, {
		name,
		remote_agent_id: "agent_mock_designer",
		agent_version: 1,
		files: [{ file_id: file.file_id }],
		memory_stores: [{ memory_store_id: "memory-guide", access: "read_only", instructions: "用于项目问答" }],
		vault_ids: ["vlt_mock_1"],
		description: "为项目团队解答问题",
		opening_remarks: "你好，需要了解哪些项目资料？",
		suggested_prompts: ["总结项目进展"],
	});
	const before = await catalog(request);
	const listingUrl = `${templatesUrl}/${saved.template_id}/listing`;
	const executeGate = Promise.withResolvers<void>();
	let writes = 0;
	await page.route(listingUrl, async (route) => {
		writes += 1;
		await executeGate.promise;
		return route.continue();
	});
	await login(page);
	await openList(page, name);
	await expect(list(page).getByRole("columnheader", { name: "状态", exact: true })).toBeVisible();
	await expect(list(page).getByRole("columnheader", { name: "上架时间", exact: true })).toBeVisible();
	const columnLabels = await list(page).getByRole("columnheader").allTextContents();
	const listedAt = list(page)
		.getByRole("row")
		.filter({ hasText: name })
		.getByRole("cell")
		.nth(columnLabels.indexOf("上架时间"));
	await expect(listedAt).toHaveText("—");
	await expect(list(page).getByRole("cell", { name: "未上架", exact: true })).toBeVisible();
	await openListing(page, name);
	await confirmation(page).getByRole("button", { name: "取消", exact: true }).click();
	await expect(confirmation(page)).toHaveCount(0);
	expect(await catalog(request)).toEqual(before);
	expect(writes).toBe(0);
	await openListing(page, name);
	await confirmation(page).getByRole("button", { name: "确认上架", exact: true }).click();
	try {
		await expect(confirmation(page).getByRole("button", { name: "取消", exact: true })).toBeDisabled();
		await expect(confirmation(page).getByRole("button", { name: "确认上架", exact: true })).toBeDisabled();
		await expect(page.getByTestId("members-tab")).toBeDisabled();
		await expect(page.getByTestId("template-create-tab")).toBeDisabled();
		await page.keyboard.press("Escape");
		await expect(confirmation(page)).toBeVisible();
		expect(writes).toBe(1);
	} finally {
		executeGate.resolve();
	}
	await expect(confirmation(page)).toHaveCount(0);
	await expect(list(page).getByRole("cell", { name: "已上架", exact: true })).toBeVisible();
	await expect(list(page).getByRole("button", { name: `下架模版 ${name}`, exact: true })).toBeEnabled();
	const entries = (await catalog(request)).filter((entry) => entry.display_name === name);
	expect(entries).toHaveLength(1);
	const entry = entries[0]!;
	await expect(listedAt.locator("time")).toHaveAttribute("datetime", entry.updated_at);
	await expect(listedAt).not.toHaveText("—");
	expect(entry).toMatchObject({
		status: "listed",
		remote_agent_id: saved.remote_agent_id,
		agent_version: 1,
		remote_environment_id: saved.remote_environment_id,
		files: saved.files,
		memory_stores: saved.memory_stores,
		vault_ids: saved.vault_ids,
	});
	const publicDetail = await request.get(`${apiBase}/api/kit/agents/${entry.slug}`);
	expect(publicDetail.status()).toBe(200);
	expect((await publicDetail.json()).data).toMatchObject({
		display_name: name,
		description: saved.description,
		opening_remarks: saved.opening_remarks,
		suggested_prompts: saved.suggested_prompts,
	});
	await page.reload();
	await openList(page, name);
	await expect(listedAt.locator("time")).toHaveAttribute("datetime", entry.updated_at);
	await expect(list(page).getByRole("cell", { name: "已上架", exact: true })).toBeVisible();
	const readback = await request.get(`${templatesUrl}/${saved.template_id}`, { headers });
	expect((await readback.json()).data.listing).toMatchObject({
		catalog_id: entry.id,
		slug: entry.slug,
		status: "listed",
	});
	const catalogUrl = `${apiBase}/api/admin/agents/${entry.slug}`;
	let unlistingWrites = 0;
	page.on("request", (outgoing) => {
		if (outgoing.method() === "PATCH" && outgoing.url() === catalogUrl) unlistingWrites += 1;
	});
	await openListing(page, name, "下架");
	await confirmation(page, "下架").getByRole("button", { name: "取消", exact: true }).click();
	await expect(confirmation(page, "下架")).toHaveCount(0);
	expect(unlistingWrites).toBe(0);
	await expect(list(page).getByRole("cell", { name: "已上架", exact: true })).toBeVisible();
	expect((await request.get(`${apiBase}/api/kit/agents/${entry.slug}`)).status()).toBe(200);
	await openListing(page, name, "下架");
	await confirmation(page, "下架").getByRole("button", { name: "确认下架", exact: true }).click();
	await expect(confirmation(page, "下架")).toHaveCount(0);
	await expect(list(page).getByRole("cell", { name: "未上架", exact: true })).toBeVisible();
	await expect(list(page).getByRole("button", { name: `上架模版 ${name}`, exact: true })).toBeEnabled();
	await expect(listedAt.locator("time")).toHaveAttribute("datetime", entry.updated_at);
	expect(unlistingWrites).toBe(1);
	expect((await request.get(`${apiBase}/api/kit/agents/${entry.slug}`)).status()).toBe(404);
	await openListing(page, name);
	await confirmation(page).getByRole("button", { name: "确认上架", exact: true }).click();
	await expect(confirmation(page)).toHaveCount(0);
	await expect(list(page).getByRole("cell", { name: "已上架", exact: true })).toBeVisible();
	const relisted = (await catalog(request)).filter((item) => item.display_name === name);
	expect(relisted).toHaveLength(1);
	await expect(listedAt.locator("time")).toHaveAttribute("datetime", relisted[0]!.updated_at);
	expect(relisted[0]!.updated_at).not.toBe(entry.updated_at);
	expect(relisted[0]).toMatchObject({
		id: entry.id,
		slug: entry.slug,
		status: "listed",
		files: saved.files,
		agent_version: 1,
		memory_stores: saved.memory_stores,
		vault_ids: saved.vault_ids,
	});
});

// 保护窄屏单层确认弹窗的恢复路径；重试仅准备计划，成功后仍须用户再次确认才写入。
test("模版下架：窄屏计划或执行失败可重试，每次准备完成后仍需确认", async ({ page, request }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const name = `下架重试-${Date.now()}`;
	const saved = await seedTemplate(request, { name });
	const entry = await seedListedTemplate(request, saved);
	const catalogUrl = `${apiBase}/api/admin/agents/${entry.slug}`;
	const dialog = confirmation(page, "下架");
	let attempts = 0;
	let writes = 0;
	page.on("request", (outgoing) => {
		if (outgoing.method() === "PATCH" && outgoing.url() === catalogUrl) writes += 1;
	});
	await page.route(catalogUrl, async (route) =>
		writes === 1
			? route.fulfill({ status: 503, json: { error: { code: "provider_error", message: "提交暂不可用" } } })
			: route.continue(),
	);
	await page.route(`${catalogUrl}/plan`, async (route) => {
		attempts += 1;
		return attempts === 1
			? route.fulfill({ status: 503, json: { error: { code: "provider_error", message: "下架计划暂不可用" } } })
			: route.continue();
	});
	await login(page);
	await openList(page, name);
	await openListing(page, name, "下架");
	await expect(dialog).toContainText("下架计划暂不可用");
	await dialog.getByRole("button", { name: "重试", exact: true }).click();
	await expect(dialog.getByRole("button", { name: "确认下架", exact: true })).toBeEnabled();
	await expect(dialog).not.toContainText("下架计划暂不可用");
	expect(attempts).toBe(2);
	expect(writes).toBe(0);
	expect((await catalog(request)).find((item) => item.id === entry.id)?.status).toBe("listed");
	await dialog.getByRole("button", { name: "确认下架", exact: true }).click();
	await expect(dialog).toContainText("提交暂不可用");
	await dialog.getByRole("button", { name: "重试", exact: true }).click();
	await expect(dialog.getByRole("button", { name: "确认下架", exact: true })).toBeEnabled();
	await expect(dialog).not.toContainText("提交暂不可用");
	expect(attempts).toBe(3);
	expect(writes).toBe(1);
	expect((await catalog(request)).find((item) => item.id === entry.id)?.status).toBe("listed");
	await dialog.getByRole("button", { name: "确认下架", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(list(page).getByRole("cell", { name: "未上架", exact: true })).toBeVisible();
	await expect(list(page).getByRole("button", { name: `上架模版 ${name}`, exact: true })).toBeEnabled();
	expect((await catalog(request)).find((item) => item.id === entry.id)?.status).toBe("unlisted");
	expect(writes).toBe(2);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

// 先存在两种状态的真实模版，等待身份和目录加载完成，再断言审计员没有上下架操作。
test("模版上下架：auditor 可查看两种状态的模版，但没有上下架入口", async ({ page, request }) => {
	const prefix = `只读状态-${Date.now()}`;
	const unlisted = await seedTemplate(request, { name: `${prefix}-未上架` });
	const listed = await seedTemplate(request, { name: `${prefix}-已上架` });
	await seedListedTemplate(request, listed);
	const writes: string[] = [];
	page.on("request", (outgoing) => {
		if (["POST", "PATCH"].includes(outgoing.method()) && outgoing.url().includes("/api/admin/")) {
			writes.push(outgoing.url());
		}
	});
	await login(page, "e2e-auditor");
	await openList(page, unlisted.name);
	const search = list(page).getByRole("searchbox", { name: "搜索模版", exact: true });
	const searched = page.waitForResponse((response) => {
		const url = new URL(response.url());
		return url.pathname === "/api/admin/templates" && url.searchParams.get("search") === prefix;
	});
	await search.fill(prefix);
	await searched;
	await expect(list(page).getByRole("button", { name: `查看模版 ${listed.name}`, exact: true })).toBeVisible();
	await expect(list(page).getByRole("cell", { name: "已上架", exact: true })).toBeVisible();
	await expect(list(page).getByRole("cell", { name: "未上架", exact: true })).toBeVisible();
	await expect(list(page).getByRole("button", { name: /^(上架|下架)模版 / })).toHaveCount(0);
	await selectConsoleOption(page, "上架状态", "未上架");
	await expect(list(page).getByRole("button", { name: `查看模版 ${unlisted.name}`, exact: true })).toBeVisible();
	await expect(list(page).getByRole("button", { name: `查看模版 ${listed.name}`, exact: true })).toHaveCount(0);
	await selectConsoleOption(page, "上架状态", "已上架");
	await expect(list(page).getByRole("button", { name: `查看模版 ${listed.name}`, exact: true })).toBeVisible();
	await expect(list(page).getByRole("button", { name: `查看模版 ${unlisted.name}`, exact: true })).toHaveCount(0);
	await expect(list(page).getByRole("button", { name: /^(上架|下架)模版 / })).toHaveCount(0);
	await list(page)
		.getByRole("button", { name: `查看模版 ${listed.name}`, exact: true })
		.click();
	await expect(page.getByRole("region", { name: "模版详情", exact: true })).toContainText(listed.template_id);
	expect(writes).toEqual([]);
});
