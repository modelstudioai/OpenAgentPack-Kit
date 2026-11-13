import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogAgentView, PlanResponse, TemplateView } from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	for (const close of cleanup.splice(0).reverse()) close();
});
const selected = {
	remote_agent_id: "agent_mock_assistant",
	remote_environment_id: "env_mock_analysis",
	category: "general" as const,
};

function setup() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-template-listing-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_AUTH_MODE: "anonymous",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "template-admin",
		KIT_ADMIN_TOKENS: "auditor:auditor,other-admin:admin",
		KIT_RATE_LIMIT_RPS: "0",
	});
	function reopen() {
		const db = openDatabase(dataDir);
		cleanup.push(() => db.close());
		const services = createKitServices(config, db);
		const app = createApp(services);
		function post(path: string, input: unknown, token = "template-admin") {
			return app.request(path, {
				method: "POST",
				headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
				body: JSON.stringify(input),
			});
		}
		async function save(patch: Record<string, unknown> = {}): Promise<TemplateView> {
			const response = await post("/api/admin/templates", { ...selected, name: "项目助手模版", ...patch });
			expect(response.status, await response.clone().text()).toBe(201);
			return ((await response.json()) as { data: TemplateView }).data;
		}
		function listing(template: TemplateView, input: unknown, token?: string) {
			return post(`/api/admin/templates/${template.template_id}/listing`, input, token);
		}
		async function plan(template: TemplateView, name = "项目助手"): Promise<PlanResponse> {
			const response = await post(`/api/admin/templates/${template.template_id}/listing/plan`, { display_name: name });
			expect(response.status, await response.clone().text()).toBe(200);
			return ((await response.json()) as { data: PlanResponse }).data;
		}
		return { app, db, services, post, save, listing, plan };
	}
	return { ...reopen(), reopen };
}

function confirmed(plan: PlanResponse, displayName = "项目助手") {
	return { display_name: displayName, plan_id: plan.plan_id, confirm_token: plan.confirm_token };
}

describe("模版上架", () => {
	// 保护 plan→取消无写入→确认后员工可见，配置与关联持久化，且模版版本快照不锁定运行时。
	it("计划只读，确认后完整映射配置并持久记录当前上架状态", async () => {
		const { app, services, db, save, plan, listing, reopen } = setup();
		const file = await services.gateway.uploadFile({ filename: "guide.txt", bytes: new Uint8Array([1, 2]) });
		const template = await save({
			category: "data",
			files: [{ file_id: file.file_id }],
			memory_stores: [{ memory_store_id: "memory-guide", access: "read_only", instructions: "仅查询" }],
			vault_ids: ["vlt_mock_1", "vlt_mock_2"],
			description: "项目问答",
			opening_remarks: "你好，需要什么帮助？",
			suggested_prompts: ["总结项目"],
		});
		const createSession = vi.spyOn(services.gateway, "createSession");
		const prepared = await plan(template);
		expect(prepared.diff.map((entry) => entry.action)).toEqual(["create", "update"]);
		expect(services.catalog.all()).toEqual([]);
		expect(db.prepare("SELECT count(*) AS count FROM kit_template_listings").get()?.count).toBe(0);
		expect(services.audit.list().filter((row) => row.action === "templates.listing")).toEqual([]);
		const response = await listing(template, confirmed(prepared));
		expect(response.status, await response.clone().text()).toBe(200);
		const { data: entry } = (await response.json()) as { data: CatalogAgentView };
		expect(entry).toMatchObject({
			slug: template.template_id,
			display_name: "项目助手",
			...selected,
			category: "data",
			status: "listed",
			files: template.files,
			memory_stores: template.memory_stores,
			vault_ids: template.vault_ids,
			description: template.description,
			opening_remarks: template.opening_remarks,
			suggested_prompts: template.suggested_prompts,
		});
		expect(entry.remote_agent_version).toBeUndefined();
		expect(template.remote_agent_version).toBe(1);
		expect(createSession).not.toHaveBeenCalled();
		const publicCatalog = await app.request("/api/kit/agents");
		expect(await publicCatalog.json()).toMatchObject({ data: [{ slug: entry.slug }] });
		const restarted = reopen();
		vi.spyOn(restarted.services.gateway, "listRemoteAgents").mockRejectedValue(new Error("offline"));
		expect(restarted.services.templates.get(template.template_id).listing).toEqual({
			catalog_id: entry.id,
			slug: entry.slug,
			display_name: entry.display_name,
			status: "listed",
			listed_at: entry.updated_at,
		});
		expect(restarted.services.templates.list({ limit: 10 }).data[0]?.listing?.status).toBe("listed");
		expect(services.audit.list().find((row) => row.action === "templates.listing")).toMatchObject({
			subject: expect.stringMatching(/^admin:admin:[0-9a-f]{8}$/),
			target: template.template_id,
			detail: JSON.stringify({ name: entry.display_name, catalog_id: entry.id }),
		});
	});

	// 上架时间只跟随实际上架转换；编辑、重复设为已上架、下架均不能冒充新的上架。
	it("记录最近一次上架时间，编辑和下架保留，重新上架更新且列表与重启读取一致", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const first = "2026-11-02T01:00:00.000Z";
		const second = "2026-11-02T01:02:00.000Z";
		vi.setSystemTime(first);
		const { save, plan, listing, services, reopen } = setup();
		const template = await save();
		const prepared = await plan(template);
		expect(services.templates.get(template.template_id).listing).toBeUndefined();
		expect((await listing(template, confirmed(prepared))).status).toBe(200);
		const entry = services.catalog.all()[0]!;
		expect(services.templates.get(template.template_id).listing?.listed_at).toBe(first);
		vi.setSystemTime("2026-11-02T01:01:00.000Z");
		await services.templates.update(
			template.template_id,
			{ ...selected, name: template.name, description: "编辑模版", base_version: template.version },
			"admin:test",
		);
		services.catalog.setStatus(entry.slug, "listed");
		expect(services.templates.get(template.template_id).listing?.listed_at).toBe(first);
		services.catalog.setStatus(entry.slug, "unlisted");
		expect(services.templates.get(template.template_id).listing).toMatchObject({
			status: "unlisted",
			listed_at: first,
		});
		vi.setSystemTime(second);
		expect((await listing(template, confirmed(await plan(template)))).status).toBe(200);
		const restarted = reopen();
		const response = await restarted.app.request("/api/admin/templates", {
			headers: { authorization: "Bearer template-admin" },
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ data: [{ listing: { status: "listed", listed_at: second } }] });
		expect(restarted.services.templates.get(template.template_id).listing?.listed_at).toBe(second);
	});

	it("旧目录迁移保留上架状态与配置，不把创建或更新时间补作上架时间", async () => {
		const { save, plan, listing, db, reopen } = setup();
		const template = await save();
		expect((await listing(template, confirmed(await plan(template)))).status).toBe(200);
		db.exec(`ALTER TABLE catalog_agents DROP COLUMN listed_at;
			DELETE FROM _kit_migrations WHERE id='023_catalog_listed_at';`);
		const restarted = reopen();
		const migrated = restarted.services.templates.get(template.template_id);
		expect(migrated).toMatchObject({ ...template, listing: { status: "listed" } });
		expect(migrated.listing?.listed_at).toBeUndefined();
		expect(restarted.services.catalog.all()[0]?.status).toBe("listed");
		expect(reopen().services.templates.get(template.template_id)).toEqual(migrated);
	});

	// 确认必须绑定主体、模版和展示名称；缺失、伪造、错用和重放均不得产生目录写入。
	it("拒绝缺失、伪造、跨主体或跨模版的令牌、计划外改名及确认重放", async () => {
		const { services, save, listing, plan } = setup();
		const template = await save();
		const other = await save({ name: "另一模版" });
		expect((await listing(template, { display_name: "项目助手" })).status).toBe(428);
		expect((await listing(template, { display_name: "项目助手", plan_id: "bad", confirm_token: "bad" })).status).toBe(
			428,
		);
		const prepared = await plan(template);
		expect((await listing(template, confirmed(prepared), "other-admin")).status).toBe(428);
		expect((await listing(other, confirmed(prepared))).status).toBe(428);
		expect((await listing(template, confirmed(prepared, "未确认的名称"))).status).toBe(409);
		expect(services.catalog.all()).toEqual([]);
		const finalPlan = await plan(template);
		expect((await listing(template, confirmed(finalPlan))).status).toBe(200);
		expect((await listing(template, confirmed(finalPlan))).status).toBe(428);
		expect(services.catalog.all()).toHaveLength(1);
	});

	// 同一模版只对应一个条目；重新上架同步模版字段，保留目录运营信息，并拒绝覆盖计划之后的编辑。
	it("并发上架不重复，重新上架复用条目且拒绝过期目录快照", async () => {
		const { services, save, listing, plan, post } = setup();
		const template = await save();
		const plans = await Promise.all([plan(template), plan(template)]);
		const responses = await Promise.all(plans.map((prepared) => listing(template, confirmed(prepared))));
		expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
		const initial = services.catalog.all()[0];
		expect(initial).toBeDefined();
		if (!initial) throw new Error("Missing catalog entry");
		expect(
			(await post(`/api/admin/templates/${template.template_id}/listing/plan`, { display_name: "项目助手" })).status,
		).toBe(409);
		services.catalog.update(initial.id, {
			status: "unlisted",
			description: "条目中修改的描述",
			remote_environment_id: "env_mock_default",
			remote_agent_version: 999,
			category: "coding",
			ordering: 3,
			featured: true,
		});
		const stale = await plan(template);
		expect(stale.diff[0]?.summary).toContain("覆盖现有条目");
		services.catalog.update(initial.id, { ordering: 4 });
		expect((await listing(template, confirmed(stale))).status).toBe(409);
		expect(services.catalog.get(initial.id)).toMatchObject({ status: "unlisted", ordering: 4 });
		const fresh = await plan(template);
		expect((await listing(template, confirmed(fresh))).status).toBe(200);
		expect(services.catalog.all()).toHaveLength(1);
		expect(services.catalog.get(initial.id)).toMatchObject({
			id: initial.id,
			...selected,
			status: "listed",
			category: template.category,
			ordering: 4,
			featured: true,
		});
		expect(services.catalog.get(initial.id)?.description).toBeUndefined();
		expect(services.catalog.get(initial.id)?.remote_agent_version).toBeUndefined();
	});

	// 真实存在的占用条目必须保持不变；删除后的关联不误认同 slug 的外来条目。
	it("删除条目清除关联，名称或稳定 ID 冲突不会覆盖其他条目", async () => {
		const { services, save, plan, listing, post, db } = setup();
		const template = await save();
		const foreign = services.catalog.create({
			slug: "another-agent",
			display_name: "项目助手",
			remote_agent_id: "foreign-agent",
		});
		const path = `/api/admin/templates/${template.template_id}/listing/plan`;
		expect((await post(path, { display_name: "项目助手" })).status).toBe(409);
		expect(services.catalog.get(foreign.id)).toEqual(foreign);
		services.catalog.remove(foreign.id);
		expect((await listing(template, confirmed(await plan(template)))).status).toBe(200);
		const catalogId = services.templates.get(template.template_id).listing?.catalog_id;
		if (!catalogId) throw new Error("Missing catalog link");
		services.catalog.remove(catalogId);
		expect(services.templates.get(template.template_id).listing).toBeUndefined();
		expect(db.prepare("SELECT count(*) AS count FROM kit_template_listings").get()?.count).toBe(0);
		const occupied = services.catalog.create({
			slug: template.template_id,
			display_name: "别的条目",
			remote_agent_id: "foreign-agent",
		});
		expect((await post(path, { display_name: "项目助手" })).status).toBe(409);
		expect(services.catalog.get(occupied.id)).toEqual(occupied);
		services.catalog.remove(occupied.id);
		expect((await listing(template, confirmed(await plan(template)))).status).toBe(200);
		expect(services.templates.get(template.template_id).listing?.catalog_id).not.toBe(catalogId);
	});

	// Provider 引用可能在计划后消失；确认前必须重新验证，每一种资源失效都保持零目录写入。
	it.each(["agent", "environment", "file", "memory", "vault"] as const)(
		"%s 在计划后失效时拒绝上架",
		async (resource) => {
			const { services, save, plan, listing, db } = setup();
			const file = await services.gateway.uploadFile({ filename: "guide.txt", bytes: new Uint8Array([1]) });
			const template = await save({
				files: [{ file_id: file.file_id }],
				memory_stores: [{ memory_store_id: "memory-guide", access: "read_only" }],
				vault_ids: ["vlt_mock_1"],
			});
			const prepared = await plan(template);
			if (resource === "agent") vi.spyOn(services.gateway, "listRemoteAgents").mockResolvedValue([]);
			if (resource === "environment") vi.spyOn(services.gateway, "listRemoteEnvironments").mockResolvedValue([]);
			if (resource === "file") vi.spyOn(services.gateway, "getRemoteFile").mockResolvedValue(null);
			if (resource === "memory") vi.spyOn(services.gateway, "getRemoteMemoryStore").mockResolvedValue(null);
			if (resource === "vault") vi.spyOn(services.gateway, "getRemoteVault").mockResolvedValue(null);
			expect((await listing(template, confirmed(prepared))).status).toBe(400);
			expect(services.catalog.all()).toEqual([]);
			expect(db.prepare("SELECT count(*) AS count FROM kit_template_listings").get()?.count).toBe(0);
		},
	);

	// 数据库提交后半段失败也必须回滚已插入的目录记录，不能留下草稿或半完成关联。
	it("确认写入失败时回滚目录和关联", async () => {
		const { services, save, plan, listing, db } = setup();
		const template = await save();
		const prepared = await plan(template);
		vi.spyOn(services.catalog, "setStatus").mockImplementation(() => {
			throw new Error("write failed");
		});
		expect((await listing(template, confirmed(prepared))).status).toBe(500);
		expect(services.catalog.all()).toEqual([]);
		expect(db.prepare("SELECT count(*) AS count FROM kit_template_listings").get()?.count).toBe(0);
		expect(services.audit.list().filter((row) => row.action === "templates.listing")).toEqual([]);
	});
});
