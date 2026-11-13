import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AdminIdentityViewSchema,
	AuditLogsPageSchema,
	type CatalogAgentView,
	type PlanResponse,
	type TemplateView,
} from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const close of cleanup.splice(0).reverse()) close();
});
const adminToken = "audit-test-admin";
const headers = { authorization: `Bearer ${adminToken}`, "content-type": "application/json" };
const config = { name: "操作记录助手", category: "general", remote_agent_id: "agent_mock_assistant" };

function setup() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-audit-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const db = openDatabase(dataDir);
	cleanup.push(() => db.close());
	const services = createKitServices(
		loadConfig({
			KIT_GATEWAY: "mock",
			KIT_DATA_DIR: dataDir,
			ADMIN_TOKEN: adminToken,
			KIT_ADMIN_TOKENS: "audit-test-reader:auditor,audit-test-other:admin",
			KIT_RATE_LIMIT_RPS: "0",
		}),
		db,
	);
	const app = createApp(services);
	async function request(path: string, method = "GET", body?: unknown) {
		const response = await app.request(path, {
			method,
			headers,
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		expect(response.status, await response.clone().text()).toBeLessThan(300);
		return response;
	}
	function historical(subject: string | null, action: string, target: string, detail?: unknown) {
		db.prepare("INSERT INTO kit_audit (at, subject, action, target, detail) VALUES (?,?,?,?,?)").run(
			new Date().toISOString(),
			subject,
			action,
			target,
			detail === undefined ? null : JSON.stringify(detail),
		);
	}
	return { app, services, request, db, historical };
}

describe("操作日志", () => {
	// 兼容目录入口仍属于智能体管理；非白名单动作在持久化入口直接忽略。
	it("兼容接口保留智能体五类操作，其他操作及未知动作不写入", async () => {
		const { request, services, db } = setup();
		const path = "/api/admin/agents/audit-compat";
		await request("/api/admin/agents", "POST", {
			slug: "audit-compat",
			display_name: "兼容智能体",
			remote_agent_id: config.remote_agent_id,
		});
		await request(path, "PUT", { display_name: "编辑后的兼容智能体" });
		for (const status of ["listed", "unlisted"]) {
			const { data: plan } = (await (await request(`${path}/plan`, "POST", { action: "listing", status })).json()) as {
				data: PlanResponse;
			};
			await request(path, "PATCH", { status, plan_id: plan.plan_id, confirm_token: plan.confirm_token });
		}
		const { data: plan } = (await (await request(`${path}/plan`, "POST", { action: "delete" })).json()) as {
			data: PlanResponse;
		};
		await request(path, "DELETE", { plan_id: plan.plan_id, confirm_token: plan.confirm_token });
		await request("/api/admin/members", "POST", {
			username: "audit-member",
			display_name: "不记日志的成员",
			auth_type: "local",
			password_mode: "auto",
		});
		for (const action of [
			"member.auth.login",
			"groups.create",
			"usage_limits.policy.set",
			"project.agents.create",
			"project.publish",
			"resourceDraft.create",
			"file.upload",
			"session.delete",
			"debug.session.create",
			"templates.preview",
			"catalog.plan",
			"unknown.action",
		])
			services.audit.append({ subject: "fixture", action, target: "excluded" });
		expect(db.prepare("SELECT count(*) AS total FROM kit_audit").get()?.total).toBe(5);
		const logs = AuditLogsPageSchema.parse(await (await request("/api/admin/audit")).json());
		expect(logs.data.map((row) => row.action)).toEqual([
			"catalog.delete",
			"catalog.unlist",
			"catalog.list",
			"catalog.update",
			"catalog.create",
		]);
	});

	// 保护完整管理流程：只记成功操作，名称在重命名、删除后仍来自当时的快照。
	it("新建、编辑、上下架与删除均可查询，包含操作者和名称，拒绝的操作不冒充成功", async () => {
		const { app, request } = setup();
		const created = await request("/api/admin/templates", "POST", config);
		const { data: template } = (await created.json()) as { data: TemplateView };
		const target = `/api/admin/templates/${template.template_id}`;
		const edited = { ...config, name: "编辑后的助手", base_version: template.version };
		await request(target, "PUT", edited);
		expect((await app.request(target, { method: "PUT", headers, body: JSON.stringify(edited) })).status).toBe(409);
		const display = { display_name: edited.name };
		const { data: plan } = (await (await request(`${target}/listing/plan`, "POST", display)).json()) as {
			data: PlanResponse;
		};
		const { data: entry } = (await (
			await request(`${target}/listing`, "POST", {
				...display,
				plan_id: plan.plan_id,
				confirm_token: plan.confirm_token,
			})
		).json()) as { data: CatalogAgentView };
		const catalogPath = `/api/admin/agents/${entry.slug}`;
		const { data: unlist } = (await (
			await request(`${catalogPath}/plan`, "POST", { action: "listing", status: "unlisted" })
		).json()) as { data: PlanResponse };
		await request(catalogPath, "PATCH", {
			status: "unlisted",
			plan_id: unlist.plan_id,
			confirm_token: unlist.confirm_token,
		});
		const { data: deletion } = (await (await request(`${target}/delete/plan`, "POST")).json()) as {
			data: PlanResponse;
		};
		await request(target, "DELETE", { plan_id: deletion.plan_id, confirm_token: deletion.confirm_token });
		expect((await app.request(target, { headers })).status).toBe(404);
		const response = await request("/api/admin/audit");
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		const logs = AuditLogsPageSchema.parse(await response.json());
		expect(logs.total).toBe(5);
		expect(logs.data.map((row) => row.action)).toEqual([
			"templates.delete",
			"catalog.unlist",
			"templates.listing",
			"templates.update",
			"templates.create",
		]);
		for (const row of logs.data) {
			expect(row.subject).toMatch(/^admin:admin:[0-9a-f]{8}$/);
			expect(Number.isNaN(Date.parse(row.at))).toBe(false);
			expect(JSON.parse(row.detail ?? "null").name).toBe(row.action === "templates.create" ? config.name : edited.name);
		}
		expect(JSON.stringify(logs)).not.toContain(adminToken);
		expect((await app.request("/api/admin/audit")).status).toBe(401);
		const second = AuditLogsPageSchema.parse(await (await request("/api/admin/audit?limit=2&offset=2")).json());
		expect(second.total).toBe(5);
		expect(second.data.map((row) => row.id)).toEqual(logs.data.slice(2, 4).map((row) => row.id));
	});

	// 服务端在分页与总数统计前按已认证主体隔离，不能由查询参数选择其他人的日志。
	it("各管理员只读本人记录，成员和无主体记录不可见，分页总数也按本人计算", async () => {
		const { app, services, request, historical } = setup();
		const { data: mine } = (await (await request("/api/admin/templates", "POST", config)).json()) as {
			data: TemplateView;
		};
		const otherHeaders = { ...headers, authorization: "Bearer audit-test-other" };
		const created = await app.request("/api/admin/templates", {
			method: "POST",
			headers: otherHeaders,
			body: JSON.stringify({ ...config, name: "其他管理员的助手" }),
		});
		expect(created.status).toBe(201);
		const { data: other } = (await created.json()) as { data: TemplateView };
		historical("member_test", "member.auth.login", "member_test");
		historical(null, "templates.create", "unattributed");
		expect(services.audit.list()).toHaveLength(4);
		const foreign = AuditLogsPageSchema.parse(
			await (await app.request("/api/admin/audit", { headers: otherHeaders })).json(),
		);
		expect(foreign.total).toBe(1);
		expect(foreign.data[0]?.target).toBe(other.template_id);
		const own = AuditLogsPageSchema.parse(await (await request("/api/admin/audit?limit=1")).json());
		expect(own.total).toBe(1);
		expect(own.data.map((row) => row.target)).toEqual([mine.template_id]);
		const spoofed = AuditLogsPageSchema.parse(
			await (await request(`/api/admin/audit?subject=${encodeURIComponent(foreign.data[0]?.subject ?? "")}`)).json(),
		);
		expect(spoofed).toEqual(own);
		expect(await (await request("/api/admin/audit?offset=1")).json()).toEqual({ data: [], total: 1 });
		const reader = await app.request("/api/admin/audit", { headers: { authorization: "Bearer audit-test-reader" } });
		expect(reader.status).toBe(200);
		expect(await reader.json()).toEqual({ data: [], total: 0 });
	});

	// 先证明历史非智能体操作确实存在，再验证白名单在分页与统计前生效。
	it("历史非智能体操作不展示，也不占用管理操作分页", async () => {
		const { request, db, historical } = setup();
		const { data: identity } = (await (await request("/api/admin/identity")).json()) as { data: unknown };
		const subject = AdminIdentityViewSchema.parse(identity).subject;
		await request("/api/admin/templates", "POST", config);
		const excluded = [
			"debug.session.create",
			"members.create",
			"usage_limits.policy.set",
			"project.publish",
			"unknown.action",
		];
		for (const action of excluded) {
			historical(subject, action, "historical-excluded-target");
		}
		expect(db.prepare("SELECT count(*) AS total FROM kit_audit").get()?.total).toBe(excluded.length + 1);
		const logs = AuditLogsPageSchema.parse(await (await request("/api/admin/audit?limit=1")).json());
		expect(logs.total).toBe(1);
		expect(logs.data.map((row) => row.action)).toEqual(["templates.create"]);
		expect(await (await request("/api/admin/audit?limit=1&offset=1")).json()).toEqual({ data: [], total: 1 });
	});

	// 兼容旧记录；分页边界限制请求规模，新名称快照不得把疑似凭据写入审计。
	it("保留旧日志，校验分页边界并对新增名称快照脱敏", async () => {
		const { app, request, historical } = setup();
		const { data: identity } = (await (await request("/api/admin/identity")).json()) as { data: unknown };
		historical(AdminIdentityViewSchema.parse(identity).subject, "catalog.update", "legacy-id", ["display_name"]);
		await request("/api/admin/templates", "POST", { ...config, name: "测试 sk-secret-value-123456" });
		const logs = AuditLogsPageSchema.parse(await (await request("/api/admin/audit")).json());
		expect(logs.data[0]?.detail).toContain("sk-***");
		expect(JSON.stringify(logs)).not.toContain("sk-secret-value-123456");
		expect(logs.data[1]).toMatchObject({ action: "catalog.update", detail: '["display_name"]' });
		for (const query of ["limit=0", "limit=201", "offset=-1", "offset=1.5"]) {
			expect((await app.request(`/api/admin/audit?${query}`, { headers })).status).toBe(400);
		}
	});
});
