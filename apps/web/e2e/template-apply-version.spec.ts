import {
	type CatalogAgentView,
	PLAZA_CATEGORY_LABELS,
	type TemplateCreateInput,
	type TemplateView,
} from "@openagentpack/kit-sdk/protocol";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";

const apiBase = process.env.KIT_E2E_API_URL ?? "http://localhost:8787";
const templatesUrl = `${apiBase}/api/admin/templates`;
const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };
const detail = (page: Page) => page.getByRole("region", { name: "模版详情", exact: true });
const apply = (page: Page) => detail(page).getByRole("button", { name: "应用此版本", exact: true });
const confirmation = (page: Page) => page.getByRole("alertdialog", { name: "确认应用此版本", exact: true });
const drawer = (page: Page) => page.getByRole("dialog", { name: "版本管理", exact: true });

async function seedVersions(request: APIRequestContext) {
	const prefix = `应用历史-${Date.now()}`;
	const uploaded = await request.post(`${apiBase}/api/kit/files`, {
		multipart: { file: { name: `${prefix}.txt`, mimeType: "text/plain", buffer: Buffer.from("初版资料") } },
	});
	expect(uploaded.status()).toBe(201);
	const { data: file } = await uploaded.json();
	const initial: TemplateCreateInput = {
		name: `${prefix}-初稿`,
		category: "writing",
		remote_agent_id: "agent_mock_designer",
		agent_version: 1,
		remote_environment_id: "env_mock_default",
		files: [{ file_id: file.file_id, mount_path: "/mnt/session/uploads/original.txt" }],
		memory_stores: [{ memory_store_id: "memory-guide", access: "read_only", instructions: "初版说明" }],
		vault_ids: ["vlt_mock_1"],
		description: "应用前的初版描述",
		opening_remarks: "初版开场白",
		suggested_prompts: ["初版问题"],
	};
	const created = await request.post(templatesUrl, { headers, data: initial });
	expect(created.status()).toBe(201);
	const first = ((await created.json()) as { data: TemplateView }).data;
	const currentInput = {
		...initial,
		name: `${prefix}-定稿`,
		category: "data",
		agent_version: 3,
		remote_environment_id: "env_mock_analysis",
		files: [],
		memory_stores: [],
		vault_ids: [],
		description: "当前定稿描述",
		opening_remarks: "定稿开场白",
		suggested_prompts: ["定稿问题"],
	};
	const updated = await request.put(`${templatesUrl}/${first.template_id}`, {
		headers,
		data: { ...currentInput, base_version: first.version },
	});
	expect(updated.status()).toBe(200);
	return { first, current: ((await updated.json()) as { data: TemplateView }).data, initial, currentInput };
}

async function seedListing(request: APIRequestContext, template: TemplateView): Promise<CatalogAgentView> {
	const url = `${templatesUrl}/${template.template_id}/listing`;
	const input = { display_name: template.name };
	const planned = await request.post(`${url}/plan`, { headers, data: input });
	expect(planned.status()).toBe(200);
	const { data: plan } = await planned.json();
	const listed = await request.post(url, {
		headers,
		data: { ...input, plan_id: plan.plan_id, confirm_token: plan.confirm_token },
	});
	expect(listed.status()).toBe(200);
	return (await listed.json()).data;
}

async function openTemplate(page: Page, template: TemplateView, authenticated = false) {
	const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.searchParams.set("api", apiBase);
	await page.goto(url.href);
	if (!authenticated) {
		await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
		await page.getByRole("button", { name: "进入", exact: true }).click();
	}
	await openConsoleNavigation(page);
	await page.getByTestId("template-list-tab").click();
	const list = page.getByRole("region", { name: "模版列表", exact: true });
	await list.getByRole("searchbox", { name: "搜索模版", exact: true }).fill(template.name);
	await list.getByRole("button", { name: `查看模版 ${template.name}`, exact: true }).click();
	await expect(detail(page).getByText(`模版版本：v${template.version}`, { exact: true })).toBeVisible();
}

async function chooseVersion(page: Page, version: number) {
	await detail(page).getByRole("button", { name: "版本管理", exact: true }).click();
	await drawer(page)
		.getByRole("button", { name: `查看模版版本 v${version}`, exact: true })
		.click();
	await expect(drawer(page)).toHaveCount(0);
	await expect(detail(page).getByText(`模版版本：v${version}`, { exact: true })).toBeVisible();
	await expect(detail(page).getByRole("region", { name: "展示配置", exact: true })).toBeVisible();
}

async function readTemplate(request: APIRequestContext, id: string): Promise<TemplateView> {
	const response = await request.get(`${templatesUrl}/${id}`, { headers });
	expect(response.status()).toBe(200);
	return (await response.json()).data;
}

// 保护历史详情→显式确认→新版本：取消不写，忙碌不能切走，目录同步且历史保持不变。
test("应用模版版本：当前版无入口，确认历史配置生成新版并同步已上架条目", async ({ page, request }) => {
	const { first, current, initial } = await seedVersions(request);
	const entry = await seedListing(request, current);
	expect(entry.category).toBe("data");
	const url = `${templatesUrl}/${first.template_id}`;
	const updates: Record<string, unknown>[] = [];
	const gate = Promise.withResolvers<void>();
	await page.route(url, async (route) => {
		if (route.request().method() === "PUT") {
			updates.push(route.request().postDataJSON());
			await gate.promise;
		}
		await route.continue();
	});
	try {
		await openTemplate(page, current);
		await expect(apply(page)).toHaveCount(0);
		await chooseVersion(page, 2);
		await expect(apply(page)).toHaveCount(0);
		await chooseVersion(page, 1);
		await expect(
			detail(page)
				.getByRole("region", { name: "展示配置", exact: true })
				.getByText(PLAZA_CATEGORY_LABELS.writing, { exact: true }),
		).toBeVisible();
		await expect(apply(page)).toBeEnabled();
		await apply(page).click();
		await expect(confirmation(page)).toContainText("应用后会自动生效，是否确认？");
		expect(updates).toHaveLength(0);
		await confirmation(page).getByRole("button", { name: "取消", exact: true }).click();
		await expect(confirmation(page)).toHaveCount(0);
		expect(updates).toHaveLength(0);
		await apply(page).click();
		await confirmation(page).getByRole("button", { name: "确认应用", exact: true }).click();
		await expect.poll(() => updates.length).toBe(1);
		await expect(confirmation(page).getByRole("button", { name: "取消", exact: true })).toBeDisabled();
		for (const name of ["版本管理", "返回模版列表"]) {
			await expect(page.getByRole("button", { name, exact: true, includeHidden: true })).toBeDisabled();
		}
		await expect(page.getByTestId("template-create-tab")).toBeDisabled();
		await page.keyboard.press("Escape");
		await expect(confirmation(page)).toBeVisible();
	} finally {
		gate.resolve();
	}
	await expect(confirmation(page)).toHaveCount(0);
	await expect(detail(page).getByText("模版版本：v3", { exact: true })).toBeVisible();
	await expect(detail(page).getByRole("heading", { name: first.name, exact: true })).toBeVisible();
	await expect(apply(page)).toHaveCount(0);
	expect(updates).toHaveLength(1);
	expect(updates[0]).toMatchObject({ ...initial, base_version: 2 });
	const latest = await readTemplate(request, first.template_id);
	expect(latest).toMatchObject({ ...initial, version: 3, listing: { catalog_id: entry.id, status: "listed" } });
	const entries = (
		(await (await request.get(`${apiBase}/api/admin/agents`, { headers })).json()) as {
			data: CatalogAgentView[];
		}
	).data;
	expect(entries.find((item) => item.id === entry.id)).toMatchObject({
		id: entry.id,
		slug: entry.slug,
		status: "listed",
		category: "writing",
		display_name: first.name,
		agent_version: 1,
		remote_environment_id: initial.remote_environment_id,
		files: latest.files,
		memory_stores: initial.memory_stores,
		vault_ids: initial.vault_ids,
		description: initial.description,
		opening_remarks: initial.opening_remarks,
		suggested_prompts: initial.suggested_prompts,
	});
	const history = await request.get(`${url}/versions/2`, { headers });
	expect((await history.json()).data).toMatchObject({
		version: 2,
		name: current.name,
		category: "data",
		description: current.description,
	});
	await detail(page).getByRole("button", { name: "版本管理", exact: true }).click();
	await expect(drawer(page).getByRole("button", { name: "查看模版版本 v3", exact: true })).toContainText("当前版本");
	await expect(drawer(page).getByRole("button", { name: "查看模版版本 v1", exact: true })).not.toContainText(
		"当前版本",
	);
});

// 保护失败恢复与并发拒绝：失败保留所选版本，重试仍确认，冲突后不能自动换基线覆盖。
test("应用模版版本：窄屏失败保留选择，重试需确认，并发冲突保留新配置", async ({ page, request }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const { first, current, currentInput } = await seedVersions(request);
	const url = `${templatesUrl}/${first.template_id}`;
	const updates: Record<string, unknown>[] = [];
	await page.route(url, async (route) => {
		if (route.request().method() !== "PUT") return route.continue();
		updates.push(route.request().postDataJSON());
		if (updates.length === 1) {
			return route.fulfill({ status: 503, json: { error: { code: "provider_error", message: "应用暂不可用" } } });
		}
		return route.continue();
	});
	await openTemplate(page, current);
	await chooseVersion(page, 1);
	await apply(page).click();
	await confirmation(page).getByRole("button", { name: "确认应用", exact: true }).click();
	await expect(confirmation(page)).toHaveCount(0);
	await expect(detail(page).getByRole("alert")).toContainText("应用暂不可用");
	await expect(detail(page).getByText("模版版本：v1", { exact: true })).toBeVisible();
	expect((await readTemplate(request, first.template_id)).version).toBe(2);
	const changed = await request.put(url, {
		headers,
		data: { ...currentInput, base_version: 2, description: "其他管理员的变更" },
	});
	expect(changed.status()).toBe(200);
	const newer = ((await changed.json()) as { data: TemplateView }).data;
	await apply(page).click();
	await expect(confirmation(page)).toBeVisible();
	expect(updates).toHaveLength(1);
	await confirmation(page).getByRole("button", { name: "确认应用", exact: true }).click();
	await expect(confirmation(page)).toHaveCount(0);
	await expect(detail(page).getByRole("alert")).toContainText("模版已有新版本");
	expect(updates).toHaveLength(2);
	expect(updates.map((input) => input.base_version)).toEqual([2, 2]);
	expect(await readTemplate(request, first.template_id)).toMatchObject({ version: 3, description: "其他管理员的变更" });
	await expect(detail(page).getByText("模版版本：v1", { exact: true })).toBeVisible();
	await openTemplate(page, newer, true);
	await chooseVersion(page, 1);
	await apply(page).click();
	await confirmation(page).getByRole("button", { name: "确认应用", exact: true }).click();
	await expect(confirmation(page)).toHaveCount(0);
	await expect(detail(page).getByText("模版版本：v4", { exact: true })).toBeVisible();
	expect(updates).toHaveLength(3);
	expect(updates[2]?.base_version).toBe(3);
	expect(await readTemplate(request, first.template_id)).toMatchObject({
		description: first.description,
		category: "writing",
	});
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
