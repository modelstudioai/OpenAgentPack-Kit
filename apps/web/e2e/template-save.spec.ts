import { PLAZA_CATEGORY_LABELS, type TemplateCreateInput, type TemplateView } from "@openagentpack/kit-sdk/protocol";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";
import { confirmTemplateAgentSelection, openTemplateAgentPicker } from "./template-agent-selection-helpers.ts";
import { openInlinePicker, selectInlineEnvironment } from "./template-inline-helpers.ts";
import { openTemplateSaveDialog } from "./template-publish-helpers.ts";

const apiBase = process.env.KIT_E2E_API_URL ?? "http://localhost:8787";
const templatesUrl = `${apiBase}/api/admin/templates`;
const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };
const list = (page: Page) => page.getByRole("region", { name: "模版列表", exact: true });
const detail = (page: Page) => page.getByRole("region", { name: "模版详情", exact: true });
const dialog = (page: Page) => page.getByRole("dialog", { name: "保存智能体", exact: true });

async function login(page: Page, token = ADMIN_TOKEN) {
	const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.searchParams.set("api", apiBase);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(token);
	await page.getByRole("button", { name: "进入", exact: true }).click();
}

async function chooseRuntime(page: Page, agent: "assistant" | "designer" = "assistant") {
	await openConsoleNavigation(page);
	await page.getByTestId("template-create-tab").click();
	await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
	await openTemplateAgentPicker(page);
	const row = page.getByRole("listitem").filter({
		has: page.getByRole("button", { name: `选择智能体 ${agent}（agent_mock_${agent}）`, exact: true }),
	});
	await expect(row.getByText(agent === "designer" ? "v3" : "v1", { exact: true })).toBeVisible();
	await expect(row.getByText("最新版本", { exact: true })).toHaveCount(0);
	await openTemplateAgentPicker(page);
	await page.getByRole("button", { name: `选择智能体 ${agent}（agent_mock_${agent}）`, exact: true }).click();
	await confirmTemplateAgentSelection(page);
	await selectInlineEnvironment(page, "选择环境 默认环境（env_mock_default）");
}

async function openList(page: Page) {
	await openConsoleNavigation(page);
	await page.getByTestId("template-list-tab").click();
	await expect(list(page)).toBeVisible();
}

async function search(page: Page, value: string) {
	const response = page.waitForResponse((response) => {
		const url = new URL(response.url());
		return url.pathname.endsWith("/api/admin/templates") && (url.searchParams.get("search") ?? "") === value.trim();
	});
	const field = list(page).getByRole("searchbox", { name: "搜索模版", exact: true });
	await field.fill(value);
	await response;
}

async function selectResource(page: Page, sectionName: string, label: string, id: string) {
	const picker = await openInlinePicker(page, sectionName);
	await picker.getByRole("searchbox", { name: `搜索${label}`, exact: true }).fill(id);
	await picker
		.getByRole("list", { name: `${label}列表`, exact: true })
		.getByRole("button", { name: new RegExp(`^选择${label} `) })
		.click();
	await picker.getByRole("button", { name: "确认选择", exact: true }).click();
	await expect(picker).toHaveCount(0);
}

async function seedTemplate(request: APIRequestContext, name: string): Promise<TemplateView> {
	const response = await request.post(templatesUrl, {
		headers,
		data: {
			name,
			category: "general",
			remote_agent_id: "agent_mock_assistant",
			remote_environment_id: "env_mock_default",
		},
	});
	expect(response.status()).toBe(201);
	return (await response.json()).data;
}

// 保护向导保存到持久目录的完整流程；不重复 Provider 资源映射和数据库迁移合同。
test("保存模版：默认最新具体版本用于保存，完整配置预览调试后保存并刷新保留", async ({ page, request }) => {
	const name = `完整模版-${Date.now()}`;
	const filename = `${name}.txt`;
	const uploaded = await request.post(`${apiBase}/api/kit/files`, {
		multipart: { file: { name: filename, mimeType: "text/plain", buffer: Buffer.from("模版运行资料") } },
	});
	expect(uploaded.status()).toBe(201);
	const { data: file } = (await uploaded.json()) as { data: { file_id: string } };
	const debugRequests: Record<string, unknown>[] = [];
	const saves: TemplateCreateInput[] = [];
	page.on("request", (outgoing) => {
		if (outgoing.method() !== "POST") return;
		if (outgoing.url() === `${apiBase}/api/admin/debug/sessions`) debugRequests.push(outgoing.postDataJSON());
		if (outgoing.url() === templatesUrl) saves.push(outgoing.postDataJSON());
	});
	await login(page);
	await chooseRuntime(page, "designer");
	const category = page.getByRole("combobox", { name: "分类", exact: true });
	await expect(category).toHaveJSProperty("required", true);
	await expect(category).toHaveValue("general");
	await expect(category.getByRole("option")).toHaveText(Object.values(PLAZA_CATEGORY_LABELS));
	for (const [value, label] of Object.entries(PLAZA_CATEGORY_LABELS)) {
		await expect(category.getByRole("option", { name: label, exact: true })).toHaveAttribute("value", value);
	}
	await category.selectOption("writing");
	await selectResource(page, "文件", "文件", file.file_id);
	await selectResource(page, "记忆库", "记忆库", "memory-guide");
	const memories = page.getByRole("region", { name: "记忆库", exact: true });
	await memories.getByRole("combobox", { name: "权限", exact: true }).selectOption("read_only");
	await memories.getByRole("textbox", { name: "说明", exact: true }).fill("  按项目资料检索  ");
	await selectResource(page, "密钥库", "密钥库", "vlt_mock_11");
	const presentation = page.getByRole("region", { name: "展示配置", exact: true });
	const configName = presentation.getByRole("textbox", { name: "智能体名称", exact: true });
	await expect(configName).toHaveValue("");
	await expect(
		page
			.locator('footer[aria-label="模版配置操作"]')
			.getByRole("button", { name: /^(下一步：预览调试|保存智能体|保存修改)$/, includeHidden: true }),
	).toBeDisabled();
	await expect(configName).toHaveJSProperty("required", true);
	await expect(configName).toHaveAttribute("maxlength", "64");
	await configName.fill(`${name}-草稿`);
	await presentation.getByRole("textbox", { name: "描述", exact: true }).fill("  保存后的展示描述  ");
	await presentation
		.getByRole("textbox", { name: "开场白", exact: true })
		.fill("  你好，欢迎使用保存的模版\n请告诉我你的任务  ");
	await presentation
		.getByRole("textbox", { name: "示例问题（每行一条）", exact: true })
		.fill("  总结项目进展  \n\n  查找项目资料  ");
	await expect(page.getByRole("button", { name: /^第 \d 步：/ })).toHaveCount(2);
	await configName.fill(`  ${name}  `);
	await category.selectOption("coding");
	await openTemplateSaveDialog(page);
	expect(debugRequests).toHaveLength(1);
	expect(debugRequests[0]).toMatchObject({
		remote_agent_id: "agent_mock_designer",
		agent_version: 3,
		remote_environment_id: "env_mock_default",
		files: [{ file_id: file.file_id, mount_path: `/mnt/session/uploads/${filename}` }],
		memory_stores: [{ memory_store_id: "memory-guide", access: "read_only", instructions: "按项目资料检索" }],
		vault_ids: ["vlt_mock_11"],
	});
	await expect(dialog(page).getByRole("textbox", { name: "智能体名称", exact: true })).toHaveValue(`  ${name}  `);
	const responsePromise = page.waitForResponse(
		(response) => response.url() === templatesUrl && response.status() === 201,
	);
	await dialog(page).getByRole("button", { name: "保存", exact: true }).click();
	const { data: saved } = (await (await responsePromise).json()) as { data: TemplateView };
	await expect(list(page)).toBeVisible();
	await expect(dialog(page)).toHaveCount(0);
	await expect(list(page).getByRole("status").filter({ hasText: name })).toBeVisible();
	expect(saves).toHaveLength(1);
	expect(saves[0]).toMatchObject({
		name,
		category: "coding",
		remote_agent_id: "agent_mock_designer",
		agent_version: 3,
		remote_environment_id: "env_mock_default",
		files: [{ file_id: file.file_id }],
		memory_stores: [{ memory_store_id: "memory-guide", access: "read_only", instructions: "按项目资料检索" }],
		vault_ids: ["vlt_mock_11"],
		description: "保存后的展示描述",
		opening_remarks: "你好，欢迎使用保存的模版\n请告诉我你的任务",
		suggested_prompts: ["总结项目进展", "查找项目资料"],
	});
	expect(saved).toMatchObject({ category: "coding", agent_version: 3, remote_agent_version: 3 });
	await expect(list(page).getByRole("row").filter({ hasText: name })).toContainText("（版本：v3）");
	await list(page)
		.getByRole("button", { name: `查看模版 ${name}`, exact: true })
		.click();
	await expect(detail(page)).toContainText(saved.template_id);
	await expect(
		detail(page)
			.getByRole("region", { name: "基础配置", exact: true })
			.getByRole("region", { name: "版本", exact: true }),
	).toContainText("v3");
	await expect(detail(page).getByRole("region", { name: "基础配置", exact: true })).not.toContainText("最新版本");
	await page.reload();
	await openList(page);
	await search(page, name);
	await list(page)
		.getByRole("button", { name: `查看模版 ${name}`, exact: true })
		.click();
	for (const text of [
		name,
		"designer",
		"agent_mock_designer",
		"默认环境",
		"env_mock_default",
		filename,
		file.file_id,
		"memory-guide",
		"只读",
		"按项目资料检索",
		"vlt_mock_11",
		"保存后的展示描述",
		"你好，欢迎使用保存的模版",
		"请告诉我你的任务",
		"总结项目进展",
		"查找项目资料",
	]) {
		await expect(detail(page)).toContainText(text);
	}
	await expect(
		detail(page)
			.getByRole("region", { name: "展示配置", exact: true })
			.getByText(PLAZA_CATEGORY_LABELS.coding, { exact: true }),
	).toBeVisible();
	await detail(page).getByRole("button", { name: "版本管理", exact: true }).click();
	const versions = page.getByRole("dialog", { name: "版本管理", exact: true });
	await expect(versions).toBeVisible();
	await versions.getByRole("button", { name: "关闭版本管理", exact: true }).click();
	await expect(versions).toBeHidden();
	await expect(detail(page)).toContainText("保存后的展示描述");
	await expect(detail(page)).toContainText(file.file_id);
	expect(debugRequests).toHaveLength(1);
	const persisted = await request.get(`${templatesUrl}/${saved.template_id}`, { headers });
	expect((await persisted.json()).data).toMatchObject({ agent_version: 3, category: "coding" });
});

// 保护失败可恢复与写入单飞：不吞草稿、不重复提交，忙碌时不能切走另一个配置。
test("保存模版：窄屏失败和重名保留草稿，改名重试成功，保存中锁定导航", async ({ page, request }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const name = `重试模版-${Date.now()}`;
	await seedTemplate(request, name);
	let attempts = 0;
	const saveGate = Promise.withResolvers<void>();
	await page.route(templatesUrl, async (route) => {
		if (route.request().method() !== "POST") return route.continue();
		attempts += 1;
		if (attempts === 1) {
			return route.fulfill({
				status: 503,
				json: { error: { code: "provider_error", message: "保存暂不可用，请重试" } },
			});
		}
		if (attempts === 3) await saveGate.promise;
		return route.continue();
	});
	await login(page);
	await chooseRuntime(page);
	const presentation = page.getByRole("region", { name: "展示配置", exact: true });
	const configName = presentation.getByRole("textbox", { name: "智能体名称", exact: true });
	await configName.fill(name);
	await presentation.getByRole("textbox", { name: "描述", exact: true }).fill("失败后仍保留的描述");
	await openTemplateSaveDialog(page);
	const nameField = dialog(page).getByRole("textbox", { name: "智能体名称", exact: true });
	const save = dialog(page).getByRole("button", { name: "保存", exact: true });
	await expect(nameField).toHaveValue(name);
	await nameField.fill("");
	await expect(save).toBeDisabled();
	await dialog(page).getByRole("button", { name: "取消", exact: true }).click();
	await expect(configName).toBeFocused();
	await expect(
		page
			.locator('footer[aria-label="模版配置操作"]')
			.getByRole("button", { name: /^(下一步：预览调试|保存智能体|保存修改)$/ }),
	).toBeDisabled();
	await configName.fill(name);
	await openTemplateSaveDialog(page);
	await save.click();
	await expect(dialog(page).getByRole("alert")).toContainText("保存暂不可用，请重试");
	await expect(nameField).toHaveValue(name);
	await expect(save).toBeEnabled();
	const conflict = page.waitForResponse((response) => response.url() === templatesUrl && response.status() === 409);
	await save.click();
	await conflict;
	await expect(dialog(page).getByRole("alert")).toContainText("名称");
	await expect(nameField).toHaveValue(name);
	const renamed = `${name}-新名称`;
	await nameField.fill(renamed);
	await dialog(page).getByRole("button", { name: "取消", exact: true }).click();
	await expect(
		page
			.locator('footer[aria-label="模版配置操作"]')
			.getByRole("button", { name: /^(下一步：预览调试|保存智能体|保存修改)$/ }),
	).toBeFocused();
	await page.getByRole("button", { name: "上一步：选择配置", exact: true }).click();
	await expect(configName).toHaveValue(renamed);
	await expect(presentation.getByRole("textbox", { name: "描述", exact: true })).toHaveValue("失败后仍保留的描述");
	await openTemplateSaveDialog(page);
	await expect(nameField).toHaveValue(renamed);
	await save.click();
	try {
		await expect(dialog(page).getByRole("button", { name: "保存中…", exact: true })).toBeDisabled();
		await expect(dialog(page).getByRole("button", { name: "取消", exact: true })).toBeDisabled();
		await expect(
			page
				.locator('footer[aria-label="模版配置操作"]')
				.getByRole("button", { name: /^(下一步：预览调试|保存智能体|保存修改)$/, includeHidden: true }),
		).toBeDisabled();
		await page.keyboard.press("Escape");
		await expect(dialog(page)).toBeVisible();
		expect(attempts).toBe(3);
	} finally {
		saveGate.resolve();
	}
	await expect(list(page)).toBeVisible();
	await list(page)
		.getByRole("button", { name: `查看模版 ${renamed}`, exact: true })
		.click();
	await expect(detail(page)).toContainText("失败后仍保留的描述");
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await detail(page).getByRole("button", { name: "版本管理", exact: true }).click();
	const versions = page.getByRole("dialog", { name: "版本管理", exact: true });
	await expect(versions).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await versions.getByRole("button", { name: "关闭版本管理", exact: true }).click();
	await expect(versions).toBeHidden();
	await expect(detail(page)).toContainText("失败后仍保留的描述");
});

// 先创建真实目录资源，再验证审计员可读但不可写；搜索分页验证真实游标接线。
test("模版列表：auditor 可搜索分页和查看已存配置，不能保存新模版", async ({ page, request }) => {
	const prefix = `只读分页-${Date.now()}`;
	const records: TemplateView[] = [];
	for (let index = 0; index < 21; index++) records.push(await seedTemplate(request, `${prefix}-${index}`));
	const writes: string[] = [];
	page.on("request", (outgoing) => {
		if (outgoing.url().includes("/api/admin/") && outgoing.method() === "POST") writes.push(outgoing.url());
	});
	await login(page, "e2e-auditor");
	await openList(page);
	await search(page, prefix);
	const rowButtons = list(page).getByRole("button", { name: /^查看模版 / });
	const pagination = page.getByRole("navigation", { name: "模版列表分页", exact: true });
	await expect(rowButtons).toHaveCount(20);
	await pagination.getByRole("button", { name: "下一页", exact: true }).click();
	await expect(rowButtons).toHaveCount(1);
	await pagination.getByRole("button", { name: "上一页", exact: true }).click();
	await expect(rowButtons).toHaveCount(20);
	const first = records[0]!;
	await search(page, first.name);
	await expect(rowButtons).toHaveCount(1);
	await expect(list(page).getByRole("row").filter({ hasText: first.name })).toContainText("（版本：v1）");
	await rowButtons.click();
	await expect(detail(page)).toContainText(first.template_id);
	await expect(detail(page)).toContainText("agent_mock_assistant");
	await expect(
		detail(page)
			.getByRole("region", { name: "基础配置", exact: true })
			.getByRole("region", { name: "版本", exact: true }),
	).toContainText("v1");
	await expect(detail(page).getByRole("region", { name: "基础配置", exact: true })).not.toContainText("最新版本");
	await page.getByRole("button", { name: "返回模版列表", exact: true }).click();
	await search(page, `${prefix}-不存在`);
	await expect(rowButtons).toHaveCount(0);
	await chooseRuntime(page);
	await page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true })
		.fill(`${prefix}-只读草稿`);
	await expect(page.getByRole("button", { name: "下一步：预览调试", exact: true })).toBeDisabled();
	await expect(page.getByText("当前身份只读", { exact: false })).toBeVisible();
	expect(writes).toEqual([]);
});
