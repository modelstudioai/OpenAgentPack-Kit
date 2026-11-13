import { PLAZA_CATEGORY_LABELS, type TemplateCreateInput, type TemplateView } from "@openagentpack/kit-sdk/protocol";
import type { APIRequestContext, Locator, Page, Request } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";

const apiBase = process.env.KIT_E2E_API_URL ?? "http://localhost:8787";
const templatesUrl = `${apiBase}/api/admin/templates`;
const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };
const drawer = (page: Page) => page.getByRole("dialog", { name: "版本管理", exact: true });
const versions = (page: Page) => drawer(page).getByRole("region", { name: "模版版本列表", exact: true });
const detail = (page: Page) => page.getByRole("region", { name: "模版详情", exact: true });
const selectVersion = (page: Page, version: number) =>
	versions(page).getByRole("button", { name: `查看模版版本 v${version}`, exact: true });

async function seedVersions(request: APIRequestContext) {
	const prefix = `历史配置-${Date.now()}`;
	const initial: TemplateCreateInput = {
		name: `${prefix}-初稿`,
		category: "writing",
		remote_agent_id: "agent_mock_designer",
		agent_version: 1,
		remote_environment_id: "env_mock_default",
		description: "第一版独有的描述",
		opening_remarks: "欢迎阅读初版配置",
		suggested_prompts: ["查询初版资料"],
		memory_stores: [{ memory_store_id: "memory-guide", access: "read_only", instructions: "初版查询说明" }],
		vault_ids: ["vlt_mock_1"],
	};
	const created = await request.post(templatesUrl, { headers, data: initial });
	expect(created.status()).toBe(201);
	const first = ((await created.json()) as { data: TemplateView }).data;
	const updated = await request.put(`${templatesUrl}/${first.template_id}`, {
		headers,
		data: {
			...initial,
			base_version: first.version,
			name: `${prefix}-定稿`,
			category: "data",
			agent_version: 3,
			remote_environment_id: "env_mock_analysis",
			description: "第二版独有的描述",
			opening_remarks: "欢迎阅读定稿配置",
			suggested_prompts: ["查询定稿资料"],
			memory_stores: [{ memory_store_id: "memory-notes", access: "read_write", instructions: "定稿读写说明" }],
			vault_ids: ["vlt_mock_2"],
		},
	});
	expect(updated.status()).toBe(200);
	const current = ((await updated.json()) as { data: TemplateView }).data;
	expect(current.version).toBe(2);
	return { first, current };
}

async function openTemplate(page: Page, name: string) {
	const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.searchParams.set("api", apiBase);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill("e2e-auditor");
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await openConsoleNavigation(page);
	await page.getByTestId("template-list-tab").click();
	const list = page.getByRole("region", { name: "模版列表", exact: true });
	const search = list.getByRole("searchbox", { name: "搜索模版", exact: true });
	await search.fill(name);
	await list.getByRole("button", { name: `查看模版 ${name}`, exact: true }).click();
	await expect(page.getByRole("region", { name: "模版详情", exact: true })).toContainText(name);
	await page.getByRole("button", { name: "版本管理", exact: true }).click();
	await expect(drawer(page)).toBeVisible();
}

async function expectSnapshot(view: Locator, selected: TemplateView, other: TemplateView) {
	await expect(view.getByRole("heading", { name: selected.name, exact: true })).toBeVisible();
	await expect(view.getByText(`模版版本：v${selected.version}`, { exact: true })).toBeVisible();
	await expect(view.locator("time")).toHaveAttribute("datetime", selected.updated_at);
	await expect(
		view.getByRole("region", { name: "基础配置", exact: true }).getByRole("region", { name: "版本", exact: true }),
	).toBeVisible();
	await expect(
		view.getByRole("region", { name: "基础配置", exact: true }).getByRole("region", { name: "版本", exact: true }),
	).toContainText(`v${selected.agent_version}`);
	await expect(view.getByRole("region", { name: "环境", exact: true })).toContainText(selected.remote_environment_id);
	const presentation = view.getByRole("region", { name: "展示配置", exact: true });
	await expect(presentation.getByText(PLAZA_CATEGORY_LABELS[selected.category], { exact: true })).toBeVisible();
	for (const text of [selected.description!, selected.opening_remarks!, ...selected.suggested_prompts]) {
		await expect(presentation).toContainText(text);
	}
	await expect(view.getByRole("region", { name: "记忆库", exact: true })).toContainText(
		selected.memory_stores[0]!.memory_store_id,
	);
	await expect(view.getByRole("region", { name: "密钥库", exact: true })).toContainText(selected.vault_ids[0]!);
	await expect(view).not.toContainText(other.description!);
	await expect(view.getByRole("textbox")).toHaveCount(0);
}

// 保护时间线选择驱动主详情：失败不展示旧配置，重试和迟到响应隔离，审计员全程只读。
test("模版历史版本：窄屏选择切换主详情，失败重试与迟到响应不串版本", async ({ page, request }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const { first, current } = await seedVersions(request);
	const firstUrl = `${templatesUrl}/${first.template_id}/versions/1`;
	const writes: string[] = [];
	page.on("request", (outgoing) => {
		if (outgoing.url().startsWith(templatesUrl) && outgoing.method() !== "GET") {
			writes.push(`${outgoing.method()} ${outgoing.url()}`);
		}
	});
	let attempts = 0;
	const lateRequest = Promise.withResolvers<void>();
	const lateSettled = Promise.withResolvers<void>();
	let pendingRequest: Request | undefined;
	const observeSettled = (outgoing: Request) => {
		if (outgoing === pendingRequest) lateSettled.resolve();
	};
	page.on("requestfinished", observeSettled);
	page.on("requestfailed", observeSettled);
	const release = Promise.withResolvers<void>();
	await page.route(firstUrl, async (route) => {
		attempts += 1;
		if (attempts === 1) {
			return route.fulfill({ status: 503, json: { error: { code: "provider_error", message: "历史版本暂不可用" } } });
		}
		if (attempts === 3) {
			pendingRequest = route.request();
			lateRequest.resolve();
			await release.promise;
		}
		return route.continue();
	});
	try {
		await openTemplate(page, current.name);
		const timeline = versions(page).getByRole("list", { name: "模版版本时间线", exact: true });
		await expect(timeline).toBeVisible();
		const rows = timeline.getByRole("button", { name: /^查看模版版本 v/ });
		await expect(rows).toHaveCount(2);
		await expect(rows.nth(0)).toHaveAccessibleName("查看模版版本 v2");
		await expect(rows.nth(1)).toHaveAccessibleName("查看模版版本 v1");
		for (const selected of [current, first]) {
			const card = selectVersion(page, selected.version);
			await expect(card.getByText("智能体", { exact: true })).toBeVisible();
			await expect(card.getByText("运行时配置", { exact: true })).toBeVisible();
			for (const text of [
				selected.remote_agent_name,
				`v${selected.agent_version}`,
				selected.remote_environment_name,
				selected.memory_stores[0]!.memory_store_id,
				selected.vault_ids[0]!,
				"未选择",
			]) {
				await expect(card).toContainText(text);
			}
		}
		await expect(selectVersion(page, 2)).toContainText("当前版本");
		await expect(selectVersion(page, 2)).toHaveAttribute("aria-pressed", "true");
		await expect(selectVersion(page, 1)).not.toContainText("当前版本");
		await selectVersion(page, 1).click();
		await expect(drawer(page)).toHaveCount(0);
		await expect(detail(page).getByRole("alert")).toContainText("历史版本暂不可用");
		await expect(detail(page).getByRole("region", { name: "展示配置", exact: true })).toHaveCount(0);
		await expect(detail(page)).not.toContainText(current.description!);
		await detail(page).getByRole("button", { name: "重试", exact: true }).click();
		await expectSnapshot(detail(page), first, current);
		await expect(detail(page).getByRole("button", { name: "应用此版本", exact: true })).toHaveCount(0);
		await page.getByRole("button", { name: "版本管理", exact: true }).click();
		await expect(rows).toHaveCount(2);
		await expect(selectVersion(page, 1)).toHaveAttribute("aria-pressed", "true");
		await expect(selectVersion(page, 2)).toHaveAttribute("aria-pressed", "false");
		await expect(selectVersion(page, 2)).toContainText("当前版本");
		await selectVersion(page, 2).click();
		await expect(drawer(page)).toHaveCount(0);
		await expectSnapshot(detail(page), current, first);
		await page.getByRole("button", { name: "版本管理", exact: true }).click();
		await selectVersion(page, 1).click();
		await expect(drawer(page)).toHaveCount(0);
		await lateRequest.promise;
		await expect(detail(page).getByRole("region", { name: "展示配置", exact: true })).toHaveCount(0);
		await page.getByRole("button", { name: "版本管理", exact: true }).click();
		await expect(rows).toHaveCount(2);
		await selectVersion(page, 2).click();
		await expect(drawer(page)).toHaveCount(0);
		await expectSnapshot(detail(page), current, first);
		release.resolve();
		await lateSettled.promise;
		await expectSnapshot(detail(page), current, first);
		await page.getByRole("button", { name: "版本管理", exact: true }).click();
		await expect(selectVersion(page, 2)).toHaveAttribute("aria-pressed", "true");
		await drawer(page).getByRole("button", { name: "关闭版本管理", exact: true }).click();
		await page.getByRole("button", { name: "版本管理", exact: true }).click();
		await expect(rows).toHaveCount(2);
		await expect(selectVersion(page, 2)).toHaveAttribute("aria-pressed", "true");
		expect(writes).toEqual([]);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	} finally {
		release.resolve();
	}
});

// 保护分页时间线与主详情的选择状态：重开回第一页，跨页仍能找到并高亮当前查看的历史版本。
test("模版历史版本：分页选择切换主详情，重开第一页并保留跨页选中状态", async ({ page, request }) => {
	await page.setViewportSize({ width: 1280, height: 500 });
	const input: TemplateCreateInput = {
		name: `历史分页-${Date.now()}`,
		category: "general",
		remote_agent_id: "agent_mock_designer",
		agent_version: 1,
		remote_environment_id: "env_mock_default",
	};
	const created = await request.post(templatesUrl, { headers, data: { ...input, description: "配置版本 1" } });
	expect(created.status()).toBe(201);
	const template = ((await created.json()) as { data: TemplateView }).data;
	for (let version = 2; version <= 21; version += 1) {
		const updated = await request.put(`${templatesUrl}/${template.template_id}`, {
			headers,
			data: { ...input, base_version: version - 1, description: `配置版本 ${version}` },
		});
		expect(updated.status()).toBe(200);
	}
	await openTemplate(page, input.name);
	const rows = versions(page).getByRole("button", { name: /^查看模版版本 v/ });
	const pagination = drawer(page).getByRole("navigation", { name: "模版版本分页", exact: true });
	await expect(rows).toHaveCount(20);
	await expect(selectVersion(page, 21)).toContainText("当前版本");
	await expect(selectVersion(page, 21)).toHaveAttribute("aria-pressed", "true");
	await selectVersion(page, 2).scrollIntoViewIfNeeded();
	await expect(selectVersion(page, 21)).not.toBeInViewport();
	await selectVersion(page, 2).click();
	await expect(drawer(page)).toHaveCount(0);
	await expect(detail(page).getByRole("heading", { name: input.name, exact: true })).toBeInViewport();
	await expect(detail(page).getByText("模版版本：v2", { exact: true })).toBeVisible();
	await expect(
		detail(page).getByRole("region", { name: "展示配置", exact: true }).getByText("配置版本 2", { exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "版本管理", exact: true }).click();
	await expect(rows).toHaveCount(20);
	await expect(pagination).toContainText("第 1 页");
	await expect(selectVersion(page, 2)).toHaveAttribute("aria-pressed", "true");
	await expect(selectVersion(page, 21)).toHaveAttribute("aria-pressed", "false");
	await expect(selectVersion(page, 21)).toContainText("当前版本");
	await pagination.getByRole("button", { name: "下一页", exact: true }).click();
	await expect(rows).toHaveCount(1);
	await expect(pagination).toContainText("第 2 页");
	await selectVersion(page, 1).click();
	await expect(drawer(page)).toHaveCount(0);
	await expect(detail(page).getByText("模版版本：v1", { exact: true })).toBeVisible();
	await expect(
		detail(page).getByRole("region", { name: "展示配置", exact: true }).getByText("配置版本 1", { exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "版本管理", exact: true }).click();
	await expect(rows).toHaveCount(20);
	await expect(pagination).toContainText("第 1 页");
	await expect(versions(page).getByRole("button", { name: /^查看模版版本 v/, pressed: true })).toHaveCount(0);
	await pagination.getByRole("button", { name: "下一页", exact: true }).click();
	await expect(rows).toHaveCount(1);
	await expect(pagination).toContainText("第 2 页");
	await expect(selectVersion(page, 1)).toHaveAttribute("aria-pressed", "true");
	await drawer(page).getByRole("button", { name: "关闭版本管理", exact: true }).click();
	await page.getByRole("button", { name: "版本管理", exact: true }).click();
	await expect(rows).toHaveCount(20);
	await expect(pagination).toContainText("第 1 页");
	await expect(selectVersion(page, 21)).toContainText("当前版本");
});
