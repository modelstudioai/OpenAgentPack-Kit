import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogAgentView, PlanResponse, TemplatesPage, TemplateView } from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const close of cleanup.splice(0).reverse()) close();
});
const headers = { authorization: "Bearer template-admin", "content-type": "application/json" };
const selected = {
	remote_agent_id: "agent_mock_assistant",
	remote_environment_id: "env_mock_analysis",
	category: "general" as const,
};

function setup() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-saved-templates-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_AUTH_MODE: "anonymous",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "template-admin",
		KIT_ADMIN_TOKENS: "auditor:auditor",
		KIT_RATE_LIMIT_RPS: "0",
	});
	function reopen() {
		const db = openDatabase(dataDir);
		cleanup.push(() => db.close());
		const services = createKitServices(config, db);
		return { app: createApp(services), services, db };
	}
	return { ...reopen(), reopen };
}

type App = ReturnType<typeof setup>["app"];
function request(app: App, path: string, body?: unknown, authorization = headers.authorization) {
	return app.request(path, {
		method: body === undefined ? "GET" : "POST",
		headers: { ...headers, authorization },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}
async function created(app: App, input: unknown): Promise<TemplateView> {
	const response = await request(app, "/api/admin/templates", input);
	expect(response.status, await response.clone().text()).toBe(201);
	return ((await response.json()) as { data: TemplateView }).data;
}
async function list(app: App, query = ""): Promise<TemplatesPage> {
	const response = await request(app, `/api/admin/templates${query}`);
	expect(response.status).toBe(200);
	return response.json() as Promise<TemplatesPage>;
}
async function listTemplate(app: App, template: TemplateView): Promise<CatalogAgentView> {
	const path = `/api/admin/templates/${template.template_id}/listing`;
	const input = { display_name: template.name };
	const prepared = await request(app, `${path}/plan`, input);
	expect(prepared.status).toBe(200);
	const { data: plan } = (await prepared.json()) as { data: PlanResponse };
	const response = await request(app, path, { ...input, plan_id: plan.plan_id, confirm_token: plan.confirm_token });
	expect(response.status).toBe(200);
	return ((await response.json()) as { data: CatalogAgentView }).data;
}

describe("已保存模版目录", () => {
	// 保护保存→重启→列表/详情，资源快照只保留公开引用，不依赖 Provider 在线。
	it("完整配置持久化，资源元数据由服务端校准，不建会话或上架", async () => {
		const { app, services, db, reopen } = setup();
		const file = await services.gateway.uploadFile({ filename: "guide.txt", bytes: new Uint8Array([1, 2]) });
		const createSession = vi.spyOn(services.gateway, "createSession");
		const input = {
			name: "  项目助手模版  ",
			...selected,
			files: [{ file_id: file.file_id, filename: "伪造名称.txt", size: 999 }],
			memory_stores: [
				{ memory_store_id: "memory-guide", access: "read_only", instructions: "  查项目资料  " },
				{ memory_store_id: "memory-notes", access: "read_write" },
			],
			vault_ids: ["vlt_mock_1", "vlt_mock_2"],
			description: "项目问答和进展总结",
			opening_remarks: "你好\n需要哪方面帮助？",
			suggested_prompts: ["总结项目进展", "查找项目资料"],
		};
		const template = await created(app, input);
		expect(template).toMatchObject({
			...input,
			name: "项目助手模版",
			remote_agent_name: "assistant",
			remote_agent_version: 1,
			remote_environment_name: "数据分析环境",
			files: [{ file_id: file.file_id, filename: "guide.txt", size: 2, mount_path: "/mnt/session/uploads/guide.txt" }],
			memory_stores: [
				{ memory_store_id: "memory-guide", access: "read_only", instructions: "查项目资料" },
				{ memory_store_id: "memory-notes", access: "read_write" },
			],
		});
		expect(createSession).not.toHaveBeenCalled();
		expect(services.catalog.all()).toEqual([]);
		expect(db.prepare("SELECT count(*) AS count FROM kit_sessions").get()?.count).toBe(0);
		const restarted = reopen();
		vi.spyOn(restarted.services.gateway, "listRemoteAgents").mockRejectedValue(new Error("Provider offline"));
		expect((await list(restarted.app)).data).toEqual([template]);
		const detail = await request(restarted.app, `/api/admin/templates/${template.template_id}`);
		expect(detail.status).toBe(200);
		expect(await detail.json()).toEqual({ data: template });
		expect(detail.headers.get("cache-control")).toBe("no-store");
		const audit = services.audit.list().filter((row) => row.action === "templates.create");
		expect(audit).toHaveLength(1);
		expect(audit[0]).toMatchObject({
			target: template.template_id,
			detail: JSON.stringify({ name: template.name, version: template.version }),
		});
		expect(audit[0]?.subject).toMatch(/^admin:admin:[0-9a-f]{8}$/);
	});

	// 保护重名并发与列表分页：不会覆盖已存配置，搜索按字面量，游标不能跨查询复用。
	it("重名保存返回冲突，分页搜索不遗漏配置且无效游标被拒", async () => {
		const { app } = setup();
		const attempts = await Promise.all([
			request(app, "/api/admin/templates", { ...selected, name: " 团队_one " }),
			request(app, "/api/admin/templates", { ...selected, name: "团队_one" }),
		]);
		expect(attempts.map((response) => response.status).sort()).toEqual([201, 409]);
		await created(app, { ...selected, name: "团队_two" });
		await created(app, { ...selected, name: "团队Xthree" });
		const query = `?search=${encodeURIComponent("团队_")}&limit=1`;
		const first = await list(app, query);
		expect(first.data).toHaveLength(1);
		expect(first.next_page_token).toBeTruthy();
		const second = await list(app, `${query}&page_token=${first.next_page_token}`);
		expect(second.next_page_token).toBeUndefined();
		expect(new Set([...first.data, ...second.data].map((item) => item.name))).toEqual(
			new Set(["团队_one", "团队_two"]),
		);
		expect((await list(app, "?search=agent_mock_assistant")).data).toHaveLength(3);
		expect((await list(app, "?search=assistant")).data).toHaveLength(3);
		for (const query of [`?search=other&page_token=${first.next_page_token}`, "?page_token=malformed", "?limit=0"]) {
			expect((await request(app, `/api/admin/templates${query}`)).status).toBe(400);
		}
		expect((await list(app, "?search=missing")).data).toEqual([]);
		expect((await request(app, "/api/admin/templates/missing")).status).toBe(404);
	});

	// 状态筛选必须先于分页，使用当前 Catalog；未关联和已删除条目都归为未上架。
	it("上架状态与搜索共同筛选完整分页，状态变更立即生效且不依赖 Provider", async () => {
		const { app, services } = setup();
		const first = await created(app, { ...selected, name: "筛选_上架一" });
		const draft = await created(app, { ...selected, name: "筛选_未上架" });
		const second = await created(app, { ...selected, name: "筛选_上架二" });
		const unlisted = await created(app, { ...selected, name: "筛选_已下架" });
		const removed = await created(app, { ...selected, name: "筛选_关联删除" });
		const outside = await created(app, { ...selected, name: "其他模版" });
		const firstEntry = await listTemplate(app, first);
		await listTemplate(app, second);
		const unlistedEntry = await listTemplate(app, unlisted);
		const removedEntry = await listTemplate(app, removed);
		await listTemplate(app, outside);
		services.catalog.setStatus(unlistedEntry.slug, "unlisted");
		services.catalog.remove(removedEntry.id);
		vi.spyOn(services.gateway, "listRemoteAgents").mockRejectedValue(new Error("Provider offline"));
		const search = `search=${encodeURIComponent("筛选_")}`;
		for (const [status, expected] of [
			["listed", [first, second]],
			["unlisted", [draft, unlisted, removed]],
		] as const) {
			const seen: string[] = [];
			let token: string | undefined;
			for (let page = 0; page < expected.length; page++) {
				const result = await list(app, `?${search}&status=${status}&limit=1${token ? `&page_token=${token}` : ""}`);
				expect(result.data).toHaveLength(1);
				seen.push(...result.data.map((item) => item.template_id));
				token = result.next_page_token;
				expect(Boolean(token)).toBe(page < expected.length - 1);
			}
			expect(new Set(seen)).toEqual(new Set(expected.map((item) => item.template_id)));
		}
		expect((await list(app, `?${search}`)).data).toHaveLength(5);
		expect((await list(app)).data).toHaveLength(6);
		services.catalog.setStatus(firstEntry.slug, "unlisted");
		expect((await list(app, `?${search}&status=listed`)).data.map((item) => item.template_id)).toEqual([
			second.template_id,
		]);
		expect((await list(app, `?${search}&status=unlisted`)).data).toHaveLength(4);
	});

	// 分类取自模版配置，与目录运营分类无关；多条件先筛选后分页，旧配置视为通用。
	it("模版分类与搜索状态组合分页，旧无分类记录归入通用且不借用目录分类", async () => {
		const { app, services, db } = setup();
		const first = await created(app, { ...selected, name: "分类_数据一", category: "data" });
		const draft = await created(app, { ...selected, name: "分类_数据草稿", category: "data" });
		const second = await created(app, { ...selected, name: "分类_数据二", category: "data" });
		const writing = await created(app, { ...selected, name: "分类_写作", category: "writing" });
		const outside = await created(app, { ...selected, name: "其他数据", category: "data" });
		const legacy = await created(app, { ...selected, name: "分类_旧通用" });
		const firstEntry = await listTemplate(app, first);
		await listTemplate(app, second);
		const writingEntry = await listTemplate(app, writing);
		await listTemplate(app, outside);
		services.catalog.update(firstEntry.id, { category: "writing" });
		services.catalog.update(writingEntry.id, { category: "data" });
		db.prepare("UPDATE kit_templates SET config_json=json_remove(config_json,'$.category') WHERE template_id=?").run(
			legacy.template_id,
		);
		expect((await list(app)).data).toHaveLength(6);
		const provider = vi.spyOn(services.gateway, "listRemoteAgents").mockRejectedValue(new Error("Provider offline"));
		const query = `category=data&search=${encodeURIComponent("分类_")}`;
		for (const [status, expected] of [
			[undefined, [first, draft, second]],
			["listed", [first, second]],
			["unlisted", [draft]],
		] as const) {
			const seen: string[] = [];
			let token: string | undefined;
			for (let page = 0; page < expected.length; page++) {
				const result = await list(
					app,
					`?${query}&limit=1${status ? `&status=${status}` : ""}${token ? `&page_token=${token}` : ""}`,
				);
				expect(result.data).toHaveLength(1);
				expect(result.data[0]?.category).toBe("data");
				seen.push(...result.data.map((item) => item.template_id));
				token = result.next_page_token;
				expect(Boolean(token)).toBe(page < expected.length - 1);
			}
			expect(new Set(seen)).toEqual(new Set(expected.map((item) => item.template_id)));
		}
		expect((await list(app, "?category=writing&status=listed")).data.map((item) => item.template_id)).toEqual([
			writing.template_id,
		]);
		expect((await list(app, "?category=general")).data).toMatchObject([
			{ template_id: legacy.template_id, category: "general" },
		]);
		expect((await list(app, "?category=coding")).data).toEqual([]);
		expect(provider).not.toHaveBeenCalled();
	});

	// 游标不能跨状态、分类或搜索串复用；旧格式游标只兼容未筛选项，非法值在 HTTP 边界被拒。
	it("分页游标绑定全部筛选条件且拒绝非法值，兼容旧未筛选游标", async () => {
		const { app } = setup();
		await created(app, { ...selected, name: "游标_一" });
		await created(app, { ...selected, name: "游标_二" });
		const listed = await created(app, { ...selected, name: "游标_三", category: "data" });
		await listTemplate(app, listed);
		const all = await list(app, "?limit=1");
		const unlisted = await list(app, "?status=unlisted&limit=1");
		const general = await list(app, "?category=general&limit=1");
		expect((await list(app, "?category=data")).data).toMatchObject([{ template_id: listed.template_id }]);
		expect(all.next_page_token).toBeTruthy();
		expect(unlisted.next_page_token).toBeTruthy();
		expect(general.next_page_token).toBeTruthy();
		for (const query of [
			`?status=listed&page_token=${all.next_page_token}`,
			`?status=unlisted&page_token=${all.next_page_token}`,
			`?status=listed&page_token=${unlisted.next_page_token}`,
			`?page_token=${unlisted.next_page_token}`,
			`?status=unlisted&search=other&page_token=${unlisted.next_page_token}`,
			`?category=general&page_token=${all.next_page_token}`,
			`?category=data&page_token=${general.next_page_token}`,
			`?page_token=${general.next_page_token}`,
			"?status=all",
			"?status=invalid",
			"?category=",
			"?category=all",
			"?category=invalid",
		]) {
			expect((await request(app, `/api/admin/templates${query}`)).status).toBe(400);
		}
		const cursor = JSON.parse(Buffer.from(all.next_page_token!, "base64url").toString("utf8"));
		delete cursor.status;
		delete cursor.category;
		const legacyToken = Buffer.from(JSON.stringify(cursor)).toString("base64url");
		expect((await list(app, `?page_token=${legacyToken}`)).data).toHaveLength(2);
		expect((await request(app, `/api/admin/templates?category=general&page_token=${legacyToken}`)).status).toBe(400);
		const readonly = await request(app, "/api/admin/templates?status=listed", undefined, "Bearer auditor");
		expect(readonly.status).toBe(200);
		const page = (await readonly.json()) as TemplatesPage;
		expect(page.data).toMatchObject([{ template_id: listed.template_id }]);
	});

	// 保护保存时校验和失败原子性；只读身份先证明已存在的模版可见，再断言不能写入。
	it("拒绝非法或失效资源及 auditor 保存，失败不落库且已有配置保留", async () => {
		const { app, services } = setup();
		const existing = await created(app, { ...selected, name: "已有模版" });
		for (const path of ["/api/admin/templates", `/api/admin/templates/${existing.template_id}`]) {
			const read = await request(app, path, undefined, "Bearer auditor");
			expect(read.status).toBe(200);
			expect(await read.text()).toContain(existing.template_id);
		}
		expect(
			(await request(app, "/api/admin/templates", { ...selected, name: "不允许保存" }, "Bearer auditor")).status,
		).toBe(403);
		const invalid = [
			{ name: " " },
			{ category: undefined },
			{ category: null },
			{ category: "" },
			{ category: "unknown" },
			{ remote_agent_id: "removed-agent" },
			{ remote_environment_id: "removed-environment" },
			{ files: [{ file_id: "removed-file" }] },
			{ memory_stores: [{ memory_store_id: "archived-memory" }] },
			{ vault_ids: ["archived-vault"] },
			{ vault_ids: ["vlt_mock_1", "vlt_mock_1"] },
			{ suggested_prompts: Array.from({ length: 9 }, () => "超限问题") },
			{ credential: "must-not-store" },
		];
		for (const patch of invalid) {
			expect((await request(app, "/api/admin/templates", { ...selected, name: "无效模版", ...patch })).status).toBe(
				400,
			);
		}
		vi.spyOn(services.gateway, "listRemoteEnvironments").mockRejectedValue(new Error("Provider offline"));
		expect((await request(app, "/api/admin/templates", { ...selected, name: "失败模版" })).status).toBe(500);
		expect((await list(app)).data).toEqual([existing]);
		expect(services.audit.list().filter((row) => row.action === "templates.create")).toHaveLength(1);
	});
});
