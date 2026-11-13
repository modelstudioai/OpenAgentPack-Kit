import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	MembersPage,
	MemberUsageSummary,
	TemplateSessionUsage,
	TemplateUsageRow,
	TemplateUsageTrend,
} from "@openagentpack/kit-sdk/protocol";
import type { ModelUsagePage, ModelUsageRequest, ToolUsagePage } from "@openagentpack/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import type { GatewaySessionInfo } from "../src/gateway/types.ts";
import { createKitServices } from "../src/services/index.ts";
import { createMemberUsageService } from "../src/services/member-usage.ts";
import { openDatabase } from "../src/store/db.ts";
import { createMemberStore } from "../src/store/members.ts";
import { createSessionUsageStore } from "../src/store/session-usage.ts";
import { createTemplateStore } from "../src/store/templates.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const close of cleanup.splice(0).reverse()) close();
});
const admin = { authorization: "Bearer admin-token" };
const auditor = { authorization: "Bearer audit-token" };
function setup(env: Record<string, string | undefined> = {}) {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-member-usage-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const db = openDatabase(dataDir);
	cleanup.push(() => db.close());
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "admin-token",
		KIT_ADMIN_TOKENS: "audit-token:auditor",
		...env,
	});
	const services = createKitServices(config, db);
	const members = createMemberStore(db);
	const usageStore = createSessionUsageStore(db);
	function member(id: string) {
		return members.create(
			{
				member_id: id,
				username: id,
				display_name: id,
				auth_type: "local",
				status: "active",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			},
			"unused-hash",
		);
	}
	function session(id: string, memberId: string, agentSlug = "agent-a") {
		services.sessionIndex.create({ sessionId: id, subjectId: memberId, agentSlug });
	}
	return { db, services, app: createApp(services), usageStore, members, member, session, dataDir };
}
function detail(id: string, input = 10): GatewaySessionInfo {
	return {
		session_id: id,
		status: "idle",
		usage: { input_tokens: input, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 1 },
		stats: { active_seconds: 0.5, duration_seconds: 2 },
	};
}

describe("成员累计会话用量", () => {
	it("遍历超过100条会话，累计快照替换不重复计费；成员与用途隔离，筛选和分页同一口径", async () => {
		const { services, member, session } = setup();
		member("member_a");
		member("member_b");
		for (let i = 0; i < 125; i++) session(`s-${String(i).padStart(3, "0")}`, "member_a", i % 2 ? "agent-b" : "agent-a");
		session("other-member", "member_b");
		session("anonymous", "device-id");
		services.sessionIndex.create({
			sessionId: "debug",
			subjectId: "member_a",
			purpose: "admin_debug",
			debug: { project_name: "main", agent_key: "agent", remote_agent_id: "remote" },
		});
		const fetchDetail = vi.spyOn(services.gateway, "getSession").mockImplementation(async (id) => detail(id));
		await services.memberUsage.refresh("member_a", true);
		const first = services.memberUsage.summary("member_a");
		expect(first).toMatchObject({
			session_count: 125,
			completed_sessions: 125,
			refresh_status: "idle",
			metrics: {
				input_tokens: { value: 1250, covered_sessions: 125 },
				cache_read_input_tokens: { value: 0, covered_sessions: 125 },
			},
		});
		expect(fetchDetail).toHaveBeenCalledTimes(125);
		fetchDetail.mockImplementation(async (id) => detail(id, 12));
		await services.memberUsage.refresh("member_a", true);
		expect(services.memberUsage.summary("member_a").metrics.input_tokens.value).toBe(1500);
		const filtered = services.memberUsage.summary("member_a", { agent_slug: "agent-b" });
		expect(filtered.session_count).toBe(62);
		expect(filtered.metrics.input_tokens.value).toBe(744);
		expect(filtered.agents).toEqual(["agent-a", "agent-b"]);
		const ids = new Set<string>();
		let cursor: string | undefined;
		do {
			const page = services.memberUsage.list("member_a", { agent_slug: "agent-b", limit: 17, cursor });
			for (const row of page.data) {
				expect(ids.has(row.session_id)).toBe(false);
				ids.add(row.session_id);
			}
			cursor = page.next_cursor;
		} while (cursor);
		expect(ids.size).toBe(62);
		expect(fetchDetail.mock.calls.flat()).not.toContain("debug");
		expect(() => services.memberUsage.summary("device-id")).toThrow("成员不存在");
	});

	it("同成员刷新合并、全局四并发、60秒内查询不重复访问Provider", async () => {
		const { services, member, session } = setup();
		for (const id of ["member_a", "member_b"]) {
			member(id);
			for (let i = 0; i < 8; i++) session(`${id}-${i}`, id);
		}
		let active = 0;
		let peak = 0;
		const fetchDetail = vi.spyOn(services.gateway, "getSession").mockImplementation(async (id) => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setTimeout(resolve, 3));
			active--;
			return detail(id);
		});
		const a = services.memberUsage.refresh("member_a", true);
		expect(services.memberUsage.refresh("member_a", true)).toBe(a);
		await Promise.all([a, services.memberUsage.refresh("member_b", true)]);
		expect(peak).toBe(4);
		expect(fetchDetail).toHaveBeenCalledTimes(16);
		services.memberUsage.summary("member_a");
		await services.memberUsage.refresh("member_a");
		expect(fetchDetail).toHaveBeenCalledTimes(16);
	});

	it("请求超时释放采集槽位，迟到结果不能写入；TTL内新增会话仍触发采集", async () => {
		const { services, member, session, usageStore, members } = setup();
		member("member_a");
		for (let i = 0; i < 8; i++) session(`s${i}`, "member_a");
		let late: ((value: GatewaySessionInfo) => void) | undefined;
		const fetchDetail = vi.spyOn(services.gateway, "getSession").mockImplementation(async (id) => {
			if (id === "s0")
				return new Promise<GatewaySessionInfo>((resolve) => {
					late = resolve;
				});
			return detail(id);
		});
		const usage = createMemberUsageService({
			store: usageStore,
			members,
			gateway: services.gateway,
			sessionIndex: services.sessionIndex,
			detailTimeoutMs: 5,
		});
		await usage.refresh("member_a", true);
		expect(usage.summary("member_a")).toMatchObject({
			refresh_status: "partial",
			completed_sessions: 8,
			metrics: { input_tokens: { value: 70, covered_sessions: 7 } },
		});
		late?.(detail("s0", 100));
		await Promise.resolve();
		expect(usage.summary("member_a").metrics.input_tokens.value).toBe(70);
		fetchDetail.mockImplementation(async (id) => detail(id));
		session("s8", "member_a");
		expect(usage.summary("member_a").refresh_status).toBe("refreshing");
		await usage.refresh("member_a");
		expect(usage.summary("member_a")).toMatchObject({
			session_count: 9,
			refresh_status: "idle",
			metrics: { input_tokens: { value: 90, covered_sessions: 9 } },
		});
	});

	it("缺失、零、远端不存在和查询失败分别显示；失败保留上次快照，恢复后更新", async () => {
		const { services, member, session } = setup();
		member("member_a");
		member("member_empty");
		for (const id of ["known-zero", "partial", "missing", "failed"]) session(id, "member_a");
		const fetchDetail = vi.spyOn(services.gateway, "getSession").mockImplementation(async (id) => {
			if (id === "missing") return null;
			if (id === "failed") throw new Error("secret-provider-error");
			if (id === "partial") return { session_id: id, status: "idle", usage: { input_tokens: 5 } };
			return { session_id: id, status: "idle", usage: { input_tokens: 0, output_tokens: 0 } };
		});
		await services.memberUsage.refresh("member_a", true);
		const summary = services.memberUsage.summary("member_a");
		expect(summary).toMatchObject({
			refresh_status: "partial",
			session_count: 4,
			metrics: {
				input_tokens: { value: 5, covered_sessions: 2 },
				output_tokens: { value: 0, covered_sessions: 1 },
				active_seconds: { value: null, covered_sessions: 0 },
			},
		});
		expect(JSON.stringify(summary)).not.toContain("secret");
		const rows = services.memberUsage.list("member_a", { limit: 20 }).data;
		expect(rows.find((row) => row.session_id === "missing")?.collection_status).toBe("not_found");
		expect(rows.find((row) => row.session_id === "failed")?.collection_status).toBe("failed");
		fetchDetail.mockRejectedValue(new Error("offline"));
		await services.memberUsage.refresh("member_a", true);
		expect(services.memberUsage.summary("member_a").metrics.input_tokens.value).toBe(5);
		fetchDetail.mockImplementation(async (id) => detail(id));
		await services.memberUsage.refresh("member_a", true);
		expect(services.memberUsage.summary("member_a")).toMatchObject({
			refresh_status: "idle",
			metrics: { input_tokens: { value: 40, covered_sessions: 4 } },
		});
		await services.memberUsage.refresh("member_empty");
		expect(services.memberUsage.summary("member_empty")).toMatchObject({
			session_count: 0,
			metrics: { input_tokens: { value: 0, covered_sessions: 0 } },
		});
	});

	it("删除快照持久化后抵抗迟到刷新，删除成功仍计入总量；解封重试也不接受旧响应", async () => {
		const { services, member, session, usageStore, dataDir } = setup();
		member("member_a");
		session("deleted", "member_a");
		session("retry", "member_a");
		usageStore.syncMember("member_a");
		const oldDeletedRevision = usageStore.beginCapture("deleted") as number;
		const oldRetryRevision = usageStore.beginCapture("retry") as number;
		services.memberUsage.captureFinal("deleted", detail("deleted", 30));
		services.memberUsage.markDeleted("deleted");
		services.memberUsage.captureFinal("retry", detail("retry", 40));
		services.memberUsage.releaseFinal("retry");
		expect(usageStore.save("deleted", { input_tokens: 1 }, "running", oldDeletedRevision)).toBe(false);
		expect(usageStore.save("retry", { input_tokens: 1 }, "running", oldRetryRevision)).toBe(false);
		expect(services.sessionIndex.get("deleted")).toBeNull();
		expect(usageStore.summary("member_a")).toMatchObject({
			session_count: 2,
			deleted_session_count: 1,
			metrics: { input_tokens: { value: 70, covered_sessions: 2 } },
		});
		const reopened = openDatabase(dataDir);
		cleanup.push(() => reopened.close());
		const recovered = createSessionUsageStore(reopened);
		expect(recovered.summary("member_a").metrics.input_tokens.value).toBe(70);
		expect(
			recovered.list("member_a", { limit: 20 }).data.find((row) => row.session_id === "deleted")?.deleted_at,
		).toBeTruthy();
	});

	it("读取同步不让本地过期running覆盖采集后的idle或已封存状态", async () => {
		const { services, member, session } = setup();
		member("member_a");
		session("s", "member_a");
		services.sessionIndex.setStatus("s", "running");
		vi.spyOn(services.gateway, "getSession").mockImplementation(async (id) => detail(id));
		await services.memberUsage.refresh("member_a", true);
		services.memberUsage.summary("member_a");
		expect(services.memberUsage.list("member_a", { limit: 20 }).data[0]?.status).toBe("idle");
		services.memberUsage.captureFinal("s", { ...detail("s"), status: "terminated" });
		services.memberUsage.summary("member_a");
		expect(services.memberUsage.list("member_a", { limit: 20 }).data[0]?.status).toBe("terminated");
		expect(services.memberUsage.hasFinalSnapshot("s")).toBe(true);
	});

	it("缺少主要用量或SQLite提交失败不能封存，已有值与会话索引保留", () => {
		const { services, member, session, usageStore, db } = setup();
		member("member_a");
		session("s", "member_a");
		expect(() => services.memberUsage.captureFinal("s", { session_id: "s", status: "idle" })).toThrow(
			"有效的最终会话用量",
		);
		usageStore.syncMember("member_a");
		db.exec(
			"CREATE TRIGGER reject_snapshot BEFORE UPDATE ON kit_session_usage BEGIN SELECT RAISE(ABORT, 'test write failure'); END;",
		);
		expect(() => services.memberUsage.captureFinal("s", detail("s"))).toThrow("test write failure");
		expect(services.memberUsage.hasFinalSnapshot("s")).toBe(false);
		expect(services.sessionIndex.get("s")).not.toBeNull();
		expect(() => services.memberUsage.markDeleted("s")).toThrow("先成功保存");
	});

	it("管理端列表和详情合同，auditor可读，非管理员拒绝，游标绑定成员与Agent", async () => {
		const { services, member, session, app } = setup();
		member("member_a");
		member("member_b");
		session("s1", "member_a");
		session("s2", "member_a");
		vi.spyOn(services.gateway, "getSession").mockImplementation(async (id) => detail(id));
		await services.memberUsage.refresh("member_a", true);
		await services.memberUsage.refresh("member_b", true);
		const list = await app.request("/api/admin/members", { headers: admin });
		expect(list.status).toBe(200);
		expect(
			((await list.json()) as MembersPage).data.find((row) => row.member_id === "member_a")?.usage_summary
				?.session_count,
		).toBe(2);
		const usage = await app.request("/api/admin/members/member_a/usage", { headers: auditor });
		expect(usage.status).toBe(200);
		expect(usage.headers.get("cache-control")).toBe("no-store");
		expect(((await usage.json()) as { data: MemberUsageSummary }).data.metrics.input_tokens.value).toBe(20);
		expect((await app.request("/api/admin/members/member_a/usage")).status).toBe(401);
		expect(
			(await app.request("/api/admin/members/member_a/usage", { headers: { authorization: "Bearer member-invalid" } }))
				.status,
		).toBe(403);
		expect((await app.request("/api/admin/members/missing/usage", { headers: admin })).status).toBe(404);
		const page = await app.request("/api/admin/members/member_a/sessions?limit=1", { headers: auditor });
		const body = (await page.json()) as { next_cursor: string; data: unknown[] };
		expect(body.data).toHaveLength(1);
		expect(body.next_cursor).toBeTruthy();
		for (const path of [
			`member_b/sessions?cursor=${body.next_cursor}`,
			`member_a/sessions?agent_slug=other&cursor=${body.next_cursor}`,
			"member_a/sessions?cursor=bad",
		]) {
			expect((await app.request(`/api/admin/members/${path}`, { headers: admin })).status).toBe(400);
		}
	});

	it("模版用量以模版为主键：只统计从其上架条目发起的会话，旧条目会话不计入，0 会话模版也返回", async () => {
		const { services, member, session, db, app } = setup();
		member("member_a");
		member("member_b");
		// 模拟同智能体两个条目：只有模版上架条目计入，手动创建的旧条目会话不算。
		services.catalog.create({
			slug: "template-tpl",
			display_name: "模版上架条目",
			remote_agent_id: "agent_x",
		});
		services.catalog.setStatus("template-tpl", "listed");
		services.catalog.create({ slug: "legacy-dup", display_name: "旧条目", remote_agent_id: "agent_x" });
		const templateStore = createTemplateStore(db);
		const created = templateStore.create({
			name: "客服模版",
			remote_agent_id: "agent_x",
			remote_agent_name: "xktest",
			remote_environment_id: "env_x",
			remote_environment_name: "default",
			description: "",
			opening_remarks: "",
			suggested_prompts: [],
			files: [],
			memory_stores: [],
			vault_ids: [],
			category: "general",
		});
		templateStore.saveListing(created.template_id, () => services.catalog.getBySlug("template-tpl")!);
		templateStore.create({
			name: "空闲模版",
			remote_agent_id: "agent_idle",
			remote_agent_name: "idle",
			remote_environment_id: "env_idle",
			remote_environment_name: "default",
			description: "",
			opening_remarks: "",
			suggested_prompts: [],
			files: [],
			memory_stores: [],
			vault_ids: [],
			category: "general",
		});
		session("s1", "member_a", "legacy-dup");
		session("s2", "member_b", "legacy-dup");
		session("s3", "member_a", "template-tpl");
		session("s5", "member_a", "template-tpl");
		session("s4", "member_a", "ghost-slug");
		services.memberUsage.captureFinal("s1", detail("s1", 10));
		services.memberUsage.captureFinal("s2", detail("s2", 20));
		services.memberUsage.captureFinal("s3", detail("s3", 5));
		services.memberUsage.captureFinal("s5", detail("s5", 7));
		services.memberUsage.markDeleted("s5");

		const rows = services.memberUsage.summaryByTemplate();
		expect(rows.map((row) => row.name)).toEqual(["客服模版", "空闲模版"]);
		expect(rows[0]).toMatchObject({
			template_id: created.template_id,
			name: "客服模版",
			remote_agent_id: "agent_x",
			remote_agent_name: "xktest",
			listing_status: "listed",
			session_count: 2,
			deleted_session_count: 1,
			metrics: { input_tokens: { value: 12, covered_sessions: 2 } },
		});
		expect(rows[1]).toMatchObject({
			name: "空闲模版",
			remote_agent_id: "agent_idle",
			listing_status: "unlisted",
			session_count: 0,
			metrics: { input_tokens: { value: 0, covered_sessions: 0 } },
		});

		// search 按模版名/智能体名（大小写不敏感）/模版 ID 过滤；LIKE 通配符按字面匹配。
		expect(services.memberUsage.summaryByTemplate({ search: "客服" }).map((row) => row.name)).toEqual(["客服模版"]);
		expect(services.memberUsage.summaryByTemplate({ search: "XKTEST" }).map((row) => row.name)).toEqual(["客服模版"]);
		expect(services.memberUsage.summaryByTemplate({ search: "空闲" }).map((row) => row.name)).toEqual(["空闲模版"]);
		expect(services.memberUsage.summaryByTemplate({ search: "不存在的模版" })).toEqual([]);
		expect(services.memberUsage.summaryByTemplate({ search: "%" })).toEqual([]);

		const response = await app.request("/api/admin/usage/templates", { headers: auditor });
		expect(response.status).toBe(200);
		expect(
			((await response.json()) as { data: TemplateUsageRow[] }).data.some(
				(row) => row.name === "客服模版" && row.session_count === 2,
			),
		).toBe(true);
		const searched = await app.request(`/api/admin/usage/templates?search=${encodeURIComponent("客服")}`, {
			headers: auditor,
		});
		expect(searched.status).toBe(200);
		expect(((await searched.json()) as { data: TemplateUsageRow[] }).data.map((row) => row.name)).toEqual(["客服模版"]);
		expect((await app.request("/api/admin/usage/templates")).status).toBe(401);
	});

	it("模版会话明细跨成员返回上架条目的用量行并附带成员资料；游标与合同", async () => {
		const { services, member, session, db, app } = setup();
		member("member_a");
		member("member_b");
		services.catalog.create({
			slug: "template-tpl",
			display_name: "模版上架条目",
			remote_agent_id: "agent_x",
		});
		const templateStore = createTemplateStore(db);
		const created = templateStore.create({
			name: "客服模版",
			remote_agent_id: "agent_x",
			remote_agent_name: "xktest",
			remote_environment_id: "env_x",
			remote_environment_name: "default",
			description: "",
			opening_remarks: "",
			suggested_prompts: [],
			files: [],
			memory_stores: [],
			vault_ids: [],
			category: "general",
		});
		templateStore.saveListing(created.template_id, () => services.catalog.getBySlug("template-tpl")!);
		session("s1", "member_a", "legacy-dup");
		session("s2", "member_b", "template-tpl");
		session("s3", "member_a", "template-tpl");
		services.memberUsage.captureFinal("s1", detail("s1", 10));
		services.memberUsage.captureFinal("s2", detail("s2", 20));
		services.memberUsage.captureFinal("s3", detail("s3", 5));

		const page = services.memberUsage.listByTemplate(created.template_id, { limit: 20 });
		expect(page.data.map((row) => [row.session_id, row.member_display_name, row.member_username])).toEqual([
			["s3", "member_a", "member_a"],
			["s2", "member_b", "member_b"],
		]);
		expect(page.next_cursor).toBeUndefined();
		expect(page.data.some((row) => row.session_id === "s1")).toBe(false);

		const first = await app.request(`/api/admin/usage/templates/${created.template_id}/sessions?limit=1`, {
			headers: auditor,
		});
		expect(first.status).toBe(200);
		const body = (await first.json()) as { data: TemplateSessionUsage[]; next_cursor?: string };
		expect(body.data).toHaveLength(1);
		expect(body.next_cursor).toBeTruthy();
		const second = await app.request(
			`/api/admin/usage/templates/${created.template_id}/sessions?limit=1&cursor=${body.next_cursor}`,
			{ headers: admin },
		);
		expect(second.status).toBe(200);
		expect(((await second.json()) as { data: unknown[] }).data).toHaveLength(1);
		expect(
			(await app.request(`/api/admin/usage/templates/${created.template_id}/sessions?cursor=bad`, { headers: admin }))
				.status,
		).toBe(400);
		expect((await app.request(`/api/admin/usage/templates/${created.template_id}/sessions`)).status).toBe(401);
		expect((await app.request("/api/admin/usage/templates/template_missing/sessions", { headers: admin })).status).toBe(
			404,
		);
	});

	it("模版限额路由：auditor 可读不可写，未设置返回不限量，模版不存在 404", async () => {
		const { services, db, app } = setup();
		services.catalog.create({ slug: "tpl-l", display_name: "限额条目", remote_agent_id: "agent_z" });
		const templates = createTemplateStore(db);
		const created = templates.create({
			name: "限额模版",
			remote_agent_id: "agent_z",
			remote_agent_name: "zagent",
			remote_environment_id: "env_z",
			remote_environment_name: "default",
			description: "",
			opening_remarks: "",
			suggested_prompts: [],
			files: [],
			memory_stores: [],
			vault_ids: [],
			category: "general",
		});
		templates.saveListing(created.template_id, () => services.catalog.getBySlug("tpl-l")!);
		const path = `/api/admin/usage/templates/${created.template_id}/usage-limit`;
		const initial = await app.request(path, { headers: auditor });
		expect(initial.status).toBe(200);
		expect(((await initial.json()) as { data: { override: null } }).data.override).toBeNull();
		const put = await app.request(path, {
			method: "PUT",
			headers: { ...auditor, "content-type": "application/json" },
			body: JSON.stringify({ monthly_tokens: 10, monthly_active_seconds: null }),
		});
		expect(put.status).toBe(403);
		const putAdmin = await app.request(path, {
			method: "PUT",
			headers: { ...admin, "content-type": "application/json" },
			body: JSON.stringify({ monthly_tokens: 10, monthly_active_seconds: null }),
		});
		expect(putAdmin.status).toBe(200);
		expect(
			((await putAdmin.json()) as { data: { override: { monthly_tokens: number } } }).data.override.monthly_tokens,
		).toBe(10);
		expect((await app.request(path, { method: "DELETE", headers: admin })).status).toBe(200);
		expect(
			(await app.request("/api/admin/usage/templates/template_missing/usage-limit", { headers: admin })).status,
		).toBe(404);
	});

	it("模版用量逐日趋势路由：auditor 可读、days 校验、模版 404，只计模版上架条目", async () => {
		const { services, db, app, member } = setup();
		member("member_a");
		services.catalog.create({ slug: "trend-tpl", display_name: "趋势条目", remote_agent_id: "agent_t" });
		const templates = createTemplateStore(db);
		const created = templates.create({
			name: "趋势模版",
			remote_agent_id: "agent_t",
			remote_agent_name: "tagent",
			remote_environment_id: "env_t",
			remote_environment_name: "default",
			description: "",
			opening_remarks: "",
			suggested_prompts: [],
			files: [],
			memory_stores: [],
			vault_ids: [],
			category: "general",
		});
		templates.saveListing(created.template_id, () => services.catalog.getBySlug("trend-tpl")!);
		const usageDay = new Date().toISOString().slice(0, 10);
		db.prepare(
			"INSERT INTO kit_usage_limit_agent_days (agent_slug, day, tokens, active_seconds) VALUES (?, ?, ?, ?)",
		).run("trend-tpl", usageDay, 120, 1.5);
		db.prepare(
			"INSERT INTO kit_usage_limit_agent_days (agent_slug, day, tokens, active_seconds) VALUES (?, ?, ?, ?)",
		).run("rogue-entry", usageDay, 999, 9); // 非模版上架条目

		const response = await app.request(`/api/admin/usage/templates/daily-trend?template_id=${created.template_id}`, {
			headers: auditor,
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as { data: TemplateUsageTrend };
		expect(body.data.days).toBe(7);
		expect(body.data.data).toHaveLength(7);
		expect(body.data.data.at(-1)?.day).toBe(body.data.to_day); // 零值补全到今天（UTC 日键）
		expect(body.data.data.filter((point) => point.tokens > 0)).toEqual([
			{ day: usageDay, tokens: 120, active_seconds: 1.5 },
		]);
		// 「全部」视角（缺省 template_id）聚合全部模版条目，非模版条目不计入。
		const all = await app.request("/api/admin/usage/templates/daily-trend?days=14", { headers: auditor });
		expect(all.status).toBe(200);
		const allBody = (await all.json()) as { data: TemplateUsageTrend };
		expect(allBody.data.days).toBe(14);
		expect(allBody.data.data.reduce((sum, point) => sum + point.tokens, 0)).toBe(120);

		expect((await app.request("/api/admin/usage/templates/daily-trend?days=5", { headers: admin })).status).toBe(400);
		expect(
			(await app.request("/api/admin/usage/templates/daily-trend?template_id=missing", { headers: admin })).status,
		).toBe(404);
		expect((await app.request("/api/admin/usage/templates/daily-trend")).status).toBe(401);
	});

	it("模型/工具用量明细：auditor 可读、workspace 由服务端注入、区间与参数校验", async () => {
		const { db, services, app, member, session } = setup();
		let captured: ModelUsageRequest | undefined;
		const original = services.gateway.listModelUsage.bind(services.gateway);
		services.gateway.listModelUsage = async (request) => {
			captured = request;
			return original(request);
		};

		expect((await app.request("/api/admin/usage/model-usage")).status).toBe(401);

		// mock 遥测以本地账本为源，且只算模版上架条目的会话：登记模版条目会话与一条手动条目会话。
		// 两者都属于 member_a、各采集一次快照（输入 10）；只有模版条目的会话应进入明细。
		member("member_a");
		const now0 = new Date().toISOString();
		db.prepare(
			"INSERT INTO catalog_agents (id, slug, display_name, remote_agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
		).run("cat-t1", "template_t1", "模版条目", "agent-a", now0, now0);
		db.prepare(
			"INSERT INTO kit_templates (template_id, name, remote_agent_id, remote_agent_name, config_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		).run("t1", "模版一", "agent-a", "agent-a", "{}", now0);
		db.prepare("INSERT INTO kit_template_listings (template_id, catalog_id) VALUES (?, ?)").run("t1", "cat-t1");
		session("s-template", "member_a", "template_t1");
		session("s-manual", "member_a", "agent-manual");
		vi.spyOn(services.gateway, "getSession").mockImplementation(async (id) => detail(id));
		await services.memberUsage.refresh("member_a", true);

		const now = Date.now();
		const ok = await app.request(
			`/api/admin/usage/model-usage?start_time=${now - 3_600_000}&end_time=${now}&page_size=1`,
			{ headers: auditor },
		);
		expect(ok.status).toBe(200);
		const page = (await ok.json()) as { data: ModelUsagePage };
		expect(page.data.items[0]?.workspace_id).toBe("ws-mock");
		// 全量只含模版条目的那 1 个会话（输入 10），手动条目的 10 个 input 不计入。
		expect(page.data.items[0]?.tokens.input_tokens).toBe(10);
		expect(page.data.items[0]?.call_count).toBe(1);
		expect(captured?.scope).toEqual({ type: "workspace", workspace_ids: ["ws-mock"] });

		// agent_id 归集：模版上架条目的会话命中，手动条目与无关智能体都不命中。
		const scoped = await app.request("/api/admin/usage/model-usage?agent_id=agent-a", { headers: auditor });
		expect(((await scoped.json()) as { data: ModelUsagePage }).data.total).toBe(1);
		const manual = await app.request("/api/admin/usage/model-usage?agent_id=agent-manual", { headers: auditor });
		expect(((await manual.json()) as { data: ModelUsagePage }).data.total).toBe(0);
		const missed = await app.request("/api/admin/usage/model-usage?agent_id=agent-missing", { headers: auditor });
		expect(((await missed.json()) as { data: ModelUsagePage }).data.total).toBe(0);

		// session 口径：只传 session_id，无时间区间与 workspace_ids。
		const sessionScoped = await app.request("/api/admin/usage/model-usage?session_id=sesn_abc", { headers: auditor });
		expect(sessionScoped.status).toBe(200);
		expect(captured?.scope).toEqual({ type: "session", session_id: "sesn_abc" });
		expect(captured?.time_range).toBeUndefined();

		const reversed = await app.request(`/api/admin/usage/model-usage?start_time=${now}&end_time=${now - 3_600_000}`, {
			headers: admin,
		});
		expect(reversed.status).toBe(400);
		expect((await app.request("/api/admin/usage/model-usage?sort_by=nonsense", { headers: admin })).status).toBe(400);
		expect((await app.request("/api/admin/usage/tool-usage?page_size=101", { headers: admin })).status).toBe(400);

		const tools = await app.request("/api/admin/usage/tool-usage?source=mcp", { headers: auditor });
		expect(tools.status).toBe(200);
		const toolPage = (await tools.json()) as { data: ToolUsagePage };
		expect(toolPage.data.items.every((row) => row.source === "mcp")).toBe(true);
	});

	it("遥测 workspace 注入跟随网关模式：sdk 显式工作空间生效，仅 Base URL 配置时明确报错", async () => {
		const explicit = setup({
			KIT_GATEWAY: "sdk",
			BAILIAN_API_KEY: "sk-telemetry",
			BAILIAN_WORKSPACE_ID: "ws-real",
		});
		const captured: ModelUsageRequest[] = [];
		vi.spyOn(explicit.services.gateway, "listModelUsage").mockImplementation(async (request) => {
			captured.push(request);
			return {
				items: [],
				total: 0,
				total_call_count: 0,
				data_updated_at: 0,
				page_no: 1,
				page_size: 20,
				has_more: false,
			} as unknown as ModelUsagePage;
		});
		const ok = await explicit.app.request("/api/admin/usage/model-usage", { headers: auditor });
		expect(ok.status).toBe(200);
		expect(captured[0]?.scope).toEqual({ type: "workspace", workspace_ids: ["ws-real"] });

		// 仅凭 BAILIAN_API_KEY + BAILIAN_BASE_URL 是合法启动配置；查询无法确定工作空间时
		// 明确报错，不得退回演示值 ws-mock（会把查询发到错误范围）。
		const missing = setup({
			KIT_GATEWAY: "sdk",
			BAILIAN_API_KEY: "sk-telemetry",
			BAILIAN_BASE_URL: "https://provider.example.test/api/v1/agentstudio",
		});
		const failed = await missing.app.request("/api/admin/usage/model-usage", { headers: auditor });
		expect(failed.status).toBe(400);
		const body = (await failed.json()) as { error: { details?: { workspace_unconfigured?: boolean } } };
		expect(body.error.details?.workspace_unconfigured).toBe(true);
	});
});
