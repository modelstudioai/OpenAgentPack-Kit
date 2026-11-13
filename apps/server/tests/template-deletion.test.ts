import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ApplyRequest,
	type PlanResponse,
	TemplateInputSchema,
	type TemplateView,
} from "@openagentpack/kit-sdk/protocol";
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
const selected = {
	remote_agent_id: "agent_mock_assistant",
	remote_environment_id: "env_mock_analysis",
	category: "general" as const,
};
const admin = { authorization: "Bearer template-admin", "content-type": "application/json" };

function setup() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-template-delete-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const db = openDatabase(dataDir);
	cleanup.push(() => db.close());
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_AUTH_MODE: "anonymous",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "template-admin",
		KIT_ADMIN_TOKENS: "other-admin:admin,auditor:auditor",
		KIT_RATE_LIMIT_RPS: "0",
	});
	const services = createKitServices(config, db);
	const app = createApp(services);
	function request(path: string, method: "POST" | "DELETE", body?: unknown, token = "template-admin") {
		return app.request(path, {
			method,
			headers: {
				authorization: `Bearer ${token}`,
				...(body !== undefined ? { "content-type": "application/json" } : {}),
			},
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		});
	}
	async function save(name = "待删除模版") {
		return services.templates.create(
			{ name, ...selected, files: [], memory_stores: [], vault_ids: [], suggested_prompts: [] },
			"fixture",
		);
	}
	async function publish(template: TemplateView) {
		const display = { display_name: template.name };
		const plan = await services.templates.planListing(template.template_id, display, "fixture");
		return services.templates.listing(template.template_id, { ...display, ...confirmation(plan) }, "fixture");
	}
	async function plan(template: TemplateView): Promise<PlanResponse> {
		const response = await request(`/api/admin/templates/${template.template_id}/delete/plan`, "POST");
		expect(response.status, await response.clone().text()).toBe(200);
		return ((await response.json()) as { data: PlanResponse }).data;
	}
	function remove(template: TemplateView, input?: unknown, token?: string) {
		return request(`/api/admin/templates/${template.template_id}`, "DELETE", input, token);
	}
	function localRows(templateId: string) {
		return {
			templates: db.prepare("SELECT * FROM kit_templates WHERE template_id=?").all(templateId),
			versions: db.prepare("SELECT * FROM kit_template_versions WHERE template_id=? ORDER BY version").all(templateId),
			listings: db.prepare("SELECT * FROM kit_template_listings WHERE template_id=?").all(templateId),
		};
	}
	return { app, services, db, save, publish, plan, remove, request, localRows };
}

function confirmation(plan: PlanResponse): ApplyRequest {
	return { plan_id: plan.plan_id, confirm_token: plan.confirm_token };
}

describe("模版删除", () => {
	// 计划仅本地只读；删除显式清理全部历史，不依赖SQLite部署是否启用级联。
	it("未关联模版可离线预览删除，确认后当前配置和全部历史均不可见", async () => {
		const { app, services, db, save, plan, remove, localRows } = setup();
		const first = await save();
		const template = await services.templates.update(
			first.template_id,
			{
				...TemplateInputSchema.strip().parse(first),
				base_version: first.version,
				description: "保留在第二版的内容",
			},
			"fixture",
		);
		const before = localRows(template.template_id);
		expect(before.versions).toHaveLength(2);
		db.exec("PRAGMA foreign_keys = OFF");
		const remote = vi.spyOn(services.gateway, "listRemoteAgents").mockRejectedValue(new Error("Provider offline"));
		const prepared = await plan(template);
		expect(prepared.diff.some((item) => item.summary?.includes("全部历史版本"))).toBe(true);
		expect(prepared.diff.some((item) => item.action === "noop" && item.summary?.includes("已有会话"))).toBe(true);
		expect(localRows(template.template_id)).toEqual(before);
		expect(services.audit.list().filter((row) => row.action === "templates.delete")).toEqual([]);
		const response = await remove(template, confirmation(prepared));
		expect(response.status, await response.clone().text()).toBe(200);
		expect(await response.json()).toEqual({ data: { deleted: true } });
		expect(localRows(template.template_id)).toEqual({ templates: [], versions: [], listings: [] });
		expect((await app.request(`/api/admin/templates/${template.template_id}`, { headers: admin })).status).toBe(404);
		expect(services.templates.list({ limit: 10 }).data).toEqual([]);
		expect(remote).not.toHaveBeenCalled();
		expect(services.audit.list().find((row) => row.action === "templates.delete")).toMatchObject({
			subject: expect.stringMatching(/^admin:admin:[0-9a-f]{8}$/),
			target: template.template_id,
			detail: JSON.stringify({ name: template.name }),
		});
	});

	// 关联条目随模版一起移除，员工已有Session仍可读；Provider删除与本地会话索引不受影响。
	it("删除已上架模版使公开目录消失，保留既有员工会话和远端资源", async () => {
		const { app, services, db, save, publish, plan, remove, localRows } = setup();
		const template = await save();
		const entry = await publish(template);
		const employee = { "content-type": "application/json", cookie: "kit_subject=template-delete-employee" };
		const started = await app.request("/api/kit/sessions", {
			method: "POST",
			headers: employee,
			body: JSON.stringify({ agent_slug: entry.slug }),
		});
		expect(started.status).toBe(201);
		const { data: session } = (await started.json()) as { data: { session_id: string } };
		const index = services.sessionIndex.get(session.session_id);
		const deleteSession = vi.spyOn(services.gateway, "deleteSession");
		const prepared = await plan(template);
		expect(prepared.diff).toContainEqual(
			expect.objectContaining({ resource: `catalog:${entry.slug}`, action: "delete" }),
		);
		expect((await app.request(`/api/kit/agents/${entry.slug}`, { headers: employee })).status).toBe(200);
		db.exec("PRAGMA foreign_keys = OFF");
		expect((await remove(template, confirmation(prepared))).status).toBe(200);
		expect(localRows(template.template_id)).toEqual({ templates: [], versions: [], listings: [] });
		expect(services.catalog.get(entry.id)).toBeNull();
		expect((await app.request(`/api/kit/agents/${entry.slug}`, { headers: employee })).status).toBe(404);
		expect(
			(
				await app.request("/api/kit/sessions", {
					method: "POST",
					headers: employee,
					body: JSON.stringify({ agent_slug: entry.slug }),
				})
			).status,
		).toBe(404);
		expect((await app.request(`/api/kit/sessions/${session.session_id}`, { headers: employee })).status).toBe(200);
		expect(services.sessionIndex.get(session.session_id)).toEqual(index);
		expect(deleteSession).not.toHaveBeenCalled();
		expect(await services.gateway.getSession(session.session_id)).not.toBeNull();
	});

	// 确认严格绑定目标、主体和用途；失败不能消费另一主体/目标的有效计划，也不能复用已执行令牌。
	it("拒绝缺令牌、伪造、错主体或目标及重放，合法确认仅删目标模版", async () => {
		const { services, save, plan, remove } = setup();
		const template = await save();
		const other = await save("另一个模版");
		expect((await remove(template)).status).toBe(428);
		expect((await remove(template, {})).status).toBe(428);
		expect((await remove(template, { plan_id: "forged", confirm_token: "forged" })).status).toBe(428);
		const prepared = await plan(template);
		expect((await remove(template, confirmation(prepared), "other-admin")).status).toBe(428);
		expect((await remove(other, confirmation(prepared))).status).toBe(428);
		expect(services.templates.list({ limit: 10 }).data).toHaveLength(2);
		expect((await remove(template, confirmation(prepared))).status).toBe(200);
		expect((await remove(template, confirmation(prepared))).status).toBe(428);
		expect(services.templates.get(other.template_id)).toEqual(other);
	});

	// 计划之后任何模版版本或关联目录变化都需重新确认，不能删除用户未审阅的状态。
	it("编辑、上下架及目录运营信息变化使删除计划过期，未上架条目也可重新确认删除", async () => {
		const { services, save, publish, plan, remove } = setup();
		const first = await save();
		const oldVersionPlan = await plan(first);
		const template = await services.templates.update(
			first.template_id,
			{
				...TemplateInputSchema.strip().parse(first),
				base_version: first.version,
				description: "新版本",
			},
			"fixture",
		);
		expect((await remove(template, confirmation(oldVersionPlan))).status).toBe(409);
		const beforeListing = await plan(template);
		const entry = await publish(template);
		expect((await remove(template, confirmation(beforeListing))).status).toBe(409);
		const beforeUnlisting = await plan(template);
		services.catalog.setStatus(entry.slug, "unlisted");
		expect((await remove(template, confirmation(beforeUnlisting))).status).toBe(409);
		const beforeEdit = await plan(template);
		services.catalog.update(entry.id, { ordering: 42 });
		expect((await remove(template, confirmation(beforeEdit))).status).toBe(409);
		expect(services.templates.get(template.template_id).version).toBe(2);
		expect(services.catalog.get(entry.id)).toMatchObject({ status: "unlisted", ordering: 42 });
		expect((await remove(template, confirmation(await plan(template)))).status).toBe(200);
		expect(services.catalog.get(entry.id)).toBeNull();
	});

	// 在最后删除当前记录时注入数据库失败，证明已执行的Catalog/历史/映射删除也会一起回滚。
	it("删除后半段失败会回滚全部目录和历史记录", async () => {
		const { services, db, save, publish, plan, remove, localRows } = setup();
		const template = await save();
		const entry = await publish(template);
		const before = localRows(template.template_id);
		const prepared = await plan(template);
		db.exec(`CREATE TRIGGER fail_template_delete BEFORE DELETE ON kit_templates
			BEGIN SELECT RAISE(ABORT, 'template delete failed'); END;`);
		expect((await remove(template, confirmation(prepared))).status).toBe(500);
		expect(localRows(template.template_id)).toEqual(before);
		expect(services.catalog.get(entry.id)).toEqual(entry);
		expect(services.audit.list().filter((row) => row.action === "templates.delete")).toEqual([]);
	});
});
