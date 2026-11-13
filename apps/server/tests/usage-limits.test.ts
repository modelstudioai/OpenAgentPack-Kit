import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEvent, UsageLimitConfig } from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockGateway } from "../src/gateway/mock.ts";
import type { GatewaySessionInfo } from "../src/gateway/types.ts";
import { createUsageLimitService } from "../src/services/usage-limits.ts";
import { createAuditLog } from "../src/store/audit.ts";
import { createCatalogStore } from "../src/store/catalog.ts";
import { openDatabase } from "../src/store/db.ts";
import { createMemberStore } from "../src/store/members.ts";
import { createSessionUsageStore } from "../src/store/session-usage.ts";
import { createSessionIndex } from "../src/store/sessions.ts";
import { createTemplateStore } from "../src/store/templates.ts";
import { createUsageLimitStore } from "../src/store/usage-limits.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const close of cleanup.splice(0).reverse()) close();
});
const unlimited: UsageLimitConfig = {
	monthly_tokens: null,
	monthly_active_seconds: null,
	daily_tokens: null,
	daily_active_seconds: null,
};
/** 模版条目 fixture：catalog slug 与 setup 的会话 agentSlug 同名，限额外部数据最少。 */
function listing(db: ReturnType<typeof openDatabase>) {
	const catalog = createCatalogStore(db);
	const templates = createTemplateStore(db);
	catalog.create({ slug: "agent", display_name: "模版条目", remote_agent_id: "remote-x" });
	const created = templates.create({
		name: "客服模版",
		remote_agent_id: "remote-x",
		remote_agent_name: "xktest",
		remote_environment_id: "env-x",
		remote_environment_name: "default",
		description: "",
		opening_remarks: "",
		suggested_prompts: [],
		files: [],
		memory_stores: [],
		vault_ids: [],
		category: "general",
	});
	templates.saveListing(created.template_id, () => catalog.getBySlug("agent")!);
	return created.template_id;
}
function detail(id: string, input = 0, output = 0, seconds = 0): GatewaySessionInfo {
	return {
		session_id: id,
		status: "idle",
		usage: { input_tokens: input, output_tokens: output },
		stats: { active_seconds: seconds },
	};
}
function setup() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-usage-limits-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const db = openDatabase(dataDir);
	cleanup.push(() => db.close());
	const members = createMemberStore(db);
	const index = createSessionIndex(db);
	const snapshots = createSessionUsageStore(db);
	const store = createUsageLimitStore(db);
	const gateway = createMockGateway();
	const details = new Map<string, GatewaySessionInfo>();
	const events = new Map<string, SessionEvent[]>();
	let current = new Date("2026-10-31T23:59:00.000Z");
	let sequence = 0;
	const get = vi.spyOn(gateway, "getSession").mockImplementation(async (id) => details.get(id) ?? null);
	vi.spyOn(gateway, "listEvents").mockImplementation(async (id) => ({
		events: events.get(id) ?? [],
		next_page_token: null,
	}));
	function member(id = "member_a") {
		members.create(
			{
				member_id: id,
				username: id,
				display_name: id,
				auth_type: "local",
				status: "active",
				created_at: current.toISOString(),
				updated_at: current.toISOString(),
			},
			"unused",
		);
	}
	function session(id = "s", owner = "member_a") {
		index.create({ sessionId: id, subjectId: owner, agentSlug: "agent" });
		details.set(id, detail(id));
		events.set(id, []);
	}
	const send = vi.fn(async (id = "s") => {
		const eventId = `sent-${++sequence}`;
		events.get(id)?.push(
			{ event_id: eventId, type: "message", role: "user", content: [] },
			{
				event_id: `running-${sequence}`,
				type: "session_status",
				content: [],
				metadata: { status: "running" },
			},
		);
		const previous = details.get(id)!;
		details.set(id, { ...previous, status: "running" });
		return { event_ids: [eventId] };
	});
	function complete(id = "s", input = 120, output = 80, seconds = 2) {
		details.set(id, detail(id, input, output, seconds));
		events.get(id)?.push({
			event_id: `idle-${++sequence}`,
			type: "session_status",
			content: [],
			metadata: { status: "idle", stop_reason: { type: "completed" } },
		});
	}
	const make = (database = db, timeoutMs = 50) =>
		createUsageLimitService({
			store: createUsageLimitStore(database),
			members: createMemberStore(database),
			sessionIndex: createSessionIndex(database),
			snapshots: createSessionUsageStore(database),
			gateway,
			audit: createAuditLog(database),
			now: () => current,
			timeoutMs,
		});
	member();
	session();
	const service = make();
	return {
		db,
		dataDir,
		members,
		index,
		snapshots,
		store,
		gateway,
		details,
		events,
		get,
		member,
		session,
		send,
		complete,
		service,
		make,
		time: (iso: string) => {
			current = new Date(iso);
		},
		run: (key: string, id = "s") =>
			service.runSend(id, { text: "hello", clientMessageId: key }, undefined, () => send(id)),
	};
}

describe("成员月度 Session 用量准入", () => {
	it.each([
		{ monthly_tokens: 200, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
		{ monthly_tokens: null, monthly_active_seconds: 2, daily_tokens: null, daily_active_seconds: null },
		{ monthly_tokens: 500, monthly_active_seconds: 2, daily_tokens: null, daily_active_seconds: null },
	])("首次基线不追溯、增量不重计，任一启用维度达限拒绝下一轮 %#", async (limits) => {
		const f = setup();
		f.details.set("s", detail("s", 1000, 1000, 100));
		f.service.setPolicy(limits, "admin");
		expect((await f.service.member("member_a")).tokens.used).toBe(0);
		await f.run("first");
		f.complete("s", 1120, 1080, 102);
		expect(await f.service.member("member_a")).toMatchObject({ tokens: { used: 200 }, active_seconds: { used: 2 } });
		expect((await f.service.member("member_a")).tokens.used).toBe(200);
		await expect(f.run("second")).rejects.toMatchObject({ code: "quota_exceeded" });
		expect(f.send).toHaveBeenCalledTimes(1);
		await f.service.setMember(
			"member_a",
			{ monthly_tokens: 1000, monthly_active_seconds: 10, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		await expect(f.run("second")).resolves.toHaveProperty("event_ids");
	});

	it("零额度阻止首轮，override取消限制与恢复默认均保留已记用量", async () => {
		const f = setup();
		f.service.setPolicy(
			{ monthly_tokens: 0, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		await expect(f.run("zero")).rejects.toMatchObject({ code: "quota_exceeded" });
		expect(f.send).not.toHaveBeenCalled();
		await f.service.setMember("member_a", unlimited, "admin");
		await f.run("zero");
		f.complete();
		const reset = await f.service.resetMember("member_a", "admin");
		expect(reset).toMatchObject({ override: null, tokens: { used: 200, status: "exceeded" } });
		await expect(f.run("new")).rejects.toMatchObject({ code: "quota_exceeded" });
	});

	it("跨月完成归受理月，切月新轮只记新增量，重开数据库不重计", async () => {
		const f = setup();
		f.service.setPolicy(
			{ monthly_tokens: 1000, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		await f.run("october");
		f.time("2026-11-01T00:01:00.000Z");
		f.complete();
		expect(await f.service.member("member_a")).toMatchObject({ month: "2026-11", tokens: { used: 0 } });
		expect(f.store.totals("member_a", "2026-10").tokens).toBe(200);
		await f.run("november");
		f.complete("s", 300, 200, 5);
		expect((await f.service.member("member_a")).tokens.used).toBe(300);
		const reopened = openDatabase(f.dataDir);
		cleanup.push(() => reopened.close());
		const recovered = f.make(reopened);
		expect((await recovered.member("member_a")).tokens.used).toBe(300);
		await expect(
			recovered.runSend("s", { text: "hello", clientMessageId: "november" }, undefined, () => f.send()),
		).resolves.toEqual({ event_ids: ["sent-3"] });
		expect(f.send).toHaveBeenCalledTimes(2);
	});

	it("采集增量同事务写逐日账，视图返回近 30 天零值补全序列，零增量不重复落行", async () => {
		const f = setup();
		f.time("2026-10-30T10:00:00.000Z");
		await f.run("day1");
		f.complete();
		await f.service.member("member_a");
		expect(f.store.dailyUsage("member_a", "2026-10-01")).toEqual([
			{ day: "2026-10-30", tokens: 200, active_seconds: 2 },
		]);
		f.time("2026-10-31T10:00:00.000Z");
		await f.run("day2");
		f.complete("s", 300, 200, 5);
		const view = await f.service.member("member_a");
		expect(f.store.dailyUsage("member_a", "2026-10-01")).toEqual([
			{ day: "2026-10-30", tokens: 200, active_seconds: 2 },
			{ day: "2026-10-31", tokens: 300, active_seconds: 3 },
		]);
		expect(view.daily).toHaveLength(30);
		expect(view.daily.at(-1)).toEqual({ day: "2026-10-31", tokens: 300, active_seconds: 3 });
		expect(view.daily.at(0)).toEqual({ day: "2026-10-02", tokens: 0, active_seconds: 0 });
		// 重复采集零增量：日账不新增、不重计
		await f.service.member("member_a");
		expect(f.store.dailyUsage("member_a", "2026-10-01")).toHaveLength(2);
	});

	it("022 重建逐日账：月账增量按当日调用次数分摊，总和与月账一致", async () => {
		const f = setup();
		f.time("2026-10-30T10:00:00.000Z");
		await f.run("legacy");
		f.complete();
		await f.service.member("member_a"); // 月账 2026-10：200 tokens / 2s
		const seedTurn = (key: string, day: string) =>
			f.db
				.prepare(
					"INSERT INTO usage_turns (subject_id, agent_slug, session_id, client_message_id, day, month, created_at) VALUES ('member_a', 'agent', 's', ?, ?, '2026-10', ?)",
				)
				.run(key, day, `${day}T00:00:00.000Z`);
		seedTurn("t1", "2026-10-30");
		seedTurn("t2", "2026-10-30");
		seedTurn("t3", "2026-10-31");
		// 伪装旧库：逐日账不存在且 020~022 未应用，让 openDatabase 重放迁移
		f.db.exec("DROP TABLE kit_usage_limit_days");
		f.db
			.prepare(
				"DELETE FROM _kit_migrations WHERE id IN ('020_usage_limit_days', '021_usage_limit_days_backfill', '022_usage_limit_days_rebuild')",
			)
			.run();
		const reopened = openDatabase(f.dataDir);
		cleanup.push(() => reopened.close());
		const days = reopened
			.prepare("SELECT day, tokens, active_seconds FROM kit_usage_limit_days WHERE member_id = ? ORDER BY day")
			.all("member_a") as { day: string; tokens: number; active_seconds: number }[];
		// 200 tokens 按 2:1 下取整分摊为 133/66，余数 1 记到调用次数多的 10-30
		expect(days.map((day) => day.tokens)).toEqual([134, 66]);
		// 秒数按比例分摊，余量归最后一天，保证总和等于月账
		expect(days[0]?.active_seconds).toBeCloseTo(4 / 3, 6);
		expect(days[1]?.active_seconds).toBeCloseTo(2 / 3, 6);
		expect(days.reduce((sum, day) => sum + day.tokens, 0)).toBe(200);
	});

	it("缺失、回退、超时不放行启用维度，也不让迟到旧结果覆盖基线", async () => {
		const f = setup();
		f.service.setPolicy(
			{ monthly_tokens: 500, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		await f.run("first");
		f.complete();
		await f.service.member("member_a");
		f.details.set("s", { session_id: "s", status: "idle", usage: { input_tokens: 120 } });
		expect((await f.service.member("member_a")).tokens.status).toBe("unavailable");
		await expect(f.run("missing")).rejects.toMatchObject({ details: { usage_unavailable: true } });
		f.details.set("s", detail("s", 100, 80, 2));
		await expect(f.run("rollback")).rejects.toMatchObject({ code: "conflict" });
		let late!: (value: GatewaySessionInfo) => void;
		f.get.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					late = resolve;
				}),
		);
		expect((await f.make(f.db, 2).member("member_a")).tokens.status).toBe("unavailable");
		late(detail("s", 10000, 80, 2));
		await Promise.resolve();
		f.details.set("s", { session_id: "s", status: "idle", usage: { input_tokens: 120, output_tokens: 80 } });
		await f.run("valid-token-only");
		expect(f.store.totals("member_a", "2026-10").tokens).toBe(200);
		expect(f.send).toHaveBeenCalledTimes(2);
	});

	it("同成员并发单飞、相同请求持久回放，旧idle不能误认为受理后已完成", async () => {
		const f = setup();
		f.service.setPolicy(
			{ monthly_tokens: 1000, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		const result = await Promise.all([f.run("same"), f.run("same")]);
		expect(result[0]).toEqual(result[1]);
		expect(f.send).toHaveBeenCalledTimes(1);
		await expect(
			f.service.runSend("s", { text: "changed", clientMessageId: "same" }, undefined, () => f.send()),
		).rejects.toMatchObject({ code: "conflict" });
		f.session("second");
		f.details.set("s", detail("s")); // Provider GET 暂时仍是受理前的 idle，历史仍有 running。
		await expect(f.run("concurrent", "second")).rejects.toMatchObject({ code: "conflict" });
		f.complete();
		await f.run("concurrent", "second");
		expect(f.send).toHaveBeenCalledTimes(2);
	});

	it.each([
		{ monthly_tokens: 1000, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
		unlimited,
	])("结果不明跨重启不重发，删除封存后直接恢复其他会话且月累计不丢 %#", async (limits) => {
		const f = setup();
		f.service.setPolicy(limits, "admin");
		const failing = vi.fn(async () => {
			throw new Error("provider-secret");
		});
		await expect(
			f.service.runSend("s", { text: "private prompt", clientMessageId: "uncertain" }, undefined, failing),
		).rejects.toMatchObject({ code: "conflict", retryable: false });
		const reopened = openDatabase(f.dataDir);
		cleanup.push(() => reopened.close());
		const recovered = f.make(reopened);
		await expect(
			recovered.runSend("s", { text: "private prompt", clientMessageId: "uncertain" }, undefined, failing),
		).rejects.toMatchObject({ code: "conflict" });
		expect(failing).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(f.store.pending("member_a"))).not.toContain("private prompt");
		f.snapshots.syncMember("member_a");
		f.snapshots.finalize("s", { input_tokens: 120, output_tokens: 80, active_seconds: 2 }, "idle");
		f.snapshots.markDeleted("s");
		f.details.delete("s");
		f.session("new");
		await recovered.runSend("new", { text: "new", clientMessageId: "new" }, undefined, () => f.send("new"));
		expect((await recovered.member("member_a")).tokens.used).toBe(200);
	});

	it("审批允许继续执行也检查限额，拒绝不受额度阻挡", async () => {
		const f = setup();
		f.service.setPolicy(
			{ monthly_tokens: 200, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		await f.run("first");
		f.complete();
		const submit = vi.fn(async () => ({ event_ids: ["approval"] }));
		await expect(
			f.service.runApproval("s", { batch_id: "batch", call_id: "call", result: "allow" }, submit),
		).rejects.toMatchObject({ code: "quota_exceeded" });
		expect(submit).not.toHaveBeenCalled();
		await f.service.runApproval("s", { batch_id: "batch", call_id: "call", result: "deny" }, submit);
		expect(submit).toHaveBeenCalledTimes(1);
	});

	it("无基线时受理过的维度保留当月未知，不在稍后首次可读时伪装零消费", async () => {
		const f = setup();
		f.details.set("s", { session_id: "s", status: "idle", stats: { active_seconds: 0 } });
		await f.run("unlimited");
		f.complete();
		const configured = await f.service.setMember(
			"member_a",
			{ monthly_tokens: 1000, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		expect(configured.tokens).toMatchObject({ used: null, status: "unavailable" });
		await expect(f.run("blocked")).rejects.toMatchObject({ details: { usage_unavailable: true } });
		f.time("2026-11-01T00:01:00.000Z");
		await f.run("next-month");
		expect(f.store.totals("member_a", "2026-10").tokens_unknown).toBe(1);
		expect(f.store.totals("member_a", "2026-11").tokens_unknown).toBe(0);
	});

	it("发送前重读政策，异步检查期间收紧到0也不能放行", async () => {
		const f = setup();
		let release!: (value: GatewaySessionInfo) => void;
		f.get.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		const beforeSend = vi.fn();
		const pending = f.service.runSend("s", { text: "hello", clientMessageId: "policy-race" }, beforeSend, () =>
			f.send(),
		);
		const rejected = expect(pending).rejects.toMatchObject({ code: "quota_exceeded" });
		await vi.waitFor(() => expect(f.get).toHaveBeenCalled(), { interval: 1 });
		f.service.setPolicy(
			{ monthly_tokens: 0, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		release(detail("s"));
		await rejected;
		expect(beforeSend).not.toHaveBeenCalled();
		expect(f.send).not.toHaveBeenCalled();
		expect(f.store.pending("member_a")).toHaveLength(0);
	});

	it("跨月审批沿用原受理月限额，当前月余额不能放行已耗尽的旧轮", async () => {
		const f = setup();
		f.service.setPolicy(
			{ monthly_tokens: 200, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		await f.run("october");
		f.complete();
		f.details.set("s", { ...detail("s", 120, 80, 2), stop_reason: { type: "requires_action" } });
		f.time("2026-11-01T00:01:00.000Z");
		expect((await f.service.member("member_a")).tokens.used).toBe(0);
		const submit = vi.fn(async () => ({ event_ids: ["approval"] }));
		await expect(
			f.service.runApproval("s", { batch_id: "batch", call_id: "call", result: "allow" }, submit),
		).rejects.toMatchObject({
			code: "quota_exceeded",
			details: { month: "2026-10", reset_at: "2026-11-01T00:00:00.000Z" },
		});
		expect(submit).not.toHaveBeenCalled();
	});

	it("旧月缺失不污染本月读数，但旧轮必须结束且复用目标仍须新鲜基线", async () => {
		const f = setup();
		f.service.setPolicy(
			{ monthly_tokens: 1000, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		await f.run("october");
		f.complete();
		f.session("fresh");
		f.time("2026-11-01T00:01:00.000Z");
		f.details.delete("s");
		expect((await f.service.member("member_a")).tokens).toMatchObject({ used: 0, status: "ok" });
		await expect(f.run("new-month", "fresh")).rejects.toMatchObject({ code: "conflict" });
		f.details.set("s", detail("s", 120, 80, 2));
		await f.run("new-month", "fresh");
		f.complete("fresh");
		f.details.delete("s");
		expect((await f.service.member("member_a")).tokens).toMatchObject({ used: 200, status: "ok" });
		await expect(f.run("reuse-old", "s")).rejects.toMatchObject({ details: { usage_unavailable: true } });
		await f.run("new-again", "fresh");
		expect(f.send).toHaveBeenCalledTimes(3);
	});

	it("跨月时缺失的未限额维度保留两月未知，恢复累计不能伪装为本月已知消费", async () => {
		const f = setup();
		f.service.setPolicy(
			{ monthly_tokens: null, monthly_active_seconds: 10, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		await f.run("october");
		f.complete();
		f.details.set("s", { session_id: "s", status: "idle", stats: { active_seconds: 2 } });
		f.time("2026-11-01T00:01:00.000Z");
		await f.run("november");
		f.complete("s", 240, 160, 4);
		const current = await f.service.setMember(
			"member_a",
			{ monthly_tokens: 1000, monthly_active_seconds: 10, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		expect(current).toMatchObject({
			tokens: { used: null, status: "unavailable" },
			active_seconds: { used: 2, status: "ok" },
		});
		expect(f.store.totals("member_a", "2026-10").tokens_unknown).toBe(1);
		expect(f.store.totals("member_a", "2026-11").tokens_unknown).toBe(1);
		await expect(f.run("unknown-month")).rejects.toMatchObject({ details: { usage_unavailable: true } });
	});

	it("不限量受理后启用限额，空event_ids也不能把受理前旧idle当完成", async () => {
		const f = setup();
		f.complete("s", 0, 0, 0);
		await f.service.runSend("s", { text: "hello", clientMessageId: "empty-ids" }, undefined, async () => ({
			event_ids: [],
		}));
		f.service.setPolicy(
			{ monthly_tokens: 1000, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		f.session("second");
		await expect(f.run("after-policy", "second")).rejects.toMatchObject({ code: "conflict" });
		expect(f.send).not.toHaveBeenCalled();
		f.complete();
		await f.run("after-policy", "second");
		expect(f.send).toHaveBeenCalledTimes(1);
	});

	it("功能启用前的审批恢复首次建立受理月，后续增量进入该月", async () => {
		const f = setup();
		f.service.setPolicy(
			{ monthly_tokens: 1000, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		f.details.set("s", { ...detail("s", 10, 10, 1), stop_reason: { type: "requires_action" } });
		await f.service.runApproval("s", { batch_id: "old-batch", call_id: "old-call", result: "allow" }, async () => ({
			event_ids: ["approved"],
		}));
		f.complete("s", 130, 90, 3);
		expect((await f.service.member("member_a")).tokens.used).toBe(200);
		expect(f.store.session("s")?.admission_month).toBe("2026-10");
	});

	it("全量成员会话采集不截断为100条；其他成员、匿名及管理员调试不计入", async () => {
		const f = setup();
		for (let i = 0; i < 105; i++) f.session(`history-${i}`);
		f.member("member_b");
		f.session("other", "member_b");
		f.session("anon", "anon");
		f.index.create({
			sessionId: "debug",
			subjectId: "member_a",
			purpose: "admin_debug",
			debug: { project_name: "main", agent_key: "agent", remote_agent_id: "remote" },
		});
		await f.service.member("member_a");
		expect(f.get).toHaveBeenCalledTimes(106);
		expect(f.store.sessions("member_a")).toHaveLength(106);
		expect(f.get.mock.calls.flat()).not.toContain("other");
		expect(f.get.mock.calls.flat()).not.toContain("anon");
		expect(f.get.mock.calls.flat()).not.toContain("debug");
	});

	it("不限量发送仅等待目标基线，不读取无关历史或其他已受理会话", async () => {
		const f = setup();
		f.session("old");
		f.get.mockImplementation(async (id) => (id === "old" ? new Promise(() => {}) : (f.details.get(id) ?? null)));
		await f.run("first");
		f.complete();
		f.session("fresh");
		f.get.mockClear();
		await expect(f.run("second", "fresh")).resolves.toHaveProperty("event_ids");
		expect(f.get.mock.calls.map(([id]) => id)).toEqual(["fresh"]);
		expect(f.send).toHaveBeenCalledTimes(2);
	});

	it("启用限额仍采集本月其他会话的新增消耗，不能通过新会话绕过", async () => {
		const f = setup();
		f.service.setPolicy(
			{ monthly_tokens: 200, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		await f.run("first");
		f.complete();
		f.session("fresh");
		await expect(f.run("second", "fresh")).rejects.toMatchObject({
			code: "quota_exceeded",
			details: { used: 200 },
		});
		expect(f.send).toHaveBeenCalledTimes(1);
	});

	it("已确认结束的旧月会话不可读，不拖慢本月发送", async () => {
		const f = setup();
		f.service.setPolicy(
			{ monthly_tokens: 1000, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		await f.run("october");
		f.complete();
		f.time("2026-11-01T00:01:00.000Z");
		f.session("fresh");
		await f.run("november", "fresh"); // 先确认旧月请求已结束。
		f.complete("fresh");
		f.get.mockImplementation(async (id) => (id === "s" ? new Promise(() => {}) : (f.details.get(id) ?? null)));
		f.get.mockClear();
		await expect(f.run("again", "fresh")).resolves.toHaveProperty("event_ids");
		expect(f.get.mock.calls.map(([id]) => id)).toEqual(["fresh"]);
		expect(f.store.totals("member_a", "2026-10").tokens).toBe(200);
	});

	it("采集目标期间启用限额，补查本月其他会话后再决定是否发送", async () => {
		const f = setup();
		await f.run("unlimited");
		f.complete();
		f.session("fresh");
		let release!: (value: GatewaySessionInfo) => void;
		f.get.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		f.get.mockClear();
		const pending = f.run("policy-race", "fresh");
		const rejected = expect(pending).rejects.toMatchObject({ code: "quota_exceeded", details: { used: 200 } });
		await vi.waitFor(() => expect(f.get).toHaveBeenCalledWith("fresh"), { interval: 1 });
		f.service.setPolicy(
			{ monthly_tokens: 100, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		release(detail("fresh"));
		await rejected;
		expect(f.get).toHaveBeenCalledWith("s");
		expect(f.send).toHaveBeenCalledTimes(1);
	});

	it("模版限额准入补采其他成员未入账消耗，共享超限时拒绝且不调用发送", async () => {
		const f = setup();
		f.service.setTemplate(
			listing(f.db),
			{ monthly_tokens: 100, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		await f.run("a-first"); // A 基线 0；随后 Provider 累计 150，无人触发采集。
		f.complete("s", 150, 0, 0);
		f.member("member_b");
		f.session("sb", "member_b");
		await expect(f.run("b-first", "sb")).rejects.toMatchObject({
			code: "quota_exceeded",
			details: { scope: "template", metric: "tokens", used: 150 },
		});
		expect(f.send).toHaveBeenCalledTimes(1);
	});

	it("仅启用模版限额时，本次采集失败不得凭旧账本放行；恢复后可重新准入", async () => {
		const f = setup();
		f.service.setTemplate(
			listing(f.db),
			{ monthly_tokens: 100, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		await f.run("first"); // 建立数值 0 的有效基线。
		f.get.mockImplementation(async () => {
			throw new Error("provider down");
		});
		await expect(f.run("second")).rejects.toMatchObject({
			code: "conflict",
			details: { usage_unavailable: true, scope: "template" },
		});
		expect(f.send).toHaveBeenCalledTimes(1);
		f.get.mockImplementation(async (id) => f.details.get(id) ?? null);
		await expect(f.run("third")).resolves.toHaveProperty("event_ids");
	});

	it("日限额按 UTC 日键拦截后续发送，跨日后恢复；月账未启用不受影响", async () => {
		const f = setup();
		f.service.setPolicy(
			{ monthly_tokens: null, monthly_active_seconds: null, daily_tokens: 200, daily_active_seconds: null },
			"admin",
		);
		await f.run("first");
		f.complete(); // 采集确认日为 2026-10-31，本轮 200 Token 全部记入当日日账。
		await expect(f.run("second")).rejects.toMatchObject({
			code: "quota_exceeded",
			details: { period: "day", day: "2026-10-31", limit: 200, used: 200, reset_at: "2026-11-01T00:00:00.000Z" },
		});
		expect(f.send).toHaveBeenCalledTimes(1);
		f.time("2026-11-01T00:01:00.000Z");
		await expect(f.run("third")).resolves.toHaveProperty("event_ids");
	});

	it("模版日限额基于条目日账（observe 与成员逐日账同事务双写），共享超限拒绝后续发送", async () => {
		const f = setup();
		f.service.setTemplate(
			listing(f.db),
			{ monthly_tokens: null, monthly_active_seconds: null, daily_tokens: 200, daily_active_seconds: null },
			"admin",
		);
		await f.run("first");
		f.complete();
		await f.service.member("member_a"); // 触发采集：条目日账与成员日账同步入账。
		expect(f.store.agentDayTotals("agent", "2026-10-31")).toEqual({ tokens: 200, active_seconds: 2 });
		await expect(f.run("second")).rejects.toMatchObject({
			code: "quota_exceeded",
			details: { scope: "template", period: "day", day: "2026-10-31", limit: 200 },
		});
		expect(f.send).toHaveBeenCalledTimes(1);
	});

	it("日维度上限不得高于月维度：policy/member/template 三个设置入口统一校验，日未设置视为跟随月", async () => {
		const f = setup();
		const templateId = listing(f.db);
		const badTokens = {
			monthly_tokens: 100,
			monthly_active_seconds: null,
			daily_tokens: 500,
			daily_active_seconds: null,
		};
		expect(() => f.service.setPolicy(badTokens, "admin")).toThrow("日 Token 上限不能高于月度 Token 上限");
		await expect(f.service.setMember("member_a", badTokens, "admin")).rejects.toThrow(
			"日 Token 上限不能高于月度 Token 上限",
		);
		expect(() => f.service.setTemplate(templateId, badTokens, "admin")).toThrow("日 Token 上限不能高于月度 Token 上限");
		const badSeconds = {
			monthly_tokens: null,
			monthly_active_seconds: 100,
			daily_tokens: null,
			daily_active_seconds: 7200,
		};
		expect(() => f.service.setPolicy(badSeconds, "admin")).toThrow("日执行时长上限不能高于月度执行时长上限");
		// 日 ≤ 月合法；日未设置（null）= 跟随月度约束，不做比较。
		const ok = { monthly_tokens: 1000, monthly_active_seconds: 3600, daily_tokens: 1000, daily_active_seconds: 3600 };
		expect(() => f.service.setPolicy(ok, "admin")).not.toThrow();
		await expect(
			f.service.setMember("member_a", { ...ok, daily_tokens: null, daily_active_seconds: null }, "admin"),
		).resolves.toMatchObject({ override: { daily_tokens: null, monthly_tokens: 1000 } });
	});

	it("模版用量逐日趋势：observe 增量按采集确认日入条目日账，零值补全且非模版条目不计入", async () => {
		const f = setup();
		const templateId = listing(f.db);
		f.time("2026-10-30T10:00:00.000Z");
		await f.run("day1");
		f.complete();
		await f.service.member("member_a"); // 条目日账 2026-10-30：200 tokens / 2s
		f.time("2026-11-02T10:00:00.000Z");
		await f.run("day2");
		f.complete("s", 300, 200, 5);
		await f.service.member("member_a"); // 条目日账 2026-11-02：300 tokens / 3s
		f.db
			.prepare("INSERT INTO kit_usage_limit_agent_days (agent_slug, day, tokens, active_seconds) VALUES (?, ?, ?, ?)")
			.run("rogue-entry", "2026-11-01", 999, 9); // 非模版上架条目：任何视角都不计入
		const trend = f.service.templateDailyTrend(templateId, 7);
		expect(trend).toMatchObject({ days: 7, from_day: "2026-10-27", to_day: "2026-11-02", since_day: "2026-10-30" });
		expect(trend.data).toHaveLength(7);
		expect(trend.data.filter((point) => point.tokens > 0)).toEqual([
			{ day: "2026-10-30", tokens: 200, active_seconds: 2 },
			{ day: "2026-11-02", tokens: 300, active_seconds: 3 },
		]);
		// 「全部」视角聚合全部模版条目，仍不含非模版条目日账。
		const all = f.service.templateDailyTrend(null, 28);
		expect(all.data).toHaveLength(28);
		expect(all.data.filter((point) => point.tokens > 0)).toEqual([
			{ day: "2026-10-30", tokens: 200, active_seconds: 2 },
			{ day: "2026-11-02", tokens: 300, active_seconds: 3 },
		]);
	});
});
