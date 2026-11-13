import type { TemplateView } from "@openagentpack/kit-sdk/protocol";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";

const apiBase = process.env.KIT_E2E_API_URL ?? "http://localhost:8787";
const templatesUrl = `${apiBase}/api/admin/templates`;
const sessionsUrl = `${apiBase}/api/admin/debug/sessions`;
const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };
const detail = (page: Page) => page.getByRole("region", { name: "模版详情", exact: true });
const preview = (page: Page) => page.getByRole("region", { name: "模版预览调试", exact: true });
const tab = (page: Page, name: string) => detail(page).getByRole("tab", { name, exact: true });
const start = (page: Page) => detail(page).getByRole("button", { name: "开始调试", exact: true });

async function seed(request: APIRequestContext) {
	const prefix = `kit-e2e-detail-debug-${Date.now()}`;
	const upload = await request.post(`${apiBase}/api/kit/files`, {
		multipart: { file: { name: `${prefix}.txt`, mimeType: "text/plain", buffer: Buffer.from("调试资料") } },
	});
	expect(upload.status()).toBe(201);
	const fileId = (await upload.json()).data.file_id as string;
	const response = await request.post(templatesUrl, {
		headers,
		data: { name: `${prefix}-旧版`, category: "general", remote_agent_id: "agent_mock_assistant" },
	});
	expect(response.status()).toBe(201);
	const first = (await response.json()).data as TemplateView;
	const updated = await request.put(`${templatesUrl}/${first.template_id}`, {
		headers,
		data: {
			base_version: first.version,
			name: `${prefix}-当前版`,
			category: "writing",
			remote_agent_id: "agent_mock_designer",
			agent_version: 3,
			remote_environment_id: "env_mock_analysis",
			files: [{ file_id: fileId, mount_path: "/mnt/session/uploads/guide.txt" }],
			memory_stores: [{ memory_store_id: "memory-guide", access: "read_only", instructions: "查询资料" }],
			vault_ids: ["vlt_mock_1"],
			description: "当前版描述",
			opening_remarks: "欢迎调试当前版本",
			suggested_prompts: ["查看当前资料"],
		},
	});
	expect(updated.status()).toBe(200);
	return { first, current: (await updated.json()).data as TemplateView };
}

async function openList(page: Page, name: string, token = ADMIN_TOKEN) {
	const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.searchParams.set("api", apiBase);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(token);
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await openConsoleNavigation(page);
	await expect(page.getByRole("button", { name: "模版调试", exact: true })).toHaveCount(0);
	await page.getByTestId("template-list-tab").click();
	const list = page.getByRole("region", { name: "模版列表", exact: true });
	await list.getByRole("searchbox", { name: "搜索模版", exact: true }).fill(name);
	await expect(list.getByRole("button", { name: `查看模版 ${name}`, exact: true })).toBeEnabled();
	if (token === "e2e-auditor")
		await expect(list.getByRole("button", { name: `调试模版 ${name}`, exact: true })).toHaveCount(0);
	return list;
}

async function openDetail(page: Page, name: string, token = ADMIN_TOKEN) {
	const list = await openList(page, name, token);
	await list.getByRole("button", { name: `查看模版 ${name}`, exact: true }).click();
	await expect(tab(page, "模版信息")).toHaveAttribute("aria-selected", "true");
	await expect(detail(page).getByRole("region", { name: "基础配置", exact: true })).toBeVisible();
}

async function selectVersion(page: Page, version: number) {
	await detail(page).getByRole("button", { name: "版本管理", exact: true }).click();
	const drawer = page.getByRole("dialog", { name: "版本管理", exact: true });
	await drawer.getByRole("button", { name: `查看模版版本 v${version}`, exact: true }).click();
	await expect(drawer).toHaveCount(0);
	await expect(detail(page).getByText(`模版版本：v${version}`, { exact: true })).toBeVisible();
}

async function createSession(page: Page, ids: string[], action = () => tab(page, "调试").click()) {
	const response = page.waitForResponse((response) => response.url() === sessionsUrl && response.status() === 201);
	await action();
	const id = (await (await response).json()).data.session_id as string;
	ids.push(id);
	await expect(preview(page)).toContainText(`调试会话：${id}`);
	await expect(preview(page).getByRole("combobox", { name: "消息输入", exact: true })).toBeEnabled();
	await expect(tab(page, "模版信息")).toBeEnabled();
	return id;
}

async function expectDeleted(request: APIRequestContext, id: string) {
	await expect.poll(async () => (await request.get(`${sessionsUrl}/${id}`, { headers })).status()).toBe(404);
}

async function cleanup(request: APIRequestContext, ids: string[], template: TemplateView) {
	for (const url of [...ids.map((id) => `${sessionsUrl}/${id}`), `${templatesUrl}/${template.template_id}`]) {
		const session = url.startsWith(sessionsUrl);
		const response = await request.post(`${url}/${session ? "plan" : "delete/plan"}`, {
			headers,
			data: session ? { action: "delete" } : undefined,
		});
		if (response.status() === 404) continue;
		expect(response.ok()).toBe(true);
		const { data } = await response.json();
		expect(
			(await request.delete(url, { headers, data: { plan_id: data.plan_id, confirm_token: data.confirm_token } })).ok(),
		).toBe(true);
	}
}

// 保护详情所选快照到调试的接线，以及 Tab/版本/页面释放后的会话生命周期。
test("模版列表调试：直接进入当前版本、对话及历史版本切换清理", async ({ page, request }) => {
	const { first, current } = await seed(request);
	const sessions: string[] = [];
	const creations: Record<string, unknown>[] = [];
	const templateWrites: string[] = [];
	page.on("request", (outgoing) => {
		if (outgoing.url() === sessionsUrl && outgoing.method() === "POST") creations.push(outgoing.postDataJSON());
		if (outgoing.url().startsWith(templatesUrl) && outgoing.method() !== "GET") templateWrites.push(outgoing.url());
	});
	try {
		const list = await openList(page, current.name);
		expect(creations).toEqual([]);
		const firstId = await createSession(page, sessions, () =>
			list.getByRole("button", { name: `调试模版 ${current.name}`, exact: true }).click(),
		);
		expect(new URL(page.url()).pathname).toBe(`/templates/${current.template_id}/debug`);
		expect(new URL(page.url()).searchParams.get("api")).toBe(apiBase);
		await expect(start(page)).toHaveCount(0);
		expect(creations[0]).toMatchObject({
			remote_agent_id: current.remote_agent_id,
			agent_version: current.agent_version,
			remote_environment_id: current.remote_environment_id,
			files: current.files,
			memory_stores: current.memory_stores,
			vault_ids: current.vault_ids,
		});
		await expect(preview(page)).toContainText(current.name);
		await expect(preview(page)).toContainText(current.description!);
		await expect(preview(page)).toContainText(current.opening_remarks!);
		await preview(page).getByRole("button", { name: "查看当前资料", exact: true }).click();
		await expect(preview(page).getByRole("combobox", { name: "消息输入", exact: true })).toHaveText("查看当前资料");
		await preview(page).getByRole("button", { name: "发送", exact: true }).click();
		await expect(preview(page).getByRole("region", { name: "消息列表", exact: true })).toContainText(
			"这是 mock gateway 的流式回答",
		);
		await expect(tab(page, "模版信息")).toBeEnabled();
		await selectVersion(page, current.version);
		await expect(preview(page)).toContainText(firstId);
		expect(creations).toHaveLength(1);
		await expect(detail(page).getByRole("button", { name: "版本管理", exact: true })).toBeFocused();
		await tab(page, "调试").focus();
		await expect(tab(page, "调试")).toBeFocused();
		await page.keyboard.press("ArrowLeft");
		await expect(tab(page, "用量")).toBeFocused();
		await page.keyboard.press("ArrowLeft");
		await expect(tab(page, "模版信息")).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(tab(page, "模版信息")).toHaveAttribute("aria-selected", "true");
		await expect(preview(page)).toHaveCount(0);
		await expectDeleted(request, firstId);
		const secondId = await createSession(page, sessions);
		expect(secondId).not.toBe(firstId);
		await expect(preview(page)).not.toContainText("这是 mock gateway 的流式回答");
		const historicalId = await createSession(page, sessions, () => selectVersion(page, first.version));
		await expectDeleted(request, secondId);
		await expect(tab(page, "调试")).toHaveAttribute("aria-selected", "true");
		expect(creations).toHaveLength(3);
		expect(creations[2]).toMatchObject({
			remote_agent_id: first.remote_agent_id,
			files: [],
			memory_stores: [],
			vault_ids: [],
		});
		expect(creations[2]).not.toHaveProperty("agent_version");
		expect(creations[2]).not.toHaveProperty("remote_environment_id");
		await expect(preview(page)).toContainText(first.name);
		await detail(page).getByRole("button", { name: "返回模版列表", exact: true }).click();
		await expectDeleted(request, historicalId);
		expect(templateWrites).toEqual([]);
	} finally {
		await page.goto("about:blank");
		await cleanup(request, sessions, current);
	}
});

test("模版详情调试：创建失败重试，创建中锁定 Tab、版本、编辑、应用和导航", async ({ page, request }) => {
	const { first, current } = await seed(request);
	const sessions: string[] = [];
	const release = Promise.withResolvers<void>();
	const pending = Promise.withResolvers<void>();
	let attempts = 0;
	try {
		await page.route(sessionsUrl, async (route) => {
			if (route.request().method() !== "POST") return route.continue();
			attempts += 1;
			if (attempts === 1)
				return route.fulfill({ status: 503, json: { error: { code: "provider_error", message: "创建暂不可用" } } });
			pending.resolve();
			await release.promise;
			return route.continue();
		});
		await openDetail(page, current.name);
		await selectVersion(page, first.version);
		await expect(detail(page).getByRole("button", { name: "应用此版本", exact: true })).toBeEnabled();
		await tab(page, "调试").click();
		await expect(preview(page).getByRole("alert")).toContainText("创建暂不可用");
		const created = createSession(page, sessions, () =>
			preview(page).getByRole("button", { name: "重试创建", exact: true }).click(),
		);
		await pending.promise;
		await expect(tab(page, "模版信息")).toBeDisabled();
		await expect(tab(page, "调试")).toBeDisabled();
		const busyUrl = page.url();
		await detail(page).getByRole("button", { name: "返回模版列表", exact: true }).click();
		await expect(page).toHaveURL(busyUrl);
		for (const name of ["版本管理", "编辑", "应用此版本"])
			await expect(detail(page).getByRole("button", { name, exact: true })).toBeDisabled();
		await expect(page.getByTestId("template-create-tab")).toBeDisabled();
		release.resolve();
		const id = await created;
		expect(attempts).toBe(2);
		await page.getByTestId("template-create-tab").click();
		await expectDeleted(request, id);
	} finally {
		release.resolve();
		await page.goto("about:blank");
		await cleanup(request, sessions, current);
	}
});

// 保护换版失败与离页恢复：旧会话删除不能依赖新版本读取成功，失败清理必须跨页可重试。
test("模版详情调试：换版加载期间删除旧会话，进入编辑后清理失败可重试", async ({ page, request }) => {
	const { first, current } = await seed(request);
	const sessions: string[] = [];
	const releaseVersion = Promise.withResolvers<void>();
	const loadingVersion = Promise.withResolvers<void>();
	const oldVersionUrl = `${templatesUrl}/${first.template_id}/versions/${first.version}`;
	let versionAttempts = 0;
	const creations: string[] = [];
	page.on("request", (outgoing) => {
		if (outgoing.url() === sessionsUrl && outgoing.method() === "POST") creations.push(outgoing.url());
	});
	try {
		await openDetail(page, current.name);
		const originalId = await createSession(page, sessions);
		await page.route(oldVersionUrl, async (route) => {
			versionAttempts += 1;
			if (versionAttempts !== 1) return route.continue();
			loadingVersion.resolve();
			await releaseVersion.promise;
			return route.fulfill({ status: 503, json: { error: { code: "provider_error", message: "版本暂不可用" } } });
		});
		await selectVersion(page, first.version);
		await loadingVersion.promise;
		await expectDeleted(request, originalId);
		await expect(preview(page)).toHaveCount(0);
		expect(creations).toHaveLength(1);
		releaseVersion.resolve();
		await expect(detail(page).getByRole("alert")).toContainText("版本暂不可用");
		await expect(preview(page)).toHaveCount(0);
		expect(creations).toHaveLength(1);
		const historicalId = await createSession(page, sessions, () =>
			detail(page).getByRole("button", { name: "重试", exact: true }).click(),
		);
		let deletionAttempts = 0;
		await page.route(`${sessionsUrl}/${historicalId}`, async (route) => {
			if (route.request().method() !== "DELETE") return route.continue();
			deletionAttempts += 1;
			if (deletionAttempts !== 1) return route.continue();
			return route.fulfill({ status: 503, json: { error: { code: "provider_error", message: "删除暂不可用" } } });
		});
		await detail(page).getByRole("button", { name: "编辑", exact: true }).click();
		await expect(page.getByRole("heading", { name: "编辑智能体", exact: true })).toBeVisible();
		await expect(detail(page)).toHaveCount(0);
		await expect(preview(page)).toHaveCount(0);
		const notice = page.getByRole("region", { name: "调试会话清理", exact: true });
		await expect(notice).toContainText(historicalId);
		await expect(notice).toContainText("调试会话清理失败");
		expect((await request.get(`${sessionsUrl}/${historicalId}`, { headers })).status()).toBe(200);
		await notice.getByRole("button", { name: "重试清理", exact: true }).click();
		await expectDeleted(request, historicalId);
		await expect(notice).toHaveCount(0);
		expect(deletionAttempts).toBe(2);
		expect(creations).toHaveLength(2);
	} finally {
		releaseVersion.resolve();
		await page.goto("about:blank");
		await cleanup(request, sessions, current);
	}
});

test("模版详情调试：窄屏审计员可切换 Tab 和历史版本，不能创建会话", async ({ page, request }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const { first, current } = await seed(request);
	const writes: string[] = [];
	page.on("request", (outgoing) => {
		if (outgoing.url().includes("/api/admin/") && outgoing.method() !== "GET") writes.push(outgoing.url());
	});
	try {
		await openDetail(page, current.name, "e2e-auditor");
		await tab(page, "调试").click();
		await expect(start(page)).toHaveCount(0);
		await expect(detail(page)).toContainText("当前身份只读，无法创建调试会话。");
		await selectVersion(page, first.version);
		await expect(start(page)).toHaveCount(0);
		await tab(page, "模版信息").click();
		await expect(detail(page).getByRole("region", { name: "基础配置", exact: true })).toContainText(
			first.remote_agent_id,
		);
		await expect(preview(page)).toHaveCount(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		expect(writes).toEqual([]);
	} finally {
		await page.goto("about:blank");
		await cleanup(request, [], current);
	}
});
