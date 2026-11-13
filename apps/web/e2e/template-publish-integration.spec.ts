import type { OperationView, ResourceDraftView, TemplateView } from "@openagentpack/kit-sdk/protocol";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";
import { confirmTemplateAgentSelection, openTemplateAgentPicker } from "./template-agent-selection-helpers.ts";

const apiBase = process.env.KIT_E2E_API_URL ?? "http://localhost:8787";
const templatesUrl = `${apiBase}/api/admin/templates`;
const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };

async function createEnvironmentDraft(page: Page, name: string, keepReview = false) {
	const draftCreated = page.waitForResponse(
		(response) => response.url() === `${apiBase}/api/admin/resource-drafts` && response.request().method() === "POST",
	);
	const environment = page.getByRole("region", { name: "环境", exact: true });
	await environment.getByRole("textbox", { name: "环境名称", exact: true }).fill(name);
	await page.getByRole("button", { name: "下一步：预览调试", exact: true }).click();
	const { data: draft } = (await (await draftCreated).json()) as { data: ResourceDraftView };
	const review = page.getByRole("dialog", { name: "确认发布", exact: true });
	await expect(review).toBeVisible();
	if (!keepReview) await review.getByRole("button", { name: "取消", exact: true }).click();
	return draft;
}

// 保护 UI → Kit server → Mock gateway 的发布合同，所有发布/Operation/保存接口均不拦截。
test("模版保存发布：真实 Mock 服务在刷新页面后丢弃未发布草稿，下一批发布并保留回执", async ({ page, request }) => {
	const writes: string[] = [];
	page.on("request", (entry) => {
		if (entry.method() !== "POST" || !entry.url().startsWith(apiBase)) return;
		const path = new URL(entry.url()).pathname;
		if (
			/\/resource-drafts\/[^/]+\/resources\/(validate|plan|publish)$/.test(path) ||
			["/api/admin/debug/sessions", "/api/admin/templates"].includes(path)
		) {
			writes.push(path.split("/").at(-1)!);
		}
	});
	try {
		const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
		url.searchParams.set("api", apiBase);
		await page.goto(url.href);
		await expect(page.getByPlaceholder("ADMIN_TOKEN")).toBeVisible({ timeout: 10000 });
		await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
		await page.getByRole("button", { name: "进入", exact: true }).click();
		await openConsoleNavigation(page);
		await page.getByTestId("template-create-tab").click();
		await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
		await page
			.getByRole("region", { name: "展示配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true })
			.fill(`发布调试-${Date.now()}`);
		await openTemplateAgentPicker(page);
		await page.getByRole("button", { name: "选择智能体 assistant（agent_mock_assistant）", exact: true }).click();
		await confirmTemplateAgentSelection(page);
		const discarded = await createEnvironmentDraft(page, `退出丢弃环境-${Date.now()}`);
		expect(writes).toEqual(["validate", "plan"]);
		page.once("dialog", (dialog) => dialog.accept());
		await page.reload();
		await expect
			.poll(async () =>
				(await request.get(`${apiBase}/api/admin/resource-drafts/${discarded.draft_id}`, { headers })).status(),
			)
			.toBe(404);
		await page.getByTestId("template-create-tab").click();
		await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
		await page
			.getByRole("region", { name: "展示配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true })
			.fill(`发布调试-${Date.now()}`);
		await openTemplateAgentPicker(page);
		await page.getByRole("button", { name: "选择智能体 assistant（agent_mock_assistant）", exact: true }).click();
		await confirmTemplateAgentSelection(page);
		await expect(page.getByRole("button", { name: /^选择环境 .+（local:/ })).toHaveCount(0);
		writes.length = 0;
		const draft = await createEnvironmentDraft(page, `隔离环境-${Date.now()}`, true);
		expect(draft.draft_id).not.toBe(discarded.draft_id);
		const review = page.getByRole("dialog", { name: "确认发布", exact: true });
		await expect(review).toBeVisible();
		expect(writes).toEqual(["validate", "plan"]);
		await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toHaveCount(0);
		const published = page.waitForResponse(
			(response) =>
				/\/api\/admin\/resource-drafts\/[^/]+\/resources\/publish$/.test(response.url()) &&
				response.request().method() === "POST",
		);
		await review.getByRole("button", { name: "确认发布", exact: true }).click();
		const publishResponse = await published;
		expect(publishResponse.status()).toBe(202);
		expect(new URL(publishResponse.url()).pathname).toBe(
			`/api/admin/resource-drafts/${draft.draft_id}/resources/publish`,
		);
		const { data: accepted } = (await publishResponse.json()) as { data: { operation_id: string } };
		await page.getByRole("button", { name: "保存智能体", exact: true }).click();
		const save = page.getByRole("dialog", { name: "保存智能体", exact: true });
		await expect(save).toBeVisible();
		expect(writes).toEqual(["validate", "plan", "publish", "sessions"]);
		const created = page.waitForResponse(
			(response) => response.url() === templatesUrl && response.request().method() === "POST",
		);
		await save.getByRole("button", { name: "保存", exact: true }).click();
		const savedResponse = await created;
		expect(savedResponse.status()).toBe(201);
		const { data: detail } = (await savedResponse.json()) as { data: TemplateView };
		await expect(page.getByRole("region", { name: "模版列表", exact: true })).toBeVisible();
		expect(writes).toEqual(["validate", "plan", "publish", "sessions", "templates"]);
		const operationResponse = await request.get(`${apiBase}/api/admin/operations/${accepted.operation_id}`, {
			headers,
		});
		expect(operationResponse.ok()).toBe(true);
		const { data: operation } = (await operationResponse.json()) as { data: OperationView };
		expect(operation.status).toBe("succeeded");
		expect(operation.kind).toBe("resourceDraft.publish");
		expect(detail).toMatchObject({ remote_agent_id: "agent_mock_assistant", agent_version: 1 });
		const receiptResponse = await request.get(`${apiBase}/api/admin/resource-drafts/${draft.draft_id}`, { headers });
		expect(receiptResponse.ok()).toBe(true);
		const { data: receipt } = (await receiptResponse.json()) as { data: ResourceDraftView };
		expect(receipt.status).toBe("published");
		expect(receipt.cleanup_pending).toBe(false);
		expect(receipt.resources).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "environment", remote_id: detail.remote_environment_id }),
			]),
		);
		await openConsoleNavigation(page);
		await page.getByTestId("template-list-tab").click();
		const afterExit = await request.get(`${apiBase}/api/admin/resource-drafts/${draft.draft_id}`, { headers });
		expect(afterExit.ok()).toBe(true);
		expect((await afterExit.json()).data).toMatchObject({ status: "published", resources: receipt.resources });
	} finally {
		if (!page.isClosed()) await page.goto("about:blank").catch(() => {});
	}
});

// 保护合并表单后的下一步：保存本地副本 → 取消计划修改 → 更新同一声明 → 显式发布 → 新绑定调试。
test("基础配置下一步自动另存，取消发布后继续修改同一本地声明，原远端版本不变", async ({ page, request }) => {
	const sourceUrl = `${apiBase}/api/admin/remote/agents/agent_mock_assistant/versions/1`;
	const source = await (await request.get(sourceUrl, { headers })).json();
	const mutations: { method: string; path: string; body: Record<string, unknown> }[] = [];
	page.on("request", (entry) => {
		if (entry.method() === "GET" || !entry.url().startsWith(apiBase)) return;
		mutations.push({ method: entry.method(), path: new URL(entry.url()).pathname, body: entry.postDataJSON() ?? {} });
	});
	try {
		const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
		url.searchParams.set("api", apiBase);
		await page.goto(url.href);
		await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
		await page.getByRole("button", { name: "进入", exact: true }).click();
		await openConsoleNavigation(page);
		await page.getByTestId("template-create-tab").click();
		await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
		await page
			.getByRole("region", { name: "展示配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true })
			.fill(`基础配置副本-${Date.now()}`);
		await openTemplateAgentPicker(page);
		await page.getByRole("button", { name: "选择智能体 assistant（agent_mock_assistant）", exact: true }).click();
		await confirmTemplateAgentSelection(page);
		const basic = page.getByRole("region", { name: "基础配置", exact: true });
		await expect(basic.getByRole("button", { name: "保存基础配置", exact: true })).toHaveCount(0);
		await basic.getByRole("textbox", { name: "智能体名称", exact: true }).fill("基础配置副本");
		await basic.getByRole("switch", { name: "Multi-Agent 模式", exact: true }).check();
		await basic.getByRole("checkbox", { name: "Self 当前智能体自己", exact: true }).check();
		await basic.getByRole("checkbox", { name: "designer agent_mock_designer", exact: true }).check();
		await basic.getByRole("textbox", { name: "系统提示词", exact: true }).fill("./第一版草稿");
		const next = page.getByRole("button", { name: "下一步：预览调试", exact: true });
		await next.click();
		const review = page.getByRole("dialog", { name: "确认发布", exact: true });
		await expect(review).toBeVisible();
		expect(
			mutations
				.filter((entry) => /\/resource-drafts\/[^/]+\/resources\/(agents|validate|plan|publish)$/.test(entry.path))
				.map((entry) => entry.path.split("/").at(-1)),
		).toEqual(["agents", "validate", "plan"]);
		expect(mutations.filter((entry) => entry.path.endsWith("/agents"))).toHaveLength(1);
		expect(mutations.find((entry) => entry.path.endsWith("/agents"))?.body.multiagent).toEqual({
			type: "coordinator",
			agents: [{ type: "self" }, { agent_id: "agent_mock_designer" }],
		});
		expect(mutations.filter((entry) => entry.path.endsWith("/publish"))).toHaveLength(0);
		await review.getByRole("button", { name: "取消", exact: true }).click();
		await basic.getByRole("textbox", { name: "系统提示词", exact: true }).fill("../修改后的草稿\n");
		await next.click();
		await expect(review).toBeVisible();
		expect(mutations.filter((entry) => entry.path.endsWith("/agents"))).toHaveLength(1);
		const updates = mutations.filter((entry) => entry.method === "PUT" && entry.path.includes("/declarations/agent/"));
		expect(updates).toHaveLength(1);
		expect(updates[0]?.body).toMatchObject({
			declaration: {
				instructions: "../修改后的草稿\n",
				multiagent: { type: "coordinator", agents: [{ type: "self" }, { agent_id: "agent_mock_designer" }] },
			},
		});
		await review.getByRole("button", { name: "确认发布", exact: true }).click();
		await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toBeVisible();
		await expect.poll(() => mutations.filter((entry) => entry.path === "/api/admin/debug/sessions").length).toBe(1);
		const debug = mutations.find((entry) => entry.path === "/api/admin/debug/sessions")!;
		expect(debug.body.remote_agent_id).not.toBe("agent_mock_assistant");
		expect(debug.body.agent_version).toBeGreaterThan(0);
		const publishedDetail = await request.get(
			`${apiBase}/api/admin/remote/agents/${debug.body.remote_agent_id}/versions/${debug.body.agent_version}`,
			{ headers },
		);
		expect(publishedDetail.ok()).toBe(true);
		expect((await publishedDetail.json()).data.configuration.multiagent).toEqual({
			type: "coordinator",
			agents: [{ type: "self" }, { agent_id: "agent_mock_designer" }],
		});
		expect(await (await request.get(sourceUrl, { headers })).json()).toEqual(source);
		await page.getByRole("button", { name: "上一步：选择配置", exact: true }).click();
		await basic.getByRole("textbox", { name: "智能体描述", exact: true }).fill("发布后再修改");
		await expect
			.poll(
				() => mutations.filter((entry) => entry.method === "DELETE" && entry.path.includes("/debug/sessions/")).length,
			)
			.toBe(1);
	} finally {
		if (!page.isClosed()) await page.goto("about:blank").catch(() => {});
	}
});

test("基础配置未修改或修改后还原：下一步沿用原版本，不新建或发布 Agent", async ({ page }) => {
	const mutations: { path: string; body: Record<string, unknown> }[] = [];
	page.on("request", (entry) => {
		if (entry.method() !== "POST" || !entry.url().startsWith(apiBase)) return;
		mutations.push({ path: new URL(entry.url()).pathname, body: entry.postDataJSON() ?? {} });
	});
	try {
		const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
		url.searchParams.set("api", apiBase);
		await page.goto(url.href);
		await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
		await page.getByRole("button", { name: "进入", exact: true }).click();
		await openConsoleNavigation(page);
		await page.getByTestId("template-create-tab").click();
		await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
		await page
			.getByRole("region", { name: "展示配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true })
			.fill(`沿用原版本-${Date.now()}`);
		await openTemplateAgentPicker(page);
		await page.getByRole("button", { name: "选择智能体 assistant（agent_mock_assistant）", exact: true }).click();
		await confirmTemplateAgentSelection(page);
		const basic = page.getByRole("region", { name: "基础配置", exact: true });
		const prompt = basic.getByRole("textbox", { name: "系统提示词", exact: true });
		const original = await prompt.inputValue();
		await prompt.fill(`${original}\n临时修改`);
		await prompt.fill(original);
		const bash = basic.getByRole("checkbox", { name: "bash", exact: true });
		const checked = await bash.isChecked();
		await bash.setChecked(!checked);
		await bash.setChecked(checked);
		await page.getByRole("button", { name: "下一步：预览调试", exact: true }).click();
		await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toBeVisible();
		await expect.poll(() => mutations.filter((entry) => entry.path === "/api/admin/debug/sessions").length).toBe(1);
		expect(mutations.find((entry) => entry.path === "/api/admin/debug/sessions")?.body).toMatchObject({
			remote_agent_id: "agent_mock_assistant",
			agent_version: 1,
		});
		expect(
			mutations.filter(
				(entry) => entry.path.includes("/projects/") || entry.path.startsWith("/api/admin/resource-drafts"),
			),
		).toEqual([]);
		await expect(page.getByRole("dialog", { name: "确认发布", exact: true })).toHaveCount(0);
	} finally {
		if (!page.isClosed()) await page.goto("about:blank").catch(() => {});
	}
});

test("打开 Skill 选择后取消：空批次可直接预览调试，不发布且继续保留", async ({ page, request }) => {
	const mutations: { path: string; body: Record<string, unknown> }[] = [];
	page.on("request", (entry) => {
		if (entry.method() === "POST" && entry.url().startsWith(apiBase))
			mutations.push({ path: new URL(entry.url()).pathname, body: entry.postDataJSON() ?? {} });
	});
	try {
		const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
		url.searchParams.set("api", apiBase);
		await page.goto(url.href);
		await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
		await page.getByRole("button", { name: "进入", exact: true }).click();
		await openConsoleNavigation(page);
		await page.getByTestId("template-create-tab").click();
		await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
		await page
			.getByRole("region", { name: "展示配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true })
			.fill(`空批次预览-${Date.now()}`);
		await openTemplateAgentPicker(page);
		await page.getByRole("button", { name: "选择智能体 assistant（agent_mock_assistant）", exact: true }).click();
		await confirmTemplateAgentSelection(page);
		const created = page.waitForResponse(
			(response) => response.url() === `${apiBase}/api/admin/resource-drafts` && response.request().method() === "POST",
		);
		await page
			.getByRole("region", { name: "基础配置", exact: true })
			.getByRole("button", { name: "添加 Skill", exact: true })
			.click();
		const { data: draft } = (await (await created).json()) as { data: ResourceDraftView };
		const skills = page.getByRole("dialog", { name: /^选择 Skill/ });
		await expect(skills).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(skills).toHaveCount(0);
		const declarations = await request.get(
			`${apiBase}/api/admin/resource-drafts/${draft.draft_id}/resources/declarations`,
			{ headers },
		);
		expect(declarations.ok()).toBe(true);
		expect((await declarations.json()).data).toEqual([]);
		const planned = page.waitForResponse(
			(response) =>
				response.url().endsWith(`/${draft.draft_id}/resources/plan`) && response.request().method() === "POST",
		);
		await page.getByRole("button", { name: "下一步：预览调试", exact: true }).click();
		const plan = await planned;
		expect(plan.ok()).toBe(true);
		expect((await plan.json()).data.diff).toEqual([]);
		await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toBeVisible();
		await expect(page.getByRole("dialog", { name: "确认发布", exact: true })).toHaveCount(0);
		await expect.poll(() => mutations.filter((entry) => entry.path === "/api/admin/debug/sessions").length).toBe(1);
		expect(mutations.find((entry) => entry.path === "/api/admin/debug/sessions")?.body).toMatchObject({
			remote_agent_id: "agent_mock_assistant",
			agent_version: 1,
		});
		expect(mutations.filter((entry) => entry.path.endsWith("/publish"))).toEqual([]);
		const retained = await request.get(`${apiBase}/api/admin/resource-drafts/${draft.draft_id}`, { headers });
		expect(retained.ok()).toBe(true);
		expect((await retained.json()).data).toMatchObject({ status: "draft", resources: [], cleanup_pending: false });
	} finally {
		if (!page.isClosed()) await page.goto("about:blank").catch(() => {});
	}
});
