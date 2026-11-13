import type {
	AttachmentRef,
	CatalogAgentView,
	ResourceDraftView,
	TemplateCreateInput,
	TemplateView,
} from "@openagentpack/kit-sdk/protocol";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";
import { openTemplateSaveDialog } from "./template-publish-helpers.ts";

const apiBase = process.env.KIT_E2E_API_URL ?? "http://localhost:8787";
const templatesUrl = `${apiBase}/api/admin/templates`;
const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };
const list = (page: Page) => page.getByRole("region", { name: "模版列表", exact: true });
const saveDialog = (page: Page) => page.getByRole("dialog", { name: "保存修改", exact: true });
const confirmation = (page: Page) => page.getByRole("dialog", { name: "确认保存修改", exact: true });

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
	const search = list(page).getByRole("searchbox", { name: "搜索模版", exact: true });
	await search.fill(name);
	await expect(list(page).getByRole("button", { name: `查看模版 ${name}`, exact: true })).toBeVisible();
}

async function seedTemplate(request: APIRequestContext, input: Partial<TemplateCreateInput> & { name: string }) {
	const response = await request.post(templatesUrl, {
		headers,
		data: {
			category: "general",
			remote_agent_id: "agent_mock_assistant",
			remote_environment_id: "env_mock_default",
			...input,
		},
	});
	expect(response.status()).toBe(201);
	return ((await response.json()) as { data: TemplateView }).data;
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
	expect(listed.ok()).toBeTruthy();
	return (await listed.json()).data;
}

async function upload(request: APIRequestContext, filename: string): Promise<AttachmentRef> {
	const response = await request.post(`${apiBase}/api/kit/files`, {
		multipart: { file: { name: filename, mimeType: "text/plain", buffer: Buffer.from("版本化项目资料") } },
	});
	expect(response.status()).toBe(201);
	return (await response.json()).data;
}

async function selectFile(page: Page, fileId: string) {
	const section = page.getByRole("region", { name: "文件", exact: true });
	await section.getByRole("button", { name: "导入现有配置", exact: true }).click();
	const picker = page.getByRole("dialog", { name: "选择配置", exact: true });
	const search = picker.getByRole("searchbox", { name: "搜索文件", exact: true });
	await search.fill(fileId);
	await picker.getByRole("list", { name: "文件列表", exact: true }).getByRole("button").click();
	await picker.getByRole("button", { name: "确认选择", exact: true }).click();
}

async function openEditor(page: Page, name: string) {
	await list(page)
		.getByRole("button", { name: `编辑模版 ${name}`, exact: true })
		.click();
	await expect(page.getByRole("heading", { name: "编辑智能体", exact: true })).toBeVisible();
	await expect(page.getByRole("navigation", { name: "编辑模版步骤", exact: true }).getByRole("button")).toHaveCount(2);
}

async function openSave(page: Page) {
	await openTemplateSaveDialog(page);
	await expect(saveDialog(page)).toBeVisible();
}

async function createSession(request: APIRequestContext, slug: string, sessions: string[]) {
	const response = await request.post(`${apiBase}/api/kit/sessions`, { data: { agent_slug: slug } });
	expect(response.status()).toBe(201);
	const { data } = (await response.json()) as { data: { session_id: string; files: AttachmentRef[] } };
	sessions.push(data.session_id);
	return data;
}

/** 仅删除本用例的隔离 Mock 会话，沿用正式确认合同。 */
async function cleanupSessions(request: APIRequestContext, sessions: string[]) {
	for (const id of sessions) {
		const url = `${apiBase}/api/kit/sessions/${id}`;
		const response = await request.post(`${url}/plan`, { data: { action: "delete" } });
		expect(response.ok()).toBeTruthy();
		const { data: plan } = await response.json();
		const deleted = await request.delete(url, { data: { plan_id: plan.plan_id, confirm_token: plan.confirm_token } });
		expect(deleted.ok()).toBeTruthy();
	}
}

// 保护编辑预填→取消不提交→确认保存新版本→已上架条目同步；新增文件不得抢占原文件路径。
test("编辑模版：预填完整配置，保存递增版本并同步已上架条目，新会话使用新版", async ({ page, request }) => {
	const name = `编辑版本-${Date.now()}`;
	const [original, added] = await Promise.all([
		upload(request, `${name}-原文件.txt`),
		upload(request, `${name}-新增.txt`),
	]);
	const mountPath = `/mnt/session/uploads/${name}-新增.txt`;
	const addedMountPath = `/mnt/session/uploads/${name}-新增-2.txt`;
	const saved = await seedTemplate(request, {
		name,
		category: "writing",
		remote_agent_id: "agent_mock_designer",
		agent_version: 1,
		files: [{ file_id: original.file_id, mount_path: mountPath }],
		memory_stores: [{ memory_store_id: "memory-guide", access: "read_only", instructions: "原版本资料说明" }],
		vault_ids: ["vlt_mock_1"],
		description: "原版本描述",
		opening_remarks: "原版本开场白",
		suggested_prompts: ["原版本示例问题"],
	});
	expect(saved.version).toBe(1);
	const entry = await seedListing(request, saved);
	const sessions: string[] = [];
	const updates: Record<string, unknown>[] = [];
	const saveGate = Promise.withResolvers<void>();
	await page.route(`${templatesUrl}/${saved.template_id}`, async (route) => {
		if (route.request().method() === "PUT") await saveGate.promise;
		return route.continue();
	});
	page.on("request", (outgoing) => {
		if (outgoing.method() === "PUT" && outgoing.url() === `${templatesUrl}/${saved.template_id}`) {
			updates.push(outgoing.postDataJSON());
		}
	});
	try {
		const oldSession = await createSession(request, entry.slug, sessions);
		expect(oldSession.files).toEqual([expect.objectContaining({ file_id: original.file_id, mount_path: mountPath })]);
		await login(page);
		await openList(page, name);
		await openEditor(page, name);
		const category = page.getByRole("combobox", { name: "分类", exact: true });
		await expect(category).toHaveValue("writing");
		const summary = page.getByRole("region", { name: "已选配置预览", exact: true });
		await expect(summary).toContainText(name);
		await expect(
			page.getByRole("region", { name: "基础配置", exact: true }).getByRole("region", { name: "版本", exact: true }),
		).toContainText("v1");
		const environment = page.getByRole("region", { name: "环境", exact: true });
		await expect(environment.getByRole("heading", { name: "默认环境", exact: true })).toBeVisible();
		await expect(environment).toContainText("可直接使用原环境");
		await expect(page.getByRole("region", { name: "文件", exact: true })).toContainText(original.filename!);
		const memory = page.getByRole("region", { name: "记忆库", exact: true });
		await expect(memory.getByRole("combobox", { name: "权限", exact: true })).toHaveValue("read_only");
		await expect(memory.getByRole("textbox", { name: "说明", exact: true })).toHaveValue("原版本资料说明");
		const vault = page.getByRole("region", { name: "密钥库", exact: true });
		await expect(vault.getByRole("textbox", { name: "密钥库名称", exact: true })).not.toHaveValue("vlt_mock_1");
		await expect(vault.getByRole("region", { name: "密钥配置", exact: true })).toBeVisible();
		const presentation = page.getByRole("region", { name: "展示配置", exact: true });
		const configName = presentation.getByRole("textbox", { name: "智能体名称", exact: true });
		await expect(configName).toHaveValue(name);
		await expect(presentation.getByRole("textbox", { name: "描述", exact: true })).toHaveValue("原版本描述");
		await expect(presentation.getByRole("textbox", { name: "开场白", exact: true })).toHaveValue("原版本开场白");
		await expect(presentation.getByRole("textbox", { name: "示例问题（每行一条）", exact: true })).toHaveValue(
			"原版本示例问题",
		);
		await environment.getByRole("button", { name: "导入现有配置", exact: true }).click();
		await page.getByRole("button", { name: "选择环境 数据分析环境（env_mock_analysis）", exact: true }).click();
		await page
			.getByRole("dialog", { name: "环境详情", exact: true })
			.getByRole("button", { name: "确认选择", exact: true })
			.click();
		await selectFile(page, added.file_id);
		await memory.getByRole("combobox", { name: "权限", exact: true }).selectOption("read_write");
		await memory.getByRole("textbox", { name: "说明", exact: true }).fill("新版资料读写说明");
		await vault.getByRole("button", { name: "清空", exact: true }).click();
		await presentation.getByRole("textbox", { name: "描述", exact: true }).fill("新版项目助手说明");
		await category.selectOption("data");
		await presentation.getByRole("textbox", { name: "开场白", exact: true }).fill("欢迎使用新版项目助手");
		await presentation
			.getByRole("textbox", { name: "示例问题（每行一条）", exact: true })
			.fill("总结新版资料\n检查更新进展");
		const renamed = `${name}-新版`;
		await configName.fill(renamed);
		await openSave(page);
		await expect(saveDialog(page).getByRole("textbox", { name: "智能体名称", exact: true })).toHaveValue(renamed);
		await saveDialog(page).getByRole("button", { name: "保存修改", exact: true }).click();
		await expect(confirmation(page)).toContainText("修改后会自动生效，是否确认？");
		expect(updates).toHaveLength(0);
		await confirmation(page).getByRole("button", { name: "取消", exact: true }).click();
		await expect(confirmation(page)).toHaveCount(0);
		await expect(saveDialog(page).getByRole("textbox", { name: "智能体名称", exact: true })).toHaveValue(renamed);
		expect(updates).toHaveLength(0);
		await saveDialog(page).getByRole("button", { name: "保存修改", exact: true }).click();
		await confirmation(page).getByRole("button", { name: "确认", exact: true }).click();
		try {
			await expect(confirmation(page).getByRole("button", { name: "保存中…", exact: true })).toBeDisabled();
			await expect(confirmation(page).getByRole("button", { name: "取消", exact: true })).toBeDisabled();
			await page.keyboard.press("Escape");
			await expect(confirmation(page)).toBeVisible();
			await expect.poll(() => updates.length).toBe(1);
		} finally {
			saveGate.resolve();
		}
		await expect(list(page)).toBeVisible();
		await expect(list(page).getByRole("button", { name: `编辑模版 ${renamed}`, exact: true })).toBeVisible();
		await expect(list(page).getByRole("columnheader", { name: /版本/ })).toHaveCount(0);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({
			base_version: 1,
			category: "data",
			agent_version: 1,
			files: [
				expect.objectContaining({ file_id: original.file_id, mount_path: mountPath }),
				expect.objectContaining({ file_id: added.file_id, mount_path: addedMountPath }),
			],
		});
		const latestResponse = await request.get(`${templatesUrl}/${saved.template_id}`, { headers });
		const { data: latest } = (await latestResponse.json()) as { data: TemplateView };
		expect(latest).toMatchObject({
			template_id: saved.template_id,
			name: renamed,
			version: 2,
			category: "data",
			agent_version: 1,
			remote_environment_id: "env_mock_analysis",
			vault_ids: [],
		});
		expect(latest.files[0]).toMatchObject({ file_id: original.file_id, mount_path: mountPath });
		expect(latest.files[1]).toMatchObject({ file_id: added.file_id, mount_path: addedMountPath });
		const catalogResponse = await request.get(`${apiBase}/api/admin/agents`, { headers });
		const entries = ((await catalogResponse.json()) as { data: CatalogAgentView[] }).data.filter(
			(item) => item.id === entry.id,
		);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			id: entry.id,
			slug: entry.slug,
			status: "listed",
			category: "data",
			agent_version: 1,
			display_name: renamed,
			remote_environment_id: latest.remote_environment_id,
			files: latest.files,
			memory_stores: latest.memory_stores,
			vault_ids: [],
		});
		const publicResponse = await request.get(`${apiBase}/api/kit/agents/${entry.slug}`);
		expect(publicResponse.status()).toBe(200);
		expect((await publicResponse.json()).data).toMatchObject({
			display_name: renamed,
			description: latest.description,
			opening_remarks: latest.opening_remarks,
			suggested_prompts: latest.suggested_prompts,
		});
		const newSession = await createSession(request, entry.slug, sessions);
		expect(newSession.files).toHaveLength(2);
		expect(newSession.files).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ file_id: original.file_id, mount_path: mountPath }),
				expect.objectContaining({ file_id: added.file_id, mount_path: addedMountPath }),
			]),
		);
		const oldReadback = await request.get(`${apiBase}/api/kit/sessions/${oldSession.session_id}`);
		expect((await oldReadback.json()).data.files).toHaveLength(1);
	} finally {
		saveGate.resolve();
		await cleanupSessions(request, sessions);
	}
});

// 保护乐观并发：旧编辑页遇到新版本时不覆盖、不重试，仍保留本地草稿；审计员没有编辑入口。
test("编辑模版：并发更新冲突保留草稿与服务端新版本，auditor 只读", async ({ page, request, browser }) => {
	const name = `编辑冲突-${Date.now()}`;
	const input: TemplateCreateInput = {
		name,
		category: "general",
		remote_agent_id: "agent_mock_assistant",
		remote_environment_id: "env_mock_default",
		description: "初始描述",
	};
	const saved = await seedTemplate(request, input);
	const url = `${templatesUrl}/${saved.template_id}`;
	const updates: Record<string, unknown>[] = [];
	page.on("request", (outgoing) => {
		if (outgoing.method() === "PUT" && outgoing.url() === url) updates.push(outgoing.postDataJSON());
	});
	await login(page);
	await openList(page, name);
	await openEditor(page, name);
	await expect(
		page.getByRole("region", { name: "基础配置", exact: true }).getByRole("region", { name: "版本", exact: true }),
	).toContainText("跟随最新版本");
	const description = page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "描述", exact: true });
	await description.fill("当前页面未保存的草稿");
	const concurrent = await request.put(url, {
		headers,
		data: { ...input, description: "另一个管理员保存的新版本", base_version: 1 },
	});
	expect(concurrent.status()).toBe(200);
	await openSave(page);
	const rejected = page.waitForResponse(
		(response) => response.url() === url && response.request().method() === "PUT" && response.status() === 409,
	);
	await saveDialog(page).getByRole("button", { name: "保存修改", exact: true }).click();
	await expect(confirmation(page)).toContainText("修改后会自动生效，是否确认？");
	await page.keyboard.press("Escape");
	await expect(confirmation(page)).toHaveCount(0);
	await expect(saveDialog(page).getByRole("textbox", { name: "智能体名称", exact: true })).toHaveValue(name);
	expect(updates).toHaveLength(0);
	await saveDialog(page).getByRole("button", { name: "保存修改", exact: true }).click();
	await confirmation(page).getByRole("button", { name: "确认", exact: true }).click();
	await rejected;
	await expect(confirmation(page)).toHaveCount(0);
	await expect(saveDialog(page).getByRole("alert")).toContainText("草稿已保留");
	await expect(saveDialog(page).getByRole("textbox", { name: "智能体名称", exact: true })).toHaveValue(name);
	expect(updates).toHaveLength(1);
	expect(updates[0]).toMatchObject({ base_version: 1, description: "当前页面未保存的草稿" });
	expect(updates[0]).not.toHaveProperty("agent_version");
	await saveDialog(page).getByRole("button", { name: "取消", exact: true }).click();
	await page.getByRole("button", { name: "上一步：选择配置", exact: true }).click();
	await expect(description).toHaveValue("当前页面未保存的草稿");
	await page.getByRole("button", { name: "返回模版列表", exact: true }).click();
	const current = await request.get(url, { headers });
	expect((await current.json()).data).toMatchObject({ version: 2, description: "另一个管理员保存的新版本" });
	const auditor = await browser.newPage();
	try {
		await login(auditor, "e2e-auditor");
		await openList(auditor, name);
		await expect(list(auditor).getByRole("button", { name: /^编辑模版 / })).toHaveCount(0);
		await list(auditor)
			.getByRole("button", { name: `查看模版 ${name}`, exact: true })
			.click();
		await expect(auditor.getByRole("region", { name: "模版详情", exact: true })).toContainText(
			"另一个管理员保存的新版本",
		);
	} finally {
		await auditor.close();
	}
});

// 保护编辑与创建共用 YAML 资源批次：修改不覆盖原资源，发布后才允许预览及保存新引用。
test("编辑模版：五类资源共用本地批次，确认发布后调试并保存新版本", async ({ page, request }) => {
	const name = `编辑资源-${Date.now()}`;
	const saved = await seedTemplate(request, {
		name,
		agent_version: 1,
		memory_stores: [{ memory_store_id: "memory-guide", access: "read_only", instructions: "沿用挂载说明" }],
		vault_ids: ["vlt_mock_1"],
	});
	const writes: string[] = [];
	page.on("request", (entry) => {
		if (entry.method() === "POST" && entry.url().startsWith(`${apiBase}/api/admin/resource-drafts/`))
			writes.push(new URL(entry.url()).pathname);
	});
	await login(page);
	await openList(page, name);
	await openEditor(page, name);
	const agent = page.getByRole("region", { name: "基础配置", exact: true });
	await agent.getByRole("textbox", { name: "智能体名称", exact: true }).fill(`${name}-智能体`);
	await agent.getByRole("combobox", { name: "默认审批策略", exact: true }).click();
	await page.getByTitle("每次询问", { exact: true }).click();
	const environment = page.getByRole("region", { name: "环境", exact: true });
	await environment.getByRole("button", { name: "清空", exact: true }).click();
	await environment.getByRole("textbox", { name: "环境名称", exact: true }).fill(`${name}-环境`);
	await environment.getByRole("textbox", { name: "描述", exact: true }).fill("与创建页相同的环境表单");
	await page.locator('input[type="file"][aria-label="选择本地文件"]').setInputFiles({
		name: "edit-guide.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("编辑页本地文件"),
	});
	const memory = page.getByRole("region", { name: "记忆库", exact: true });
	await expect(memory.getByRole("textbox", { name: "记忆库名称", exact: true })).toHaveValue("项目知识库");
	await expect(memory).toContainText("project/guide.md");
	await memory.getByRole("textbox", { name: "记忆库名称", exact: true }).fill(`${name}-记忆库`);
	const vault = page.getByRole("region", { name: "密钥库", exact: true });
	await expect(vault.getByRole("textbox", { name: "密钥库名称", exact: true })).toHaveValue("测试密钥库 1");
	await vault.getByRole("textbox", { name: "密钥库名称", exact: true }).fill(`${name}-密钥库`);
	await vault.getByRole("button", { name: "编辑密钥 服务密钥", exact: true }).click();
	const credential = page.getByRole("dialog", { name: "编辑密钥", exact: true });
	await credential.getByLabel(/变量值/).fill("mock-edit-credential");
	await credential.getByRole("checkbox").check();
	await credential.getByRole("button", { name: "保存", exact: true }).click();
	expect(writes).toEqual([]);
	await page.screenshot({ path: test.info().outputPath("edit-desktop.png") });
	await page.setViewportSize({ width: 390, height: 844 });
	await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.screenshot({ path: test.info().outputPath("edit-mobile.png") });
	await page.setViewportSize({ width: 1440, height: 900 });
	const draftCreated = page.waitForResponse(
		(response) => response.url() === `${apiBase}/api/admin/resource-drafts` && response.request().method() === "POST",
	);
	await page.getByRole("button", { name: "下一步：预览调试", exact: true }).click();
	const { data: draft } = (await (await draftCreated).json()) as { data: ResourceDraftView };
	const review = page.getByRole("dialog", { name: "确认发布", exact: true });
	await expect(review).toBeVisible();
	const prefix = `/api/admin/resource-drafts/${draft.draft_id}/resources/`;
	expect(writes.every((path) => path.startsWith(prefix))).toBe(true);
	for (const action of ["agents", "environments", "memory-stores", "vaults", "validate", "plan"])
		expect(writes).toContain(`${prefix}${action}`);
	await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toHaveCount(0);
	expect(writes).not.toContain(`${prefix}publish`);
	await review.getByRole("button", { name: "确认发布", exact: true }).click();
	await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toBeVisible();
	expect(writes).toContain(`${prefix}publish`);
	await openSave(page);
	await saveDialog(page).getByRole("button", { name: "保存修改", exact: true }).click();
	await confirmation(page).getByRole("button", { name: "确认", exact: true }).click();
	await expect(list(page)).toBeVisible();
	const latestResponse = await request.get(`${templatesUrl}/${saved.template_id}`, { headers });
	const { data: latest } = (await latestResponse.json()) as { data: TemplateView };
	expect(latest.version).toBe(2);
	expect(latest.agent_version).toBe(1);
	expect(latest.remote_agent_id).not.toBe(saved.remote_agent_id);
	expect(latest.remote_environment_id).not.toBe(saved.remote_environment_id);
	expect(latest.files).toEqual([expect.objectContaining({ filename: "edit-guide.txt" })]);
	expect(latest.memory_stores).toEqual([
		expect.objectContaining({ access: "read_only", instructions: "沿用挂载说明" }),
	]);
	expect(latest.memory_stores[0]?.memory_store_id).not.toBe("memory-guide");
	expect(latest.vault_ids).toHaveLength(1);
	expect(latest.vault_ids[0]).not.toBe("vlt_mock_1");
	const memoryResponse = await request.get(`${apiBase}/api/admin/remote/memory-stores/memory-guide`, {
		headers,
	});
	expect(memoryResponse.status()).toBe(200);
	expect((await memoryResponse.json()).data.name).toBe("项目知识库");
	const receipt = await request.get(`${apiBase}/api/admin/resource-drafts/${draft.draft_id}`, { headers });
	expect((await receipt.json()).data.status).toBe("published");
});
