import { PROTOCOL_VERSION, type TemplateView } from "@openagentpack/kit-sdk/protocol";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN } from "./helpers.ts";

const apiBase = "https://template-fields.example/kit";
const headings = [
	"智能体名称",
	"模型",
	"Multi-Agent 模式",
	"描述",
	"系统提示词",
	"工具",
	"MCP 服务器",
	"技能",
	"环境",
	"文件",
	"记忆库",
	"密钥库",
	"保存时间",
	"状态",
	"上架时间",
	"操作",
];
const saved: TemplateView = {
	template_id: "tpl_fields",
	name: "项目助手",
	category: "coding",
	version: 1,
	remote_agent_id: "agent_shared",
	remote_agent_name: "来源智能体",
	agent_version: 1,
	remote_agent_version: 3,
	remote_environment_id: "env_project",
	remote_environment_name: "项目环境",
	files: [{ file_id: "file_guide", filename: "项目说明.txt", mount_path: "/mnt/session/guide.txt" }],
	memory_stores: [{ memory_store_id: "memory_project", access: "read_only", instructions: "只检索项目文档" }],
	vault_ids: ["vault_project"],
	description: "广场展示文案",
	suggested_prompts: [],
	created_at: "2026-11-01T01:00:00.000Z",
	updated_at: "2026-11-02T01:00:00.000Z",
	listing: {
		catalog_id: "cat_project",
		slug: "project",
		display_name: "项目助手",
		status: "listed",
		listed_at: "2026-11-03T01:00:00.000Z",
	},
};

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function replyAgentVersion(
	route: Route,
	version: number,
	options: {
		failFirst?: boolean;
		delay?: { started: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> };
	},
	state: { failed: boolean },
) {
	if (options.failFirst && !state.failed) {
		state.failed = true;
		return route.fulfill({ status: 502, json: { error: { code: "provider_error", message: "版本配置暂不可用" } } });
	}
	if (options.delay && version === 1) {
		options.delay.started.resolve();
		await options.delay.release.promise;
	}
	return route.fulfill({
		json: {
			data: {
				agent_id: "agent_shared",
				name: "来源智能体",
				version,
				description: `版本 ${version} 的基础描述`,
				configuration: {
					model: { id: `model_${version}`, name: `模型 ${version}` },
					instructions: `  版本 ${version} 的系统提示词\n按原文显示，不用广场文案替代。  `,
					multiagent: { type: "coordinator", agents: [{ type: "self" }] },
					tools: [
						{
							type: "builtin_toolkit",
							default_config: { enabled: true },
							configs: [
								{ name: "read", enabled: true },
								{ name: "write", enabled: false },
							],
						},
					],
					mcp_servers: [{ type: "official", name: "project_search" }],
					skills: [{ skill_id: "skill_project", name: "项目检索技能" }],
				},
			},
		},
	});
}

async function openList(
	page: Page,
	options: {
		rows?: (search: string) => TemplateView[];
		failFirst?: boolean;
		listDelay?: { started: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> };
		delay?: { started: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> };
	} = {},
) {
	const reads: string[] = [];
	const unexpected: string[] = [];
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	const state = { failed: false };
	const rows =
		options.rows ??
		(() => [
			saved,
			{ ...saved, template_id: "tpl_shared", name: "同配置助手" },
			{ ...saved, template_id: "tpl_legacy", name: "旧版助手", agent_version: undefined, remote_agent_version: 2 },
		]);
	await page.route(`${apiBase}/api/**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname.replace(/^\/kit/, "");
		if (path === "/api/config")
			return route.fulfill({ json: { data: { apiBaseUrl: apiBase, protocolVersion: PROTOCOL_VERSION } } });
		expect(request.headers().authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
		reads.push(path);
		if (request.method() !== "GET") unexpected.push(`${request.method()} ${path}`);
		if (path === "/api/admin/identity")
			return route.fulfill({ json: { data: { role: "admin", subject: "fields:test" } } });
		if (path === "/api/admin/templates") {
			options.listDelay?.started.resolve();
			await options.listDelay?.release.promise;
			return route.fulfill({
				json: {
					data: rows(url.searchParams.get("search") ?? ""),
				},
			});
		}
		if (path === "/api/admin/remote/memory-stores")
			return route.fulfill({ json: { data: [{ memory_store_id: "memory_project", name: "项目记忆" }] } });
		if (path === "/api/admin/remote/vaults")
			return route.fulfill({ json: { data: [{ vault_id: "vault_project", name: "项目密钥" }] } });
		const match = /\/remote\/agents\/agent_shared\/versions\/(\d+)$/.exec(path);
		if (match) return replyAgentVersion(route, Number(match[1]), options, state);
		unexpected.push(path);
		return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "不应读取此资源" } } });
	});
	const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.pathname = "/templates";
	url.searchParams.set("api", apiBase);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await expect(page.getByRole("heading", { name: "智能体管理", exact: true }))
		.toBeVisible()
		.catch((error) => {
			expect(pageErrors).toEqual([]);
			throw error;
		});
	return { reads, unexpected };
}

// 保护管理列表与创建预览的字段合同、保存版本、去重读取和运营列保持；不读取正文或凭据。
test("管理列表展示预览配置字段，按保存版本读取并保留运营列", async ({ page }) => {
	const listDelay = { started: deferred(), release: deferred() };
	const { reads, unexpected } = await openList(page, { listDelay });
	const list = page.getByRole("region", { name: "模版列表", exact: true });
	try {
		await listDelay.started.promise;
		await expect(list.getByRole("columnheader")).toHaveText(headings);
		await expect(list.locator('.ant-table-wrapper [aria-busy="true"]')).toBeVisible();
		await expect(list).not.toContainText("暂无模版");
	} finally {
		listDelay.release.resolve();
	}
	const row = list.getByRole("row").filter({ hasText: saved.name }).first();
	const cell = (name: string) => row.getByRole("cell").nth(headings.indexOf(name));
	await expect(cell("模型")).toHaveText("模型 1");
	await expect(list.locator('.ant-table-wrapper [aria-busy="true"]')).toHaveCount(0);
	await expect(cell("Multi-Agent 模式")).toHaveText("已开启");
	await expect(cell("描述")).toHaveText("版本 1 的基础描述");
	await expect(cell("系统提示词").locator("span[title]")).toHaveAttribute(
		"title",
		"  版本 1 的系统提示词\n按原文显示，不用广场文案替代。  ",
	);
	await expect(cell("工具")).toHaveText("read");
	await expect(cell("MCP 服务器")).toContainText("project_search");
	await expect(cell("技能")).toHaveText("项目检索技能");
	await expect(cell("环境")).toContainText("项目环境（env_project）");
	await expect(cell("文件")).toContainText("项目说明.txt");
	await expect(cell("文件")).toContainText("挂载路径：/mnt/session/guide.txt");
	await expect(cell("记忆库")).toContainText("项目记忆");
	await expect(cell("记忆库")).toContainText("权限：只读");
	await expect(cell("记忆库")).toContainText("说明：只检索项目文档");
	await expect(cell("密钥库")).toContainText("项目密钥");
	await expect(cell("保存时间").locator("time")).toHaveAttribute("datetime", saved.created_at);
	await expect(cell("状态")).toHaveText("已上架");
	await expect(cell("上架时间").locator("time")).toHaveAttribute("datetime", saved.listing!.listed_at!);
	await expect(cell("操作").getByRole("button", { name: `下架模版 ${saved.name}`, exact: true })).toBeEnabled();
	await expect(list.getByRole("row").filter({ hasText: "旧版助手" }).getByRole("cell").nth(1)).toHaveText("模型 2");
	expect(reads.filter((path) => path.endsWith("/agent_shared/versions/1"))).toHaveLength(1);
	expect(reads.filter((path) => path.endsWith("/agent_shared/versions/2"))).toHaveLength(1);
	expect(unexpected).toEqual([]);
	await page.screenshot({ path: test.info().outputPath("list-desktop.png") });
	await page.setViewportSize({ width: 390, height: 844 });
	await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await cell("操作")
		.getByRole("button", { name: `查看模版 ${saved.name}`, exact: true })
		.scrollIntoViewIfNeeded();
	await expect(cell("操作").getByRole("button", { name: `查看模版 ${saved.name}`, exact: true })).toBeInViewport();
	await page.screenshot({ path: test.info().outputPath("list-mobile.png") });
});

test("配置读取失败可重试，空运行资源不额外读取元数据", async ({ page }) => {
	const { reads, unexpected } = await openList(page, {
		failFirst: true,
		rows: () => [{ ...saved, files: [], memory_stores: [], vault_ids: [] }],
	});
	const row = page.getByRole("row").filter({ hasText: saved.name }).first();
	const model = row.getByRole("cell").nth(1);
	await expect(model.getByRole("button", { name: "加载失败，重试", exact: true })).toBeVisible();
	await expect(page.locator('.ant-table-wrapper [aria-busy="true"]')).toHaveCount(0);
	await expect(row.getByRole("cell").nth(13)).toHaveText("已上架");
	await model.getByRole("button", { name: "加载失败，重试", exact: true }).click();
	await expect(model).toHaveText("模型 1");
	for (const index of [9, 10, 11]) await expect(row.getByRole("cell").nth(index)).toHaveText("未选择");
	expect(reads.filter((path) => path.endsWith("/agent_shared/versions/1"))).toHaveLength(2);
	expect(reads).not.toContain("/api/admin/remote/memory-stores");
	expect(reads).not.toContain("/api/admin/remote/vaults");
	expect(unexpected).toEqual([]);
});

test("搜索切换后丢弃旧页迟到的配置读取", async ({ page }) => {
	const delay = { started: deferred(), release: deferred() };
	await openList(page, {
		delay,
		rows: (search) =>
			search === "无结果"
				? []
				: search
					? [{ ...saved, template_id: "tpl_new", name: "新助手", agent_version: 2 }]
					: [saved],
	});
	try {
		await delay.started.promise;
		await expect(page.locator('.ant-table-wrapper [aria-busy="true"]')).toBeVisible();
		await expect(page.getByRole("button", { name: `调试模版 ${saved.name}`, exact: true })).toBeDisabled();
		const cancelled = page.waitForEvent("requestfailed", (request) =>
			request.url().endsWith("/agent_shared/versions/1"),
		);
		await page.getByRole("searchbox", { name: "搜索模版", exact: true }).fill("新助手");
		const current = page.getByRole("row").filter({ hasText: "新助手" });
		await expect(current.getByRole("cell").nth(1)).toHaveText("模型 2");
		await expect(page.locator('.ant-table-wrapper [aria-busy="true"]')).toHaveCount(0);
		await cancelled;
		delay.release.resolve();
		await expect(page.getByRole("row").filter({ hasText: saved.name })).toHaveCount(0);
		await expect(current.getByRole("cell").nth(1)).toHaveText("模型 2");
		await page.getByRole("searchbox", { name: "搜索模版", exact: true }).fill("无结果");
		await expect(page.getByRole("cell", { name: /未找到匹配的模版/ })).toBeVisible();
		await expect(page.locator('.ant-table-wrapper [aria-busy="true"]')).toHaveCount(0);
	} finally {
		delay.release.resolve();
	}
});
