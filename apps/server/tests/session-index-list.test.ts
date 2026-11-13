import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CatalogAgentViewSchema } from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";
import { createSessionIndex } from "../src/store/sessions.ts";

const close: (() => void)[] = [];
afterEach(() => {
	for (const fn of close.splice(0).reverse()) fn();
});

function setupDb() {
	const directory = mkdtempSync(join(tmpdir(), "kit-index-list-"));
	close.push(() => rmSync(directory, { recursive: true, force: true }));
	const db = openDatabase(directory);
	close.push(() => db.close());
	return db;
}

function stamp(db: ReturnType<typeof openDatabase>, sessionId: string, createdAt: string, lastEventAt: string | null) {
	db.prepare("UPDATE kit_sessions SET created_at = ?, last_event_at = ? WHERE session_id = ?").run(
		createdAt,
		lastEventAt,
		sessionId,
	);
}

const T = {
	s1: { created: "2026-01-01T00:00:00.000Z", event: "2026-03-05T00:00:00.000Z" },
	s2: { created: "2026-01-10T00:00:00.000Z", event: "2026-03-02T00:00:00.000Z" },
	s3: { created: "2026-02-01T00:00:00.000Z", event: "2026-01-15T00:00:00.000Z" },
	s4: { created: "2026-02-15T00:00:00.000Z", event: null },
};

/** 列表读取是侧栏「最近/智能体分组」的数据源：排序与单页上限在这里锁定。 */
describe("会话索引列表", () => {
	it("先查本人完整智能体目录，再按组分页；归档在截取前排除，游标绑定身份和筛选", () => {
		const db = setupDb();
		const index = createSessionIndex(db);
		for (let i = 0; i < 205; i++) {
			index.create({ sessionId: `a-${String(i).padStart(3, "0")}`, subjectId: "owner", agentSlug: "assistant" });
			stamp(db, `a-${String(i).padStart(3, "0")}`, "2026-01-01T00:00:00.000Z", null);
			index.create({ sessionId: `archived-${i}`, subjectId: "owner", agentSlug: "assistant" });
			index.setStatus(`archived-${i}`, "archived");
		}
		index.create({ sessionId: "writer-old", subjectId: "owner", agentSlug: "writer" });
		index.create({ sessionId: "foreign", subjectId: "another", agentSlug: "private-agent" });
		index.create({
			sessionId: "debug",
			subjectId: "owner",
			purpose: "admin_debug",
			debug: { project_name: "p", agent_key: "a", remote_agent_id: "r" },
		});
		index.create({ sessionId: "only-archived", subjectId: "owner", agentSlug: "archived-agent" });
		index.setStatus("only-archived", "archived");
		expect(new Set(index.listAgentsForSubject("owner"))).toEqual(new Set(["assistant", "writer"]));
		expect(index.listAgentsForSubject("another")).toEqual(["private-agent"]);
		const query = { agentSlug: "assistant", limit: 200, includeArchived: false };
		const first = index.pageForSubject("owner", query);
		expect(first.data).toHaveLength(200);
		expect(first.data.every((row) => row.status !== "archived")).toBe(true);
		expect(first.next_page_token).not.toBeNull();
		const second = index.pageForSubject("owner", { ...query, pageToken: first.next_page_token as string });
		expect(second.data).toHaveLength(5);
		expect(second.next_page_token).toBeNull();
		expect(new Set([...first.data, ...second.data].map((row) => row.session_id)).size).toBe(205);
		expect(
			index.pageForSubject("owner", { agentSlug: "writer", includeArchived: false }).data.map((row) => row.session_id),
		).toEqual(["writer-old"]);
		for (const [subject, options] of [
			["another", query],
			["owner", { ...query, agentSlug: "writer" }],
			["owner", { ...query, includeArchived: true }],
		] as const)
			expect(() => index.pageForSubject(subject, { ...options, pageToken: first.next_page_token as string })).toThrow(
				"游标无效",
			);
		expect(() => index.pageForSubject("owner", { pageToken: "invalid" })).toThrow("游标无效");
	});

	it("按最近活动排序：last_event_at 优先，缺失时回落 created_at", () => {
		const db = setupDb();
		const index = createSessionIndex(db);
		// 打乱创建顺序，证明结果只由活动时间决定
		for (const id of ["s3", "s1", "s4", "s2"])
			index.create({ sessionId: id, subjectId: "user-1", agentSlug: "assistant" });
		for (const [id, value] of Object.entries(T)) stamp(db, id, value.created, value.event);
		expect(index.listForSubject("user-1").map((row) => row.session_id)).toEqual(["s1", "s2", "s4", "s3"]);
	});

	it("点开回看不改排序：状态回落不推进 last_event_at，发消息才推进", () => {
		const db = setupDb();
		const index = createSessionIndex(db);
		index.create({ sessionId: "s1", subjectId: "user-1", agentSlug: "assistant" });
		index.create({ sessionId: "s2", subjectId: "user-1", agentSlug: "assistant" });
		stamp(db, "s1", "2026-01-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z");
		stamp(db, "s2", "2026-01-01T00:00:00.000Z", "2026-03-05T00:00:00.000Z");
		expect(index.listForSubject("user-1").map((row) => row.session_id)).toEqual(["s2", "s1"]);
		// 打开会话会触发水合终态回落（onStatus → setStatus）：只同步状态，位置不动
		index.setStatus("s1", "idle");
		expect(index.listForSubject("user-1").map((row) => row.session_id)).toEqual(["s2", "s1"]);
		// 真实对话活动（发消息）才把 s1 顶到最前
		index.touch("s1", "running");
		expect(index.listForSubject("user-1").map((row) => row.session_id)).toEqual(["s1", "s2"]);
	});

	it("agent 过滤分支同样按最近活动排序", () => {
		const db = setupDb();
		const index = createSessionIndex(db);
		index.create({ sessionId: "w-old", subjectId: "user-1", agentSlug: "writer" });
		index.create({ sessionId: "a-new", subjectId: "user-1", agentSlug: "assistant" });
		index.create({ sessionId: "w-new", subjectId: "user-1", agentSlug: "writer" });
		stamp(db, "w-old", "2026-01-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z");
		stamp(db, "a-new", "2026-01-01T00:00:00.000Z", "2026-03-04T00:00:00.000Z");
		stamp(db, "w-new", "2026-01-01T00:00:00.000Z", "2026-03-03T00:00:00.000Z");
		expect(index.listForSubject("user-1", { agentSlug: "writer" }).map((row) => row.session_id)).toEqual([
			"w-new",
			"w-old",
		]);
	});

	it("关键词在分页前检索标题与智能体，游标绑定关键词", () => {
		const db = setupDb();
		const index = createSessionIndex(db);
		index.create({ sessionId: "s1", subjectId: "owner", agentSlug: "assistant", title: "年度复盘" });
		index.create({ sessionId: "s2", subjectId: "owner", agentSlug: "writer", title: "周报" });
		index.create({ sessionId: "s3", subjectId: "owner", agentSlug: "assistant", title: "年度归档" });
		index.create({ sessionId: "s4", subjectId: "owner", agentSlug: "writer", title: "年度计划" });
		index.create({ sessionId: "foreign", subjectId: "another", agentSlug: "assistant", title: "年度复盘" });
		index.setStatus("s3", "archived");
		stamp(db, "s1", "2026-01-01T00:00:00.000Z", "2026-03-03T00:00:00.000Z");
		stamp(db, "s2", "2026-01-01T00:00:00.000Z", "2026-03-02T00:00:00.000Z");
		stamp(db, "s3", "2026-01-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z");
		stamp(db, "s4", "2026-01-01T00:00:00.000Z", "2026-03-04T00:00:00.000Z");
		const ids = (query: Parameters<typeof index.pageForSubject>[1]) =>
			index.pageForSubject("owner", query).data.map((row) => row.session_id);
		expect(ids({ q: "年度", includeArchived: false })).toEqual(["s4", "s1"]);
		expect(ids({ q: "年度", includeArchived: true })).toEqual(["s4", "s1", "s3"]);
		expect(ids({ q: "ASSISTANT", includeArchived: false })).toEqual(["s1"]);
		expect(ids({ q: "writer", includeArchived: false })).toEqual(["s4", "s2"]);
		// Catalog 展示名命中的智能体由路由解析为 slug 列表，与标题/slug 命中取并集。
		expect(ids({ q: "年度", includeArchived: false, agentSlugs: ["writer"] })).toEqual(["s4", "s1", "s2"]);
		const first = index.pageForSubject("owner", { q: "年度", includeArchived: true, limit: 2 });
		expect(first.data.map((row) => row.session_id)).toEqual(["s4", "s1"]);
		expect(first.next_page_token).not.toBeNull();
		expect(
			index
				.pageForSubject("owner", {
					q: "年度",
					includeArchived: true,
					limit: 2,
					pageToken: first.next_page_token as string,
				})
				.data.map((row) => row.session_id),
		).toEqual(["s3"]);
		expect(() =>
			index.pageForSubject("owner", {
				q: "周报",
				includeArchived: true,
				limit: 2,
				pageToken: first.next_page_token as string,
			}),
		).toThrow("游标无效");
	});

	it("缺省单页 50 条并保留最近活动的头部；显式 limit 生效", () => {
		const db = setupDb();
		const index = createSessionIndex(db);
		for (let i = 0; i < 55; i += 1) {
			const id = `s-${String(i).padStart(2, "0")}`;
			index.create({ sessionId: id, subjectId: "user-1", agentSlug: "assistant" });
			stamp(db, id, "2026-01-01T00:00:00.000Z", new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString());
		}
		const all = index.listForSubject("user-1");
		expect(all).toHaveLength(50);
		expect(all[0]?.session_id).toBe("s-54");
		expect(all.at(-1)?.session_id).toBe("s-05");
		expect(index.listForSubject("user-1", { limit: 2 }).map((row) => row.session_id)).toEqual(["s-54", "s-53"]);
	});

	it("HTTP 合同：limit 高于单页上限 200 被拒，200 可用", async () => {
		const directory = mkdtempSync(join(tmpdir(), "kit-index-list-http-"));
		close.push(() => rmSync(directory, { recursive: true, force: true }));
		const db = openDatabase(directory);
		close.push(() => db.close());
		const config = loadConfig({ KIT_GATEWAY: "mock", KIT_DATA_DIR: directory, ADMIN_TOKEN: "test-admin" });
		const services = createKitServices(config, db);
		const { member } = await services.members.create(
			{
				username: "owner",
				display_name: "Owner",
				auth_type: "local",
				password_mode: "custom",
				password: "Index!List2026",
			},
			"admin:test",
		);
		await services.sessions.create({ subjectId: member.member_id, agentSlug: "assistant", remoteAgentId: "mock" });
		const app = createApp(services);
		const login = await app.request("/api/kit/auth/login", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: "owner", password: "Index!List2026" }),
		});
		const headers = {
			authorization: `Bearer ${((await login.json()) as { data: { access_token: string } }).data.access_token}`,
		};
		expect((await app.request("/api/kit/sessions?limit=201", { headers })).status).toBe(400);
		const capped = await app.request("/api/kit/sessions?limit=200", { headers });
		expect(capped.status).toBe(200);
		expect(((await capped.json()) as { data: unknown[] }).data).toHaveLength(1);
		services.sessionIndex.create({
			sessionId: "other-member-session",
			subjectId: "another",
			agentSlug: "private-agent",
		});
		expect((await app.request("/api/kit/session-agents")).status).toBe(401);
		const agents = await app.request("/api/kit/session-agents?subject_id=another", { headers });
		expect(agents.status).toBe(200);
		expect(await agents.json()).toEqual({ data: ["assistant"] });
		const filtered = await app.request("/api/kit/sessions?agent_slug=assistant&include_archived=false", { headers });
		expect(filtered.status).toBe(200);
		expect(((await filtered.json()) as { data: { agent_slug: string }[] }).data.map((row) => row.agent_slug)).toEqual([
			"assistant",
		]);
		const searched = await app.request("/api/kit/sessions?q=ASSISTANT&include_archived=false", { headers });
		expect(searched.status).toBe(200);
		expect(((await searched.json()) as { data: unknown[] }).data).toHaveLength(1);
		services.catalog.insert(
			CatalogAgentViewSchema.parse({
				id: "cat-year-assistant",
				slug: "year-assistant",
				display_name: "年度助手",
				capabilities: {},
				remote_agent_id: "mock",
				status: "listed",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			}),
		);
		services.sessionIndex.create({
			sessionId: "display-name-session",
			subjectId: member.member_id,
			agentSlug: "year-assistant",
			title: "不相关标题",
		});
		const byDisplayName = await app.request("/api/kit/sessions?q=年度&include_archived=false", { headers });
		expect(byDisplayName.status).toBe(200);
		expect(
			((await byDisplayName.json()) as { data: { session_id: string }[] }).data.map((row) => row.session_id),
		).toEqual(["display-name-session"]);
		expect((await app.request("/api/kit/sessions?q=", { headers })).status).toBe(400);
		expect((await app.request(`/api/kit/sessions?q=${"x".repeat(101)}`, { headers })).status).toBe(400);
		expect((await app.request("/api/kit/sessions?page_token=invalid", { headers })).status).toBe(400);
	});
});
