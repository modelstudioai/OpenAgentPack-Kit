import {
	type OperationView,
	PROTOCOL_VERSION,
	type ProjectDeclaration,
	type ProjectPlan,
	type PublicationReport,
	type ResourceDraftView,
} from "@openagentpack/kit-sdk/protocol";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";
import {
	confirmTemplateAgentSelection,
	installTemplateAgentDetailFixture,
	openTemplateAgentPicker,
} from "./template-agent-selection-helpers.ts";
import { selectInlineEnvironment } from "./template-inline-helpers.ts";
import { draftProjectPath, resourceDraftFixture } from "./template-resource-draft-fixture.ts";

const apiBase = "https://template-publish.example/kit";
const projectPath = draftProjectPath;
const sessionPath = "/api/admin/debug/sessions";
const timestamp = "2026-11-01T08:00:00.000Z";
const next = (page: Page) =>
	page
		.locator('footer[aria-label="模版配置操作"]')
		.getByRole("button", { name: /^(下一步：预览调试|保存智能体|保存修改)$/, includeHidden: true });
const saveDialog = (page: Page) => page.getByRole("dialog", { name: "保存智能体", exact: true });
const status = (page: Page) => page.getByRole("region", { name: "预览前发布", exact: true });
const review = (page: Page) => page.getByRole("dialog", { name: "确认发布", exact: true });
const confirm = (page: Page) => review(page).getByRole("button", { name: "确认发布", exact: true });
const defaultDiff: ProjectPlan["diff"] = [
	{ resource: "environment:new-local-env", action: "create", destructive: false, summary: "创建分析环境" },
];
const declarations: ProjectDeclaration[] = [
	{ type: "environment", id: "new-local-env", name: "数据分析环境" },
	{ type: "agent", id: "assistant", name: "项目智能助手" },
	{ type: "vault", id: "old-vault", name: "旧密钥库" },
].map((item) => ({
	...item,
	type: item.type as ProjectDeclaration["type"],
	base_revision: "revision-1",
	source_path: `${item.type}/${item.id}/resource.json`,
	declaration: { id: item.id, name: item.name },
	read_only_paths: [["id"]],
	references: [],
}));

interface PublishFixture {
	drafts: ReturnType<typeof resourceDraftFixture>;
	hasDraft: boolean;
	emptyDraft: boolean;
	role: "admin" | "auditor";
	revision: string;
	validationError: boolean;
	publishResponseError: boolean;
	operationStatus: OperationView["status"];
	publication?: PublicationReport;
	recoveryAction?: ResourceDraftView["recovery_action"];
	operationReadError: boolean;
	declarationsError: boolean;
	diff: ProjectPlan["diff"];
	requests: string[];
	validationGate?: Promise<void>;
	operationGate?: Promise<void>;
	writes: { path: string; body: unknown }[];
	plans: number;
	publishes: number;
	sessions: number;
	operationReads: number;
	operationStreams: number;
}

function operation(state: PublishFixture): OperationView {
	const receipt = state.drafts.receipts.get("resource-draft-1");
	if (receipt) {
		receipt.status =
			state.operationStatus === "succeeded"
				? "published"
				: state.operationStatus === "failed"
					? "failed"
					: "publishing";
		receipt.operation_id = `op_publish_${state.publishes}`;
		if (state.recoveryAction) receipt.recovery_action = state.recoveryAction;
		if (receipt.status === "published") state.drafts.active = null;
	}
	return {
		operation_id: `op_publish_${state.publishes}`,
		kind: "resourceDraft.publish",
		status: state.operationStatus,
		phase: state.operationStatus === "running" ? "apply" : "complete",
		progress: state.operationStatus === "running" ? 0.5 : 1,
		log: ["已校验项目", "正在发布资源"],
		...(state.operationStatus === "failed" ? { error: "Provider 发布失败" } : {}),
		...(state.publication ? { publication: state.publication } : {}),
		created_at: timestamp,
		updated_at: timestamp,
	};
}

async function respondOperation(route: Route, state: PublishFixture, streaming: boolean) {
	if (streaming) state.operationStreams += 1;
	else state.operationReads += 1;
	if (state.operationReadError) {
		return route.fulfill({ status: 400, json: { error: { code: "invalid_request", message: "发布进度暂不可读" } } });
	}
	if (!streaming) return route.fulfill({ json: { data: operation(state) } });
	await state.operationGate;
	return route.fulfill({
		contentType: "text/event-stream",
		body: `event: operation\ndata: ${JSON.stringify(operation(state))}\n\n`,
	});
}

async function respondProject(route: Route, state: PublishFixture, path: string) {
	if (path === `${projectPath}/validate`) {
		await state.validationGate;
		if (state.validationError) {
			return route.fulfill({ status: 409, json: { error: { code: "conflict", message: "环境声明校验失败" } } });
		}
		return route.fulfill({
			json: { data: { project_revision: state.revision, diagnostics: [], warnings: [], agents: ["assistant"] } },
		});
	}
	if (path === `${projectPath}/plan`) {
		expect(route.request().postDataJSON()).toEqual({ action: "publish" });
		state.plans += 1;
		return route.fulfill({
			json: {
				data: {
					plan_id: `plan_${state.plans}`,
					confirm_token: `token_${state.plans}`,
					project_revision: state.revision,
					expires_at: Date.now() + 60_000,
					destructive: state.diff.some((entry) => entry.destructive),
					diff: state.diff,
				},
			},
		});
	}
	if (path === `${projectPath}/publish`) {
		expect(route.request().postDataJSON()).toEqual({
			plan_id: `plan_${state.plans}`,
			confirm_token: `token_${state.plans}`,
		});
		state.publishes += 1;
		if (state.publishResponseError) {
			const receipt = state.drafts.active;
			if (receipt) receipt.status = "publishing";
			return route.fulfill({ status: 503, json: { error: { code: "provider_error", message: "发布响应暂不可用" } } });
		}
		return route.fulfill({ status: 202, json: { data: { operation_id: `op_publish_${state.publishes}` } } });
	}
	return route.fulfill({ status: 404, json: { error: { code: "not_found", message: `未配置项目写请求 ${path}` } } });
}

async function respondWrite(route: Route, state: PublishFixture, path: string) {
	const request = route.request();
	state.writes.push({ path, body: request.postData() ? request.postDataJSON() : undefined });
	if (path.startsWith(`${projectPath}/`)) return respondProject(route, state, path);
	if (path === sessionPath) {
		state.sessions += 1;
		return route.fulfill({
			status: 201,
			json: {
				data: {
					session_id: `session_${state.sessions}`,
					source: "template",
					remote_agent_id: "agent_existing",
					remote_environment_id: "env_existing",
					agent_version: 2,
					created_at: timestamp,
					status: "idle",
				},
			},
		});
	}
	if (path.startsWith(`${sessionPath}/`) && path.endsWith("/plan")) {
		return route.fulfill({ json: { data: { plan_id: "cleanup", confirm_token: "cleanup-token", diff: [] } } });
	}
	if (path.startsWith(`${sessionPath}/`) && request.method() === "DELETE") {
		return route.fulfill({ json: { data: { deleted: true } } });
	}
	return route.fulfill({ status: 500, json: { error: { code: "internal", message: `非预期写请求 ${path}` } } });
}

async function respondRead(route: Route, state: PublishFixture, path: string) {
	if (path === `${projectPath}/declarations`) {
		return state.declarationsError
			? route.fulfill({ status: 500, json: { error: { code: "internal", message: "资源名称暂不可读" } } })
			: route.fulfill({ json: { data: state.emptyDraft ? [] : declarations } });
	}
	if (path.startsWith("/api/admin/operations/op_publish_")) {
		return respondOperation(route, state, path.endsWith("/events"));
	}
	if (path.startsWith(`${sessionPath}/`) && path.endsWith("/stream")) {
		return route.fulfill({
			contentType: "text/event-stream",
			body: `event: ready\ndata: ${JSON.stringify({ session_id: `session_${state.sessions}`, replayed: 0 })}\n\nevent: done\ndata: {"status":"idle"}\n\n`,
		});
	}
	if (path.endsWith("/threads")) return route.fulfill({ json: { data: [], next_page_token: null } });
	if (path.endsWith("/tool-approvals"))
		return route.fulfill({
			json: { data: { requires_action: false, batch_id: null, pending_call_ids: [], requests: [] } },
		});
	const responses: Record<string, unknown> = {
		"/api/admin/identity": { role: state.role, subject: `${state.role}:template-publish` },
		"/api/admin/preset-packs/agents/agent_existing/resources": {
			agent_id: "agent_existing",
			complete: true,
			sessions: [],
		},
		"/api/admin/projects": [{ name: "project", path: "/test/project" }],
		"/api/admin/projects/project": {
			name: "project",
			project_revision: "ordinary-project-revision",
			aligned: false,
			remote_checked: false,
			drift: [],
			agents: [],
			environments: [],
		},
		[`${projectPath}/resource-bindings`]: { resources: [] },
		[`${projectPath}/agent-options`]: { base_revision: state.revision, skills: [], mcp_servers: [] },
		[projectPath]: {
			name: "resource-draft-1",
			project_revision: state.revision,
			active_mutation: null,
			aligned: false,
			remote_checked: false,
			drift: [],
			agents: [],
			environments: [],
		},
		"/api/admin/remote/agents": [{ agent_id: "agent_existing", name: "分析助手", version: 2 }],
		"/api/admin/remote/environments": [{ environment_id: "env_existing", name: "运行环境" }],
		"/api/admin/remote/environments/env_existing": {
			environment_id: "env_existing",
			name: "运行环境",
			configuration: { type: "cloud" },
		},
	};

	return route.fulfill({ json: { data: responses[path] ?? [] } });
}

/** 只替换 Kit HTTP 边界，保护准备、显式确认、Operation 完成与调试创建的先后关系。 */
async function openTemplate(page: Page, options: Partial<PublishFixture> = {}) {
	const state: PublishFixture = {
		drafts: resourceDraftFixture(),
		hasDraft: true,
		emptyDraft: false,
		role: "admin",
		revision: "revision-1",
		validationError: false,
		publishResponseError: false,
		operationStatus: "succeeded",
		operationReadError: false,
		declarationsError: false,
		diff: defaultDiff,
		requests: [],
		writes: [],
		plans: 0,
		publishes: 0,
		sessions: 0,
		operationReads: 0,
		operationStreams: 0,
		...options,
	};
	if (!state.hasDraft) state.drafts.active = null;
	await page.route(`${apiBase}/api/**`, async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname.replace(/^\/kit/, "");
		if (path.endsWith("/config")) {
			return route.fulfill({ json: { data: { apiBaseUrl: apiBase, protocolVersion: PROTOCOL_VERSION } } });
		}
		expect(request.headers().authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
		state.requests.push(`${request.method()} ${path}`);
		if (await state.drafts.handle(route, path)) return;
		return request.method() === "GET" ? respondRead(route, state, path) : respondWrite(route, state, path);
	});
	await installTemplateAgentDetailFixture(page, apiBase);
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
		.fill("发布调试模版");
	await openTemplateAgentPicker(page);
	await page.getByRole("button", { name: "选择智能体 分析助手（agent_existing）", exact: true }).click();
	await confirmTemplateAgentSelection(page);
	await selectInlineEnvironment(page, "选择环境 运行环境（env_existing）");
	if (state.hasDraft && state.role === "admin") {
		await page
			.getByRole("region", { name: "基础配置", exact: true })
			.getByRole("button", { name: "添加 Skill", exact: true })
			.click();
		await page
			.getByRole("dialog", { name: /^选择 Skill(?:\s|$)/ })
			.getByRole("button", { name: "完成", exact: true })
			.click();
	}
	return state;
}

async function expectConfigurationPreserved(page: Page) {
	await expect(
		page
			.getByRole("region", { name: "展示配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true }),
	).toHaveValue("发布调试模版");
	await expect(
		page.getByRole("region", { name: "基础配置", exact: true }).getByText("v2", { exact: true }),
	).toBeVisible();
	await expect(page.getByRole("textbox", { name: "环境名称", exact: true })).toHaveValue("运行环境");
}

test("模版保存发布：先校验和审阅计划，确认后等待发布成功才打开保存表单", async ({ page }) => {
	const validation = Promise.withResolvers<void>();
	const complete = Promise.withResolvers<void>();
	const state = await openTemplate(page, {
		validationGate: validation.promise,
		operationGate: complete.promise,
		operationStatus: "running",
		diff: [
			...defaultDiff,
			{ resource: "agent:assistant", action: "update", destructive: false, summary: "更新系统提示词" },
			{ resource: "vault:old-vault", action: "delete", destructive: true, summary: "删除旧密钥库声明" },
			{ resource: "file:unchanged-file", action: "noop", destructive: false, summary: "文件未变更" },
			{ resource: "memory_store:dangerous-memory", action: "noop", destructive: true, summary: "需审阅的危险操作" },
		],
	});
	await next(page).click();
	try {
		await expect(status(page)).toContainText("正在校验新建资源");
		await expect(next(page)).toBeDisabled();
		await expect(
			page
				.getByRole("region", { name: "展示配置", exact: true })
				.getByRole("textbox", { name: "智能体名称", exact: true }),
		).toBeDisabled();
		expect(state.writes.filter(({ path }) => !path.startsWith(sessionPath)).map(({ path }) => path)).toEqual([
			`${projectPath}/validate`,
		]);
		expect(state.publishes).toBe(0);
		expect(state.sessions).toBe(0);
		await expect(review(page)).toHaveCount(0);
	} finally {
		validation.resolve();
	}
	await expect(review(page)).toContainText("有未发布的内容需要发布");
	await expect(review(page)).toContainText("本次新建的资源");
	await expect(review(page)).toContainText(/待发布资源[（(]4\s*项[）)]/);
	for (const text of [
		"环境：数据分析环境",
		"创建 · environment:new-local-env",
		"创建分析环境",
		"智能体：项目智能助手",
		"更新 · agent:assistant",
		"更新系统提示词",
		"密钥库：旧密钥库",
		"删除（包含破坏性变更） · vault:old-vault",
		"删除旧密钥库声明",
		"记忆库",
		"检查（包含破坏性变更） · memory_store:dangerous-memory",
		"需审阅的危险操作",
		"包含破坏性变更",
	])
		await expect(review(page)).toContainText(text);
	await expect(review(page)).not.toContainText("unchanged-file");
	await expect(review(page)).not.toContainText("文件未变更");
	await expect(saveDialog(page)).toHaveCount(0);
	expect(state.publishes).toBe(0);
	expect(state.sessions).toBe(0);
	await confirm(page).click();
	try {
		await expect.poll(() => state.operationReads).toBeGreaterThan(0);
		await expect(status(page)).toContainText("正在发布新建资源");
		await expect(next(page)).toBeDisabled();
		await expect(saveDialog(page)).toHaveCount(0);
		expect(state.publishes).toBe(1);
		expect(state.sessions).toBe(0);
		state.operationStatus = "succeeded";
	} finally {
		complete.resolve();
	}
	await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toBeVisible();
	await next(page).click();
	await expect(saveDialog(page)).toBeVisible();
	expect(state.sessions).toBe(1);
	expect(state.writes.filter(({ path }) => !path.startsWith(sessionPath)).map(({ path }) => path)).toEqual([
		`${projectPath}/validate`,
		`${projectPath}/plan`,
		`${projectPath}/publish`,
	]);
});

test("模版保存发布：窄屏校验失败和取消都保留配置，重试须重新审阅确认", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const state = await openTemplate(page, { validationError: true, declarationsError: true });
	await next(page).click();
	await expect(status(page).getByRole("alert")).toContainText("环境声明校验失败");
	await expectConfigurationPreserved(page);
	await expect(saveDialog(page)).toHaveCount(0);
	expect(state.plans).toBe(0);
	expect(state.publishes).toBe(0);
	expect(state.sessions).toBe(0);
	const name = page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true });
	const retry = status(page).getByRole("button", { name: "重新准备发布", exact: true });
	await expect(retry).toBeEnabled();
	await name.fill("");
	await expect(retry).toBeDisabled();
	await expect(next(page)).toBeDisabled();
	await name.fill("发布调试模版");
	await expect(retry).toBeEnabled();
	await expect(next(page)).toBeEnabled();
	state.validationError = false;
	await retry.click();
	await expect(review(page)).toBeVisible();
	await expect(review(page)).toContainText("environment:new-local-env");
	await expect(review(page)).toContainText("创建分析环境");
	await expect(confirm(page)).toBeEnabled();
	await review(page).getByRole("button", { name: "取消", exact: true }).click();
	await expect(review(page)).toHaveCount(0);
	await expectConfigurationPreserved(page);
	expect(state.publishes).toBe(0);
	expect(state.sessions).toBe(0);
	await next(page).click();
	await expect(review(page)).toBeVisible();
	expect(state.plans).toBe(2);
	await confirm(page).click();
	await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toBeVisible();
	await next(page).click();
	await expect(saveDialog(page)).toBeVisible();
	expect(state.sessions).toBe(1);
	expect(state.publishes).toBe(1);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("模版保存发布：保存操作经过确认，源码变化使旧计划失效", async ({ page }) => {
	const state = await openTemplate(page);
	await next(page).click();
	await expect(review(page)).toBeVisible();
	state.revision = "revision-2";
	await confirm(page).click();
	await expect(status(page).getByRole("alert")).toContainText("资源草稿");
	await expect(saveDialog(page)).toHaveCount(0);
	await expectConfigurationPreserved(page);
	expect(state.publishes).toBe(0);
	expect(state.sessions).toBe(0);
	await status(page).getByRole("button", { name: "重新准备发布", exact: true }).click();
	await expect(review(page)).toBeVisible();
	expect(state.plans).toBe(2);
	expect(state.publishes).toBe(0);
	await confirm(page).click();
	await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toBeVisible();
	await next(page).click();
	await expect(saveDialog(page)).toBeVisible();
	expect(state.sessions).toBe(1);
	expect(state.writes.find(({ path }) => path.endsWith("/publish"))?.body).toEqual({
		plan_id: "plan_2",
		confirm_token: "token_2",
	});
});

test("模版保存发布：发布失败不能保存，重新准备必须获得新计划并再次确认", async ({ page }) => {
	const state = await openTemplate(page, { operationStatus: "failed" });
	await next(page).click();
	await expect(review(page)).toBeVisible();
	await confirm(page).click();
	await expect(status(page).getByRole("alert")).toContainText("Provider 发布失败");
	await expect(saveDialog(page)).toHaveCount(0);
	expect(state.publishes).toBe(1);
	expect(state.sessions).toBe(0);
	await expectConfigurationPreserved(page);
	state.operationStatus = "succeeded";
	await status(page).getByRole("button", { name: "重新准备发布", exact: true }).click();
	await expect(review(page)).toBeVisible();
	expect(state.plans).toBe(2);
	expect(state.publishes).toBe(1);
	expect(state.sessions).toBe(0);
	await confirm(page).click();
	await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toBeVisible();
	await next(page).click();
	await expect(saveDialog(page)).toBeVisible();
	expect(state.sessions).toBe(1);
	expect(state.publishes).toBe(2);
});

test("模版保存发布：进度读取失败只重连同一个操作，不重复提交发布", async ({ page }) => {
	const state = await openTemplate(page, { operationReadError: true });
	await next(page).click();
	await expect(review(page)).toBeVisible();
	await confirm(page).click();
	await expect(status(page).getByRole("alert")).toContainText("发布进度暂不可读");
	await expect(next(page)).toBeDisabled();
	await expect(saveDialog(page)).toHaveCount(0);
	expect(state.publishes).toBe(1);
	expect(state.sessions).toBe(0);
	state.operationReadError = false;
	await status(page).getByRole("button", { name: "重新连接进度", exact: true }).click();
	await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toBeVisible();
	await next(page).click();
	await expect(saveDialog(page)).toBeVisible();
	expect(state.sessions).toBe(1);
	expect(state.operationStreams).toBeGreaterThan(1);
	expect(state.plans).toBe(1);
	expect(state.publishes).toBe(1);
});

test("模版保存发布：审计员只能查看配置，不能保存、校验、发布或创建调试会话", async ({ page }) => {
	const state = await openTemplate(page, { role: "auditor" });
	await expect(next(page)).toBeDisabled();
	await expect(saveDialog(page)).toHaveCount(0);
	await expect(review(page)).toHaveCount(0);
	expect(state.writes).toEqual([]);
	expect(state.sessions).toBe(0);
});

test("模版保存发布：提交响应失败且结果未知时禁止重发，离页后保留未确认批次", async ({ page }) => {
	const state = await openTemplate(page, { publishResponseError: true });
	await next(page).click();
	await expect(review(page)).toBeVisible();
	await confirm(page).click();
	await expect(status(page).getByRole("alert")).toContainText("发布结果尚未确认");
	await expect(status(page).getByRole("button", { name: "重新准备发布", exact: true })).toHaveCount(0);
	await expect(next(page)).toBeDisabled();
	await expect(saveDialog(page)).toHaveCount(0);
	expect(state.plans).toBe(1);
	expect(state.publishes).toBe(1);
	expect(state.operationReads).toBe(0);
	expect(state.sessions).toBe(0);
	await status(page).getByRole("button", { name: "重新读取发布结果", exact: true }).click();
	await expect(status(page).getByRole("alert")).toContainText("发布结果尚未确认");
	expect(state.publishes).toBe(1);
	expect(state.drafts.requests).toContain("GET /api/admin/resource-drafts/resource-draft-1");
	await openConsoleNavigation(page);
	await expect(page.getByTestId("template-list-tab")).toBeEnabled();
	await page.getByTestId("template-list-tab").click();
	await page
		.getByRole("alertdialog", { name: "确认退出", exact: true })
		.getByRole("button", { name: "确认退出", exact: true })
		.click();
	await expect(page.getByRole("region", { name: "模版列表", exact: true })).toBeVisible();
	await page.getByTestId("template-create-tab").click();
	await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
	await expect(page.getByRole("button", { name: "恢复资源发布", exact: true })).toBeVisible();
	expect(state.drafts.active?.status).toBe("publishing");
	expect(state.drafts.receipts.has("resource-draft-1")).toBe(true);
	expect(state.drafts.discarded).toEqual([]);
	expect(state.plans).toBe(1);
	expect(state.publishes).toBe(1);
	expect(state.sessions).toBe(0);
});

for (const [label, diff] of [
	["空计划", []],
	["全 noop 计划", [{ resource: "agent:assistant", action: "noop", destructive: false }]],
] as const) {
	test(`模版保存发布：${label}复核版本后打开保存表单，不确认或提交发布`, async ({ page }) => {
		const state = await openTemplate(page, { diff: [...diff], emptyDraft: true });
		state.requests = [];
		await next(page).click();
		await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toBeVisible();
		await next(page).click();
		await expect(saveDialog(page)).toBeVisible();
		expect(state.sessions).toBe(1);
		await expect(review(page)).toHaveCount(0);
		expect(state.writes.filter(({ path }) => !path.startsWith(sessionPath)).map(({ path }) => path)).toEqual([
			`${projectPath}/validate`,
			`${projectPath}/plan`,
		]);
		const planned = state.requests.indexOf(`POST ${projectPath}/plan`);
		const checked = state.requests.indexOf(`GET ${projectPath}`, planned + 1);
		expect(planned).toBeGreaterThanOrEqual(0);
		expect(checked).toBeGreaterThan(planned);
		expect(state.plans).toBe(1);
		expect(state.publishes).toBe(0);
		expect(state.operationReads).toBe(0);
		expect(state.operationStreams).toBe(0);
		expect(state.sessions).toBe(1);
		if (label === "空计划") {
			await saveDialog(page).getByRole("button", { name: "取消", exact: true }).click();
			await expect(next(page)).toBeEnabled();
			expect(state.drafts.active?.draft_id).toBe("resource-draft-1");
			expect(state.drafts.requests.filter((request) => request.endsWith("/discard"))).toEqual([]);
		}
	});
}

test("模版保存发布：仅选云端且无草稿打开保存表单，不触碰普通项目或创建发布草稿", async ({ page }) => {
	const state = await openTemplate(page, { hasDraft: false });
	state.requests = [];
	await next(page).click();
	await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toBeVisible();
	await next(page).click();
	await expect(saveDialog(page)).toBeVisible();
	expect(state.sessions).toBe(1);
	await expect(review(page)).toHaveCount(0);
	expect(state.writes.filter(({ path }) => !path.startsWith(sessionPath)).map(({ path }) => path)).toEqual([]);
	expect(state.requests.some((request) => request.includes("/projects/"))).toBe(false);
	expect(state.drafts.requests.every((request) => request === "GET /api/admin/resource-drafts/active")).toBe(true);
	expect(state.plans).toBe(0);
	expect(state.publishes).toBe(0);
});

test("模版保存发布：恢复的草稿有资源且计划 noop，仍确认发布取得完整回执", async ({ page }) => {
	const state = await openTemplate(page, {
		diff: [{ resource: "agent:assistant", action: "noop", destructive: false }],
	});
	await next(page).click();
	await expect(review(page)).toBeVisible();
	expect(state.publishes).toBe(0);
	await confirm(page).click();
	await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toBeVisible();
	await next(page).click();
	await expect(saveDialog(page)).toBeVisible();
	expect(state.sessions).toBe(1);
	expect(state.publishes).toBe(1);
	expect(state.drafts.receipts.get("resource-draft-1")?.status).toBe("published");
});

for (const outcome of ["unknown", "succeeded"] as const) {
	test(`模版发布结果：${outcome} 报告在缺少完整证明时保留资源身份并禁止重发`, async ({ page }) => {
		const state = await openTemplate(page, {
			operationStatus: "failed",
			recoveryAction: "read_result",
			publication: {
				outcome,
				mutation_started: true,
				resources: [
					{ type: "environment", id: "local-env", status: "succeeded", remote_id: "env_known" },
					{
						type: "agent",
						id: "assistant",
						status: outcome === "unknown" ? "unknown" : "succeeded",
						remote_id: "agent_known",
						version: 4,
					},
					{
						type: "skill",
						id: "review",
						...(outcome === "unknown"
							? {
									status: "skipped" as const,
									error_details: {
										code: "resource.dependency_failed",
										phase: "prepare" as const,
										retryable: false,
										mutation_started: false,
									},
								}
							: { status: "succeeded" as const, remote_id: "skill_known", version: 1 }),
					},
				],
			},
		});
		await next(page).click();
		await expect(review(page)).toBeVisible();
		await confirm(page).click();
		const results = page.getByRole("region", { name: "资源发布结果", exact: true });
		await expect(results).toContainText("env_known");
		await expect(results).toContainText("agent_known · v4");
		if (outcome === "unknown") {
			await expect(results).toContainText("已跳过");
			await expect(results).toContainText("resource.dependency_failed");
		} else await expect(results).toContainText("skill_known · v1");
		await expect(status(page).getByRole("button", { name: "重新准备发布", exact: true })).toHaveCount(0);
		await status(page).getByRole("button", { name: "重新读取发布结果", exact: true }).click();
		await expect(status(page).getByRole("alert")).toContainText("此批次不能重新发布");
		await expect(results).toContainText("agent_known · v4");
		expect(state.publishes).toBe(1);
		expect(state.plans).toBe(1);
		expect(state.sessions).toBe(0);
		await expect(saveDialog(page)).toHaveCount(0);
	});
}

test("模版发布结果：执行前失败按服务端动作重新计划，仍须再次确认", async ({ page }) => {
	const state = await openTemplate(page, {
		operationStatus: "failed",
		recoveryAction: "replan",
		publication: {
			outcome: "failed",
			mutation_started: false,
			resources: [
				{
					type: "agent",
					id: "assistant",
					status: "failed",
					error_details: {
						code: "resource.prepare_failed",
						phase: "prepare",
						retryable: false,
						mutation_started: false,
					},
				},
			],
		},
	});
	await next(page).click();
	await confirm(page).click();
	await expect(page.getByRole("region", { name: "资源发布结果", exact: true })).toContainText(
		"resource.prepare_failed",
	);
	await status(page).getByRole("button", { name: "重新准备发布", exact: true }).click();
	await expect(review(page)).toBeVisible();
	expect(state.plans).toBe(2);
	expect(state.publishes).toBe(1);
	await review(page).getByRole("button", { name: "取消", exact: true }).click();
	expect(state.publishes).toBe(1);
});

function restoreFailedDraft(state: PublishFixture, action: "replan" | "finalize") {
	const draft = state.drafts.active!;
	expect(draft).toBeTruthy();
	draft.status = "failed";
	draft.recovery_action = action;
	draft.operation_id = "op_publish_1";
	state.publishes = 1;
	return draft;
}

test("发布恢复：报告读取失败仍可重新计划，且必须再次确认", async ({ page }) => {
	const state = await openTemplate(page, {
		operationStatus: "failed",
		operationReadError: true,
		recoveryAction: "replan",
	});
	restoreFailedDraft(state, "replan");
	await next(page).click();
	await expect(review(page)).toBeVisible();
	expect(state.plans).toBe(1);
	expect(state.publishes).toBe(1);
	expect(state.sessions).toBe(0);
	await review(page).getByRole("button", { name: "取消", exact: true }).click();
	await expect(status(page).getByRole("alert")).toContainText("资源发布结果明细暂不可用");
	expect(state.publishes).toBe(1);
});

test("发布恢复：报告读取失败不阻断已有成功证明的收尾", async ({ page }) => {
	const state = await openTemplate(page, {
		operationStatus: "failed",
		operationReadError: true,
		recoveryAction: "finalize",
	});
	restoreFailedDraft(state, "finalize");
	state.drafts.beforeFinalize = async (draft) => {
		draft.status = "published";
		draft.cleanup_pending = true;
	};
	await next(page).click();
	await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toBeVisible();
	expect(state.drafts.requests.filter((path) => path.endsWith("/finalize"))).toHaveLength(1);
	expect(state.plans).toBe(0);
	expect(state.publishes).toBe(1);
	await expect.poll(() => state.sessions).toBe(1);
});

test("发布恢复：finalize 的 409 保留原错误及收尾按钮，只重试收尾", async ({ page }) => {
	const state = await openTemplate(page, {
		operationStatus: "failed",
		recoveryAction: "finalize",
		publication: {
			outcome: "succeeded",
			mutation_started: true,
			resources: [{ type: "agent", id: "assistant", status: "succeeded", remote_id: "agent_known" }],
		},
	});
	restoreFailedDraft(state, "finalize");
	state.drafts.finalizeErrorStatus = 409;
	state.drafts.finalizeError = "已发布智能体缺少具体版本，已保留批次";
	await next(page).click();
	const retry = status(page).getByRole("button", { name: "重试清理", exact: true });
	await expect(retry).toBeVisible();
	await expect(status(page).getByRole("alert")).toContainText(state.drafts.finalizeError);
	await expect(status(page).getByRole("button", { name: "重新准备发布", exact: true })).toHaveCount(0);
	expect(state.plans).toBe(0);
	await retry.click();
	await expect(retry).toBeEnabled();
	expect(state.drafts.requests.filter((path) => path.endsWith("/finalize"))).toHaveLength(2);
	expect(state.plans).toBe(0);
	state.drafts.finalizeError = "";
	state.drafts.beforeFinalize = async (draft) => {
		draft.status = "published";
		draft.cleanup_pending = true;
	};
	await retry.click();
	await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toBeVisible();
	expect(state.plans).toBe(0);
	expect(state.publishes).toBe(1);
});

test("发布恢复：迟到的旧报告不能覆盖新发布结果", async ({ page }) => {
	const state = await openTemplate(page, { operationStatus: "failed", recoveryAction: "replan" });
	restoreFailedDraft(state, "replan");
	const started = Promise.withResolvers<void>();
	const released = Promise.withResolvers<void>();
	const delivered = Promise.withResolvers<void>();
	await page.route(`${apiBase}/api/admin/operations/op_publish_1`, async (route) => {
		started.resolve();
		await released.promise;
		await route.fulfill({
			json: {
				data: {
					operation_id: "op_publish_1",
					kind: "resourceDraft.publish",
					status: "failed",
					progress: 1,
					log: [],
					error: "old failure",
					created_at: timestamp,
					updated_at: timestamp,
					publication: {
						outcome: "failed",
						mutation_started: false,
						resources: [{ type: "agent", id: "old_attempt", status: "failed" }],
					},
				},
			},
		});
		delivered.resolve();
	});
	try {
		await next(page).click();
		await expect(review(page)).toBeVisible();
		await started.promise;
		state.operationStatus = "succeeded";
		state.recoveryAction = "none";
		state.publication = {
			outcome: "succeeded",
			mutation_started: true,
			resources: [{ type: "agent", id: "current_attempt", status: "succeeded", remote_id: "agent_new", version: 5 }],
		};
		await confirm(page).click();
		const results = page.getByRole("region", { name: "资源发布结果", exact: true });
		await expect(results).toContainText("agent_new · v5");
		released.resolve();
		await delivered.promise;
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		await expect(results).toContainText("agent_new · v5");
		await expect(results).not.toContainText("old_attempt");
		expect(state.publishes).toBe(2);
	} finally {
		released.resolve();
	}
});
