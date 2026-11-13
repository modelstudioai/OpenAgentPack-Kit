import {
	type CreateTemplateDebugSessionRequest,
	PROTOCOL_VERSION,
	type ProjectDeclaration,
	type TemplateCreateInput,
} from "@openagentpack/kit-sdk/protocol";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";
import {
	closeTemplateAgentPicker,
	confirmTemplateAgentSelection,
	installTemplateAgentDetailFixture,
	openTemplateAgentPicker,
} from "./template-agent-selection-helpers.ts";
import { openInlinePicker } from "./template-inline-helpers.ts";
import { draftId, draftProjectPath, draftReceipt, resourceDraftFixture } from "./template-resource-draft-fixture.ts";

const apiBase = "https://template-local-selection.example/kit";
const projectPath = draftProjectPath;
const sessionPath = "/api/admin/debug/sessions";
const revision = "local-revision";
const timestamp = "2026-11-01T12:00:00.000Z";
const resources = [
	{ type: "agent", id: "local-agent", name: "本地助手", remote_id: "agent_published", version: 4 },
	{ type: "environment", id: "local-env", name: "本地运行环境", remote_id: "env_published" },
	{ type: "file", id: "local-file", name: "说明.txt", remote_id: "file_published" },
	{ type: "memory_store", id: "local-memory", name: "本地记忆", remote_id: "memory_published" },
	{ type: "vault", id: "local-vault", name: "本地密钥库", remote_id: "vault_published" },
] as const;

function declarations(state: FixtureState): ProjectDeclaration[] {
	return resources
		.filter((resource) => state.resourceIds.includes(resource.id))
		.map((resource) => ({
			type: resource.type,
			id: resource.id,
			name: state.draftNames[resource.id] ?? resource.name,
			base_revision: revision,
			source_path: `${resource.type}/${resource.id}/resource.json`,
			declaration: {
				id: resource.id,
				name: state.draftNames[resource.id] ?? resource.name,
				...(resource.type === "environment" ? { config: { type: "cloud" } } : {}),
				...(resource.type === "agent" ? { model: "auto", instructions: "" } : {}),
				...(resource.type === "vault" ? { display_name: resource.name, credentials: [] } : {}),
			},
			read_only_paths: [["id"]],
			references: [],
		}));
}

interface FixtureState {
	draftNames: Record<string, string>;
	drafts: ReturnType<typeof resourceDraftFixture>;
	resourceIds: string[];
	seedCurrentDraft: boolean;
	includeCloudAgent: boolean;
	published: boolean;
	resolveError: boolean;
	duplicateFileBinding: boolean;
	resolveGate?: Promise<void>;
	fullLists: boolean;
	failEnvironmentAfterPublish: boolean;
	environmentReads: number;
	receiptReads: number;
	echoPublishedRemote: boolean;
	cleanupPending: boolean;
	writes: { path: string; body: unknown }[];
	sessions: CreateTemplateDebugSessionRequest[];
	saves: TemplateCreateInput[];
}

function respondCreate(route: Route, state: FixtureState, path: string, body: unknown) {
	const isAgent = path.endsWith("/agents");
	const resource = resources[isAgent ? 0 : 1];
	state.resourceIds.push(resource.id);
	const input = body as { name: string };
	state.draftNames[resource.id] = input.name;
	return route.fulfill({
		status: 201,
		json: {
			data: {
				new_revision: revision,
				[isAgent ? "agent" : "environment"]: {
					id: resource.id,
					name: input.name,
					source_path: `${resource.type}/${resource.id}/resource.json`,
				},
			},
		},
	});
}

async function respondWrite(route: Route, state: FixtureState, path: string) {
	const request = route.request();
	const body: unknown = request.postData() ? request.postDataJSON() : undefined;
	state.writes.push({ path, body });
	const matchedProject = /^\/api\/admin\/resource-drafts\/(resource-draft-\d+)\/resources(\/.*)?$/.exec(path);
	if (matchedProject) path = `${projectPath}${matchedProject[2] ?? ""}`;
	if ([`${projectPath}/agents`, `${projectPath}/environments`].includes(path))
		return respondCreate(route, state, path, body);
	if (path === `${projectPath}/validate`) return route.fulfill({ json: { data: { diagnostics: [], warnings: [] } } });
	if (path === `${projectPath}/build`)
		return route.fulfill({ json: { data: { project_revision: revision, moves: [] } } });
	if (path === `${projectPath}/plan`) {
		expect(body).toEqual({ action: "publish" });
		return route.fulfill({
			json: {
				data: {
					plan_id: "local-plan",
					confirm_token: "local-confirm",
					project_revision: revision,
					expires_at: Date.now() + 60_000,
					destructive: false,
					diff: resources
						.filter((resource) => state.resourceIds.includes(resource.id))
						.map(({ type, id }) => ({ resource: `${type}:${id}`, action: "create", destructive: false })),
				},
			},
		});
	}
	if (path === `${projectPath}/publish`) {
		expect(body).toEqual({ plan_id: "local-plan", confirm_token: "local-confirm" });
		finishPublish(state);
		return route.fulfill({ status: 202, json: { data: { operation_id: "local-operation" } } });
	}

	if (path === "/api/admin/templates") {
		state.saves.push(body as TemplateCreateInput);
		return route.fulfill({ status: 503, json: { error: { code: "provider_error", message: "保存暂不可用，请重试" } } });
	}
	if (path === sessionPath) {
		const input = body as CreateTemplateDebugSessionRequest;
		state.sessions.push(input);
		return route.fulfill({
			status: 201,
			json: {
				data: {
					...input,
					session_id: "session-local",
					source: "template",
					created_at: timestamp,
					status: "idle",
				},
			},
		});
	}
	if (path.startsWith(`${sessionPath}/`) && path.endsWith("/plan"))
		return route.fulfill({ json: { data: { plan_id: "cleanup", confirm_token: "cleanup-token", diff: [] } } });
	if (path.startsWith(`${sessionPath}/`) && request.method() === "DELETE")
		return route.fulfill({ json: { data: { deleted: true } } });
	return route.fulfill({ status: 500, json: { error: { code: "internal", message: `非预期写请求 ${path}` } } });
}

function finishPublish(state: FixtureState) {
	state.published = true;
	const receipt = state.drafts.active;
	if (!receipt) throw new Error("发布缺少当前草稿");
	receipt.status = "published";
	receipt.resources = publishedBindings(state);
	receipt.cleanup_pending = state.cleanupPending;
	receipt.operation_id = "local-operation";
	if (!state.cleanupPending) state.drafts.active = null;
}

function publishedBindings(state: FixtureState) {
	return resources
		.filter((resource) => state.resourceIds.includes(resource.id))
		.map((resource) => ({
			type: resource.type,
			id: resource.id,
			remote_id: state.duplicateFileBinding && resource.type === "file" ? "file_remote_0" : resource.remote_id,
			...(resource.type === "agent" ? { version: resource.version } : {}),
		}));
}

async function respondDraft(route: Route, state: FixtureState, path: string) {
	if (!path.startsWith("/api/admin/resource-drafts")) return false;
	if (route.request().method() === "GET" && !path.endsWith("/active")) {
		state.receiptReads += 1;
		await state.resolveGate;
	}
	state.drafts.readError = state.resolveError && state.receiptReads > 1 ? "发布回执暂不可读，请重试" : "";
	const previous = state.drafts.created;
	await state.drafts.handle(route, path);
	if (state.drafts.created > previous && (previous > 0 || !state.seedCurrentDraft)) state.resourceIds = [];
	return true;
}

function remoteResponses(state: FixtureState): Record<string, unknown> {
	return {
		"/api/admin/remote/agents": [
			...(state.published && state.echoPublishedRemote
				? [{ agent_id: "agent_published", name: "本地助手", version: 4 }]
				: []),
			...(state.includeCloudAgent ? [{ agent_id: "agent_cloud", name: "云端助手", version: 2 }] : []),
		],
		"/api/admin/remote/files": [
			...(state.published && state.echoPublishedRemote
				? [{ file_id: "file_published", filename: "说明.txt", available: true }]
				: []),
			...Array.from({ length: state.fullLists ? 10 : 1 }, (_, index) => ({
				file_id: `file_remote_${index}`,
				filename: index === 0 ? "说明.txt" : `资料${index}.txt`,
				available: true,
			})),
		],
		"/api/admin/remote/memory-stores":
			state.published && state.echoPublishedRemote
				? [{ memory_store_id: "memory_published", name: "本地记忆" }]
				: state.fullLists
					? Array.from({ length: 8 }, (_, index) => ({
							memory_store_id: `memory_remote_${index}`,
							name: `云端记忆${index}`,
						}))
					: [],
		"/api/admin/remote/vaults":
			state.published && state.echoPublishedRemote
				? [{ vault_id: "vault_published", name: "本地密钥库" }]
				: state.fullLists
					? Array.from({ length: 10 }, (_, index) => ({
							vault_id: `vault_remote_${index}`,
							name: `云端密钥库${index}`,
						}))
					: [],
	};
}

async function respondEnvironments(route: Route, state: FixtureState) {
	state.environmentReads += 1;
	if (state.published && state.failEnvironmentAfterPublish)
		return route.fulfill({ status: 503, json: { error: { code: "provider_error", message: "环境列表读取失败" } } });
	return route.fulfill({
		json: {
			data:
				state.published && state.echoPublishedRemote ? [{ environment_id: "env_published", name: "本地运行环境" }] : [],
		},
	});
}

function resourceConfiguration(state: FixtureState, path: string) {
	const declaration = /\/declarations\/([^/]+)\/([^/]+)$/.exec(path);
	if (declaration)
		return declarations(state).find((item) => item.type === declaration[1] && item.id === declaration[2]);
	if (/\/memory-stores\//.test(path))
		return { memory_store_id: path.split("/").at(-1), name: "本地记忆", description: "", entries: [] };
	if (path.startsWith("/api/admin/remote/environments/"))
		return { environment_id: path.split("/").at(-1), name: "本地运行环境", configuration: { type: "cloud" } };
	if (path.startsWith("/api/admin/remote/vaults/"))
		return { vault_id: path.split("/").at(-1), name: "本地密钥库", credentials: [] };
}

async function respondRead(route: Route, state: FixtureState, path: string) {
	const projectMatch = /^\/api\/admin\/resource-drafts\/resource-draft-\d+\/resources(\/.*)?$/.exec(path);
	if (projectMatch) path = `${projectPath}${projectMatch[1] ?? ""}`;
	if (path === "/api/admin/remote/environments") return respondEnvironments(route, state);
	const configuration = resourceConfiguration(state, path);
	if (configuration) return route.fulfill({ json: { data: configuration } });
	if (path.startsWith("/api/admin/operations/local-operation")) {
		if (state.drafts.active?.status === "publishing") finishPublish(state);
		const operation = {
			operation_id: "local-operation",
			kind: "resourceDraft.publish",
			status: "succeeded",
			progress: 1,
			log: [],
			created_at: timestamp,
			updated_at: timestamp,
		};
		return path.endsWith("/events")
			? route.fulfill({
					contentType: "text/event-stream",
					body: `event: operation\ndata: ${JSON.stringify(operation)}\n\n`,
				})
			: route.fulfill({ json: { data: operation } });
	}
	if (path.startsWith(`${sessionPath}/`) && path.endsWith("/stream"))
		return route.fulfill({
			contentType: "text/event-stream",
			body: 'event: ready\ndata: {"session_id":"session-local","replayed":0}\n\nevent: done\ndata: {"status":"idle"}\n\n',
		});
	if (path.endsWith("/threads")) return route.fulfill({ json: { data: [], next_page_token: null } });
	if (path.endsWith("/tool-approvals"))
		return route.fulfill({
			json: { data: { requires_action: false, batch_id: null, pending_call_ids: [], requests: [] } },
		});
	const responses: Record<string, unknown> = {
		"/api/admin/identity": { role: "admin", subject: "admin:local-selection" },
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
		[projectPath]: {
			name: state.drafts.active?.draft_id ?? draftId,
			project_revision: revision,
			aligned: state.published,
			active_mutation: null,
			remote_checked: false,
			drift: [],
			agents: [],
			environments: [],
		},
		[`${projectPath}/declarations`]: declarations(state),
		[`${projectPath}/declarations/agent/local-agent`]: declarations(state).find((entry) => entry.type === "agent"),
		[`${projectPath}/resource-bindings`]: { resources: [] },
		[`${projectPath}/agent-options`]: { base_revision: revision, skills: [], mcp_servers: [] },
		...remoteResponses(state),
	};

	return route.fulfill({ json: { data: responses[path] ?? [] } });
}

/** 保护本地选择经显式发布后解析成远端绑定的闭环；Provider 映射合同由服务端测试负责。 */
async function openTemplate(page: Page, options: Partial<FixtureState> = {}) {
	const state: FixtureState = {
		draftNames: {},
		drafts: resourceDraftFixture(),
		seedCurrentDraft: true,
		includeCloudAgent: false,
		resourceIds: resources.map((resource) => resource.id),
		published: false,
		resolveError: false,
		duplicateFileBinding: false,
		fullLists: false,
		failEnvironmentAfterPublish: false,
		environmentReads: 0,
		receiptReads: 0,
		echoPublishedRemote: false,
		cleanupPending: false,
		writes: [],
		sessions: [],
		saves: [],
		...options,
	};
	await installTemplateApi(page, state);
	await enterTemplateView(page);
	if (state.seedCurrentDraft && !state.drafts.active) {
		await page
			.getByRole("region", { name: "基础配置", exact: true })
			.getByRole("button", { name: "添加 Skill", exact: true })
			.click();
		await page
			.getByRole("dialog", { name: "选择 Skill", exact: true })
			.getByRole("button", { name: "完成", exact: true })
			.click();
		await openTemplateAgentPicker(page);
		await expect(page.getByRole("button", { name: /^选择智能体 本地助手（local:/ })).toBeVisible();
		await closeTemplateAgentPicker(page);
	}
	return state;
}

async function installTemplateApi(page: Page, state: FixtureState) {
	await page.route(`${apiBase}/api/**`, async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname.replace(/^\/kit/, "");
		if (path.endsWith("/config"))
			return route.fulfill({ json: { data: { apiBaseUrl: apiBase, protocolVersion: PROTOCOL_VERSION } } });
		expect(request.headers().authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
		if (await respondDraft(route, state, path)) return;
		return request.method() === "GET" ? respondRead(route, state, path) : respondWrite(route, state, path);
	});
}

async function enterTemplateView(page: Page, authenticated = false) {
	await installTemplateAgentDetailFixture(page, apiBase);
	const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.searchParams.set("api", apiBase);
	await page.goto(url.href);
	if (!authenticated) {
		await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
		await page.getByRole("button", { name: "进入", exact: true }).click();
	}
	await openConsoleNavigation(page);
	await page.getByTestId("template-create-tab").click();
	await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
	await page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true })
		.fill("本地资源模版");
}

async function chooseLocalResources(page: Page) {
	for (const [label, name] of [
		["智能体", "本地助手"],
		["环境", "本地运行环境"],
		["文件", "说明.txt"],
		["记忆库", "本地记忆"],
		["密钥库", "本地密钥库"],
	]) {
		if (label === "智能体") await openTemplateAgentPicker(page);
		else await openInlinePicker(page, label);
		const row = page.getByRole("button", { name: new RegExp(`^选择${label} ${name}（local:`) });
		await expect(row).toBeVisible();
		await row.click();
		if (label === "智能体") {
			await confirmTemplateAgentSelection(page);
			await expect(
				page.getByRole("region", { name: "基础配置", exact: true }).getByRole("region", { name: "版本", exact: true }),
			).toHaveText("版本--");
		} else if (label === "环境") {
			await page
				.getByRole("dialog", { name: "环境详情", exact: true })
				.getByRole("button", { name: "确认选择", exact: true })
				.click();
		} else {
			await expect(row).toHaveAttribute("aria-pressed", "true");
			await page
				.getByRole("dialog", { name: "选择配置", exact: true })
				.getByRole("button", { name: "确认选择", exact: true })
				.click();
		}
	}
	const memory = page.getByRole("region", { name: "记忆库", exact: true });
	await memory.getByRole("combobox", { name: "权限", exact: true }).selectOption("read_only");
	await memory.getByRole("textbox", { name: "说明", exact: true }).fill("保留本地记忆说明");
}

async function confirmPublish(page: Page) {
	await page
		.locator('footer[aria-label="模版配置操作"]')
		.getByRole("button", { name: /^(下一步：预览调试|保存智能体|保存修改)$/, includeHidden: true })
		.click();
	const dialog = page.getByRole("dialog", { name: "确认发布", exact: true });
	await expect(dialog).toContainText("agent:local-agent");
	await dialog.getByRole("button", { name: "确认发布", exact: true }).click();
}

/** 在 HTTP 失败边界读取提交值，保留配置以验证后续重选；真实保存成功由集成用例覆盖。 */
async function inspectSave(page: Page, state: FixtureState) {
	const dialog = page.getByRole("dialog", { name: "保存智能体", exact: true });
	await page.getByRole("button", { name: "保存智能体", exact: true }).click();
	await expect(dialog).toBeVisible();
	expect(state.sessions.length).toBeGreaterThan(0);
	await dialog.getByRole("button", { name: "保存", exact: true }).click();
	await expect(dialog.getByRole("alert")).toContainText("保存暂不可用，请重试");
}

async function expectPublishedCandidates(page: Page, selectedVersion = 4) {
	for (const [label, resource] of [
		["智能体", resources[0]],
		["环境", resources[1]],
		["文件", resources[2]],
		["记忆库", resources[3]],
		["密钥库", resources[4]],
	] as const) {
		if (label === "智能体") await openTemplateAgentPicker(page);
		else await openInlinePicker(page, label);
		const row = page.getByRole("button", {
			name: `选择${label} ${resource.name}（${resource.remote_id}）`,
			exact: true,
		});
		await expect(row).toHaveCount(1);
		await expect(row).toBeVisible();
		await expect(row.locator("..")).not.toContainText("待发布");
		await expect(page.getByRole("button", { name: new RegExp(`^选择${label} .+（local:`) })).toHaveCount(0);
		if (label === "智能体") {
			await expect(row.locator("..")).toContainText(`v${selectedVersion}`);
			await closeTemplateAgentPicker(page);
		} else
			await page
				.getByRole("dialog", { name: "选择配置", exact: true })
				.getByRole("button", { name: "关闭选择配置", exact: true })
				.click();
	}
}

test("本地资源选择：当前草稿声明可搜索重选，发布后用远端绑定和具体版本保存", async ({ page }) => {
	const gate = Promise.withResolvers<void>();
	const state = await openTemplate(page, { resolveGate: gate.promise, failEnvironmentAfterPublish: true });
	await chooseLocalResources(page);
	const filePicker = await openInlinePicker(page, "文件");
	await page.getByRole("button", { name: "选择文件 说明.txt（file_remote_0）", exact: true }).click();
	const fileSection = filePicker;
	await fileSection.getByRole("searchbox", { name: "搜索文件", exact: true }).fill("local-file");
	const localFile = fileSection.getByRole("button", { name: /^选择文件 说明.txt（local:/ });
	await localFile.click();
	await expect(localFile).toHaveAttribute("aria-pressed", "false");
	await localFile.click();
	await expect(localFile).toHaveAttribute("aria-pressed", "true");
	await filePicker.getByRole("button", { name: "确认选择", exact: true }).click();
	const summary = page.getByRole("region", { name: "已选配置预览", exact: true });
	for (const text of ["本地运行环境", "本地记忆", "本地密钥库", "待发布", "保留本地记忆说明", "说明-2.txt"])
		await expect(summary).toContainText(text);
	expect(state.writes).toEqual([]);
	await confirmPublish(page);
	try {
		await expect.poll(() => state.receiptReads).toBe(1);
		expect(state.sessions).toEqual([]);
		await expect(
			page
				.locator('footer[aria-label="模版配置操作"]')
				.getByRole("button", { name: /^(下一步：预览调试|保存智能体|保存修改)$/, includeHidden: true }),
		).toBeDisabled();
	} finally {
		gate.resolve();
	}
	await inspectSave(page, state);
	expect(state.receiptReads).toBe(2);
	expect(state.writes.some(({ path }) => path.includes("resource-bindings"))).toBe(false);
	expect(state.sessions.length).toBeGreaterThan(0);
	expect(state.saves[0]).toMatchObject({
		remote_agent_id: "agent_published",
		agent_version: 4,
		remote_environment_id: "env_published",
		files: expect.arrayContaining([
			{ file_id: "file_published", mount_path: "/mnt/session/uploads/说明.txt" },
			{ file_id: "file_remote_0", mount_path: "/mnt/session/uploads/说明-2.txt" },
		]),
		memory_stores: [{ memory_store_id: "memory_published", access: "read_only", instructions: "保留本地记忆说明" }],
		vault_ids: ["vault_published"],
	});
	expect(JSON.stringify(state.saves)).not.toContain("local:");
	await page
		.getByRole("dialog", { name: "保存智能体", exact: true })
		.getByRole("button", { name: "取消", exact: true })
		.click();
	await page.getByRole("button", { name: "上一步：选择配置", exact: true }).click();
	await expect(
		page.getByRole("region", { name: "基础配置", exact: true }).getByRole("region", { name: "版本", exact: true }),
	).toContainText("v4");
	await expect(summary).not.toContainText("待发布");
	const environment = await openInlinePicker(page, "环境");
	const selected = environment.getByRole("button", { name: "选择环境 本地运行环境（env_published）", exact: true });
	await expect(environment.getByRole("alert")).toContainText("环境列表读取失败");
	await expect(selected).toHaveAttribute("aria-pressed", "true");
	const readsBeforeRetry = state.environmentReads;
	state.failEnvironmentAfterPublish = false;
	await environment.getByRole("button", { name: "重试", exact: true }).click();
	await expect.poll(() => state.environmentReads).toBe(readsBeforeRetry + 1);
	await expect(environment.getByRole("alert")).toHaveCount(0);
	await expect(selected).toHaveAttribute("aria-pressed", "true");
	await environment.getByRole("button", { name: "关闭选择配置", exact: true }).click();
	await expect(summary).toContainText("env_published");
	await page
		.locator('footer[aria-label="模版配置操作"]')
		.getByRole("button", { name: /^(下一步：预览调试|保存智能体|保存修改)$/, includeHidden: true })
		.click();
	await inspectSave(page, state);
	expect(state.drafts.requests.filter((request) => request.endsWith("/discard"))).toEqual([]);
	expect(state.sessions.length).toBeGreaterThan(0);
});

test("本地资源选择：绑定解析失败保留草稿，重试解析不再次发布", async ({ page }) => {
	const state = await openTemplate(page, { resolveError: true });
	await chooseLocalResources(page);
	await confirmPublish(page);
	await expect(page.getByRole("alert")).toContainText("发布回执暂不可读");
	const summary = page.getByRole("region", { name: "已选配置预览", exact: true });
	for (const name of ["本地运行环境", "说明.txt", "本地记忆", "本地密钥库", "保留本地记忆说明", "待发布"])
		await expect(summary).toContainText(name);
	await expect(page.getByRole("textbox", { name: "环境名称", exact: true })).toHaveValue("本地运行环境");
	await expect(
		page
			.getByRole("region", { name: "展示配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true }),
	).toHaveValue("本地资源模版");
	expect(state.sessions).toEqual([]);
	state.resolveError = false;
	await page.getByRole("button", { name: "重试读取资源", exact: true }).click();
	await inspectSave(page, state);
	expect(state.receiptReads).toBe(3);
	expect(state.writes.filter(({ path }) => path.endsWith("/publish"))).toHaveLength(1);
	expect(state.writes.filter(({ path }) => path.endsWith("/build"))).toHaveLength(0);
	expect(state.sessions.length).toBeGreaterThan(0);
});

test("本地资源选择：本地和云端候选解析为同一文件时阻止保存并保留选择", async ({ page }) => {
	const state = await openTemplate(page, { duplicateFileBinding: true });
	await chooseLocalResources(page);
	const picker = await openInlinePicker(page, "文件");
	const remoteFile = page.getByRole("button", { name: "选择文件 说明.txt（file_remote_0）", exact: true });
	await remoteFile.click();
	await expect(remoteFile).toHaveAttribute("aria-pressed", "true");
	await picker.getByRole("button", { name: "确认选择", exact: true }).click();
	await confirmPublish(page);
	await expect(page.getByRole("alert")).toContainText("所选本地配置与云端条目指向同一资源");
	await expect(page.getByRole("region", { name: "文件", exact: true }).getByRole("listitem")).toHaveCount(2);
	await expect(page.getByRole("region", { name: "已选配置预览", exact: true })).toContainText("待发布");
	await openInlinePicker(page, "文件");
	await expect(remoteFile).toHaveAttribute("aria-pressed", "true");
	await picker.getByRole("button", { name: "取消", exact: true }).click();
	expect(state.receiptReads).toBe(2);
	expect(state.sessions).toEqual([]);
});

test("本地资源选择：读取回执后全部候选同步，重进与刷新合并云端资源", async ({ page }) => {
	const state = await openTemplate(page, { echoPublishedRemote: true });
	await openTemplateAgentPicker(page);
	await page.getByRole("button", { name: /^选择智能体 本地助手（local:/ }).click();
	await confirmTemplateAgentSelection(page);
	await expect(page.getByRole("region", { name: "已选配置预览", exact: true })).toContainText("使用智能体默认环境");
	await expect(
		page
			.locator('footer[aria-label="模版配置操作"]')
			.getByRole("button", { name: /^(下一步：预览调试|保存智能体|保存修改)$/, includeHidden: true }),
	).toBeEnabled();
	await confirmPublish(page);
	await inspectSave(page, state);
	expect(state.receiptReads).toBe(2);
	expect(state.sessions.length).toBeGreaterThan(0);
	expect(state.saves[0]).toMatchObject({ remote_agent_id: "agent_published", agent_version: 4 });
	expect(state.saves[0]).not.toHaveProperty("remote_environment_id");
	await page
		.getByRole("dialog", { name: "保存智能体", exact: true })
		.getByRole("button", { name: "取消", exact: true })
		.click();
	await page.getByRole("button", { name: "上一步：选择配置", exact: true }).click();
	await expectPublishedCandidates(page);
	for (const label of ["环境", "文件", "记忆库", "密钥库"])
		await expect(
			page.getByRole("region", { name: label, exact: true }).getByRole("button", { pressed: true }),
		).toHaveCount(0);
	await page.getByTestId("template-list-tab").click();
	await page.getByTestId("template-create-tab").click();
	await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
	const agent = page.getByRole("button", { name: "选择智能体 本地助手（agent_published）", exact: true });
	await openTemplateAgentPicker(page);
	await expect(agent).toHaveCount(1);
	await agent.click();
	await confirmTemplateAgentSelection(page);
	await expectPublishedCandidates(page);
	await expect(
		page.getByRole("region", { name: "基础配置", exact: true }).getByRole("region", { name: "版本", exact: true }),
	).toContainText("v4");
	await page.reload();
	await page.getByTestId("template-create-tab").click();
	await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
	await openTemplateAgentPicker(page);
	await expect(agent).toHaveCount(1);
	await agent.click();
	await confirmTemplateAgentSelection(page);
	await expectPublishedCandidates(page);
	await expect(
		page.getByRole("region", { name: "基础配置", exact: true }).getByRole("region", { name: "版本", exact: true }),
	).toContainText("v4");
	expect(state.drafts.receipts.get(draftId)?.status).toBe("published");
	expect(state.drafts.discarded).toEqual([]);
	expect(state.writes.filter(({ path }) => path.endsWith("/publish"))).toHaveLength(1);
});

test("隔离资源草稿：智能体与环境共用当前草稿，发布成功后下一次新建使用新草稿", async ({ page }) => {
	const state = await openTemplate(page, { seedCurrentDraft: false, resourceIds: [] });
	await createAgent(page);
	await createEnvironment(page, "本地运行环境");
	const summary = page.getByRole("region", { name: "已选配置预览", exact: true });
	await expect(
		page
			.getByRole("region", { name: "基础配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true }),
	).toHaveValue("本地助手");
	await expect(summary).toContainText("本地运行环境");
	expect(state.drafts.created).toBe(1);
	expect(state.writes.filter(({ path }) => /\/(agents|environments)$/.test(path)).map(({ path }) => path)).toEqual([
		`${projectPath}/agents`,
		`${projectPath}/environments`,
	]);
	await confirmPublish(page);
	await inspectSave(page, state);
	expect(state.saves[0]).toMatchObject({
		remote_agent_id: "agent_published",
		agent_version: 4,
		remote_environment_id: "env_published",
	});
	expect(state.drafts.active).toBeNull();
	await page
		.getByRole("dialog", { name: "保存智能体", exact: true })
		.getByRole("button", { name: "取消", exact: true })
		.click();
	await page.getByRole("button", { name: "上一步：选择配置", exact: true }).click();
	await createEnvironment(page, "下轮运行环境");
	await expect(page.getByRole("textbox", { name: "环境名称", exact: true })).toHaveValue("下轮运行环境");
	await expect(summary).toContainText("下轮运行环境");
	await expect(
		page.getByRole("region", { name: "基础配置", exact: true }).getByRole("region", { name: "版本", exact: true }),
	).toContainText("v4");
	expect(state.drafts.created).toBe(2);
	expect(state.writes.filter(({ path }) => path.endsWith("/environments")).map(({ path }) => path)).toEqual([
		`${projectPath}/environments`,
		"/api/admin/resource-drafts/resource-draft-2/resources/environments",
	]);
	expect(state.writes.filter(({ path }) => path.endsWith("/publish"))).toHaveLength(1);
	expect(state.writes.some(({ path }) => path.startsWith("/api/admin/projects/project/"))).toBe(false);
});

async function createAgent(page: Page) {
	const templateName = page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true });
	if (!(await templateName.inputValue()).trim()) await templateName.fill("本地资源模版");
	const agent = page.getByRole("region", { name: "基础配置", exact: true });
	await agent.getByRole("textbox", { name: "智能体名称", exact: true }).fill("本地助手");
	await agent.getByRole("button", { name: "模型", exact: true }).click();
	await page.getByRole("option", { name: "Qwen3.8-Max", exact: true }).click();
	await page.getByRole("button", { name: "下一步：预览调试", exact: true }).click();
	const review = page.getByRole("dialog", { name: "确认发布", exact: true });
	await expect(review).toBeVisible();
	await review.getByRole("button", { name: "取消", exact: true }).click();
	await expect(agent.getByRole("textbox", { name: "智能体名称", exact: true })).toHaveValue("本地助手");
}

async function createEnvironment(page: Page, name: string) {
	await page.getByRole("textbox", { name: "环境名称", exact: true }).fill(name);
	await page.getByRole("button", { name: "下一步：预览调试", exact: true }).click();
	const review = page.getByRole("dialog", { name: "确认发布", exact: true });
	await expect(review).toBeVisible();
	await review.getByRole("button", { name: "取消", exact: true }).click();
}

test("隔离资源草稿：取消导入保留已保存资源，离页丢弃后重进开启新批次", async ({ page }) => {
	const state = await openTemplate(page, { seedCurrentDraft: false, resourceIds: [] });
	await createAgent(page);
	await createEnvironment(page, "本地运行环境");
	const environmentPicker = await openInlinePicker(page, "环境");
	await environmentPicker.getByRole("button", { name: "关闭选择配置", exact: true }).click();
	await expect(page.getByRole("region", { name: "已选配置预览", exact: true })).toContainText("本地运行环境");
	expect(state.drafts.requests.filter((request) => request.endsWith("/discard"))).toEqual([]);
	await page.getByTestId("template-create-tab").click();
	await expect(page.getByRole("alertdialog", { name: "确认退出", exact: true })).toHaveCount(0);
	await page.getByTestId("template-list-tab").click();
	const exit = page.getByRole("alertdialog", { name: "确认退出", exact: true });
	await expect(exit.getByText("退出后未发布的内容将被清空，是否确认退出？", { exact: true })).toBeVisible();
	await exit.getByRole("button", { name: "取消", exact: true }).click();
	await expect(exit).toHaveCount(0);
	await expect(
		page
			.getByRole("region", { name: "展示配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true }),
	).toHaveValue("本地资源模版");
	await expect(page.getByRole("region", { name: "已选配置预览", exact: true })).toContainText("本地运行环境");
	expect(state.drafts.discarded).toEqual([]);
	await page.getByTestId("template-list-tab").click();
	await exit.press("Escape");
	await expect(exit).toHaveCount(0);
	expect(state.drafts.discarded).toEqual([]);
	await page.getByTestId("template-list-tab").click();
	await exit.getByRole("button", { name: "确认退出", exact: true }).click();
	await expect.poll(() => state.drafts.discarded).toEqual([draftId]);
	expect(state.drafts.active).toBeNull();
	expect(state.drafts.receipts.has(draftId)).toBe(false);
	await page.getByTestId("template-create-tab").click();
	await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
	await openTemplateAgentPicker(page);
	await expect(page.getByRole("button", { name: /^选择智能体 .+（local:/ })).toHaveCount(0);
	await closeTemplateAgentPicker(page);
	await expect(page.getByRole("region", { name: "已选配置预览", exact: true })).toHaveCount(0);
	await createAgent(page);
	await openTemplateAgentPicker(page);
	await expect(
		page.getByRole("button", { name: "选择智能体 本地助手（local:resource-draft-2:agent:local-agent）", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await closeTemplateAgentPicker(page);
	expect(state.drafts.created).toBe(2);
	expect(state.drafts.active?.draft_id).toBe("resource-draft-2");
	expect(state.writes.filter(({ path }) => path.endsWith("/publish"))).toEqual([]);
	expect(state.sessions).toEqual([]);
});

test("隔离资源草稿：未保存资源的空批次离页无需确认", async ({ page }) => {
	const state = await openTemplate(page, { seedCurrentDraft: false, resourceIds: [] });
	const section = page.getByRole("region", { name: "基础配置", exact: true });
	await section.getByRole("button", { name: "添加 Skill", exact: true }).click();
	await page
		.getByRole("dialog", { name: "选择 Skill", exact: true })
		.getByRole("button", { name: "完成", exact: true })
		.click();
	expect(state.drafts.created).toBe(1);
	await page.getByTestId("template-list-tab").click();
	await expect(page.getByRole("alertdialog", { name: "确认退出", exact: true })).toHaveCount(0);
	await expect.poll(() => state.drafts.discarded).toEqual([draftId]);
});

test("隔离资源草稿：清理失败保留回执与选择，重试清理不再次发布", async ({ page }) => {
	const drafts = resourceDraftFixture();
	drafts.finalizeError = "临时目录清理失败";
	const state = await openTemplate(page, { drafts, cleanupPending: true });
	await chooseLocalResources(page);
	await confirmPublish(page);
	await expect(page.getByRole("alert")).toContainText("临时目录清理失败");
	await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toHaveCount(0);
	await expect(page.getByRole("region", { name: "已选配置预览", exact: true })).toContainText("本地运行环境");
	expect(state.drafts.receipts.get(draftId)?.resources).toHaveLength(5);
	expect(state.drafts.receipts.get(draftId)?.status).toBe("published");
	expect(state.sessions).toEqual([]);
	drafts.finalizeError = "";
	await page.getByRole("button", { name: "重试清理", exact: true }).click();
	await inspectSave(page, state);
	expect(state.writes.filter(({ path }) => path.endsWith("/publish"))).toHaveLength(1);
	expect(state.writes.filter(({ path }) => path.endsWith("/build"))).toHaveLength(0);
	expect(state.drafts.requests.filter((request) => request.endsWith("/finalize"))).toHaveLength(2);
	expect(state.drafts.active).toBeNull();
	expect(state.saves[0]).toMatchObject({
		remote_agent_id: "agent_published",
		remote_environment_id: "env_published",
	});
});

test("隔离资源草稿：重进未完成发布时无需重新选择智能体也可恢复回执", async ({ page }) => {
	const pending = draftReceipt();
	pending.status = "publishing";
	pending.operation_id = "local-operation";
	const state = await openTemplate(page, { drafts: resourceDraftFixture(pending) });
	await page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true })
		.fill("");
	await expect(
		page
			.locator('footer[aria-label="模版配置操作"]')
			.getByRole("button", { name: /^(下一步：预览调试|保存智能体|保存修改)$/, includeHidden: true }),
	).toBeDisabled();
	await page.getByRole("button", { name: "恢复资源发布", exact: true }).click();
	await openTemplateAgentPicker(page);
	const agent = page.getByRole("button", { name: /选择智能体 .+（agent_published）/ });
	await expect(agent).toBeEnabled();
	await expect(agent.locator("..")).not.toContainText("待发布");
	await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toHaveCount(0);
	expect(state.writes).toEqual([]);
	expect(state.drafts.active).toBeNull();
	await agent.click();
	await confirmTemplateAgentSelection(page);
	await page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true })
		.fill("恢复发布后的模版");
	await page
		.locator('footer[aria-label="模版配置操作"]')
		.getByRole("button", { name: /^(下一步：预览调试|保存智能体|保存修改)$/, includeHidden: true })
		.click();
	await inspectSave(page, state);
	expect(
		state.writes.filter(({ path }) => path.includes("/projects/") || /\/resource-drafts\/[^/]+\/resources/.test(path)),
	).toEqual([]);
	expect(state.saves[0]).toMatchObject({ remote_agent_id: "agent_published", agent_version: 4 });
});

test("隔离资源草稿：第二个标签页不能接管或丢弃首个标签的草稿，但可保存云端资源", async ({ page }) => {
	const state = await openTemplate(page, { seedCurrentDraft: false, resourceIds: [], includeCloudAgent: true });
	await createAgent(page);
	const initialWrites = state.writes.length;
	const other = await page.context().newPage();
	try {
		await installTemplateApi(other, state);
		await enterTemplateView(other, true);
		await expect(other.getByRole("alert")).toContainText("另一个页面正在创建资源，请先退出该页面后重试。");
		await openTemplateAgentPicker(other);
		await expect(other.getByRole("button", { name: /^选择智能体 .+（local:/ })).toHaveCount(0);
		await openTemplateAgentPicker(other);
		await other.getByRole("button", { name: "选择智能体 云端助手（agent_cloud）", exact: true }).click();
		await confirmTemplateAgentSelection(other);
		await other
			.locator('footer[aria-label="模版配置操作"]')
			.getByRole("button", { name: /^(下一步：预览调试|保存智能体|保存修改)$/, includeHidden: true })
			.click();
		await inspectSave(other, state);
		expect(state.saves[0]).toMatchObject({ remote_agent_id: "agent_cloud", agent_version: 2 });
		expect(state.writes.slice(initialWrites).filter(({ path }) => /\/(build|plan|publish)$/.test(path))).toEqual([]);
	} finally {
		await other.close();
	}
	await createEnvironment(page, "本地运行环境");
	expect(state.drafts.active?.draft_id).toBe(draftId);
	expect(state.drafts.created).toBe(1);
	expect(state.drafts.discarded).toEqual([]);
	await page.getByTestId("template-list-tab").click();
	await page
		.getByRole("alertdialog", { name: "确认退出", exact: true })
		.getByRole("button", { name: "确认退出", exact: true })
		.click();
	await expect.poll(() => state.drafts.discarded).toEqual([draftId]);
});
