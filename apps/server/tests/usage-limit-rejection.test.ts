import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEvent } from "@openagentpack/kit-sdk/protocol";
import { setDefaultFetch } from "@openagentpack/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSdkGateway } from "../src/gateway/sdk.ts";
import type { GatewaySessionInfo } from "../src/gateway/types.ts";
import { createEventBufferRegistry } from "../src/services/event-buffer.ts";
import { createToolApprovals } from "../src/services/tool-approvals.ts";
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
	setDefaultFetch(undefined);
	for (const close of cleanup.splice(0).reverse()) close();
});

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

function setup() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-send-rejection-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const db = openDatabase(dataDir);
	cleanup.push(() => db.close());
	const members = createMemberStore(db);
	const index = createSessionIndex(db);
	let now = new Date("2026-10-31T20:00:00.000Z");
	members.create(
		{
			member_id: "member",
			username: "member",
			display_name: "Member",
			auth_type: "local",
			status: "active",
			created_at: now.toISOString(),
			updated_at: now.toISOString(),
		},
		"unused",
	);
	const details = new Map<string, GatewaySessionInfo>();
	const events = new Map<string, SessionEvent[]>();
	for (const id of ["s", "other"]) {
		index.create({ sessionId: id, subjectId: "member", agentSlug: "agent" });
		details.set(id, {
			session_id: id,
			status: "idle",
			usage: { input_tokens: 0, output_tokens: 0 },
			stats: { active_seconds: 0 },
		});
		events.set(id, []);
	}
	const gateway = createSdkGateway({
		apiKey: "sk-test-rejection-only",
		baseUrl: "https://provider.example.test/api/v1/agentstudio",
	});
	// GET fixture 隔离计量状态；POST 仍走 SDK 公开 HTTP 合同。
	vi.spyOn(gateway, "getSession").mockImplementation(async (id) => details.get(id) ?? null);
	vi.spyOn(gateway, "listEvents").mockImplementation(async (id) => ({
		events: events.get(id) ?? [],
		next_page_token: null,
	}));
	let response: number | "network" = 400;
	const post = vi.fn(async (input: string | URL | Request) => {
		if (response === "network") throw new TypeError("synthetic connection reset");
		if (response !== 200)
			return Response.json({ code: "invalid_parameter", message: "sk-test-rejection-only" }, { status: response });
		const id = new URL(String(input)).pathname.split("/").at(-2)!;
		const eventId = `accepted-${post.mock.calls.length}`;
		events
			.get(id)
			?.push(
				{ event_id: eventId, type: "message", role: "user", content: [] },
				{ event_id: `idle-${eventId}`, type: "session_status", metadata: { status: "idle" } },
			);
		return Response.json({ data: [{ id: eventId }] });
	});
	setDefaultFetch(post);
	const store = createUsageLimitStore(db);
	const make = () =>
		createUsageLimitService({
			store,
			members,
			sessionIndex: index,
			snapshots: createSessionUsageStore(db),
			gateway,
			audit: createAuditLog(db),
			now: () => now,
		});
	const service = make();
	return {
		service,
		make,
		gateway,
		store,
		db,
		dataDir,
		details,
		events,
		post,
		members,
		index,
		respond: (value: typeof response) => {
			response = value;
		},
		time: (value: string) => {
			now = new Date(value);
		},
		run: (id = "s", key = "message") =>
			service.runSend(id, { text: "hello", clientMessageId: key }, undefined, () =>
				gateway.sendMessage(id, { text: "hello" }),
			),
	};
}

describe("明确拒绝与未知发送结果的恢复边界（合成 HTTP，不是真实 Cloud）", () => {
	it.each([
		{ limit: null, status: 400 },
		{ limit: 1000, status: 400 },
		{ limit: null, status: 429 },
	])("限额 $limit / HTTP $status：同一请求可重试且其他会话可发送", async ({ limit, status }) => {
		const f = setup();
		f.respond(status);
		f.service.setPolicy(
			{ monthly_tokens: limit, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		await expect(f.run()).rejects.toMatchObject({
			code: "provider_error",
			details: { request_rejected: true, provider_status: status },
			message: expect.not.stringContaining("sk-test-rejection-only"),
		});
		expect(f.post).toHaveBeenCalledOnce();
		f.respond(200);
		await expect(f.run()).resolves.toEqual({ event_ids: ["accepted-2"] });
		await expect(f.run("other")).resolves.toEqual({ event_ids: ["accepted-3"] });
		expect((await f.service.member("member")).tokens.used).toBe(0);
	});

	it("跨月拒绝恢复原受理月与未知标记，保留拒绝前已采集的增量", async () => {
		const f = setup();
		f.respond(200);
		await f.run();
		f.details.set("s", {
			session_id: "s",
			status: "idle",
			usage: { input_tokens: 100, output_tokens: 0 },
			stats: { active_seconds: 5 },
		});
		await f.service.member("member");
		f.time("2026-11-01T00:01:00.000Z");
		f.details.set("s", { session_id: "s", status: "idle" });
		f.respond(400);
		await expect(f.run("s", "rejected-new-month")).rejects.toMatchObject({ details: { request_rejected: true } });
		expect(f.store.totals("member", "2026-10")).toMatchObject({
			tokens: 100,
			tokens_unknown: 0,
			active_seconds_unknown: 0,
		});
		expect(f.store.totals("member", "2026-11")).toMatchObject({
			tokens: 0,
			tokens_unknown: 0,
			active_seconds_unknown: 0,
		});
		f.details.set("s", {
			session_id: "s",
			status: "idle",
			usage: { input_tokens: 150, output_tokens: 0 },
			stats: { active_seconds: 7 },
		});
		f.time("2026-10-31T23:59:00.000Z");
		expect(await f.service.member("member")).toMatchObject({
			tokens: { used: 150, status: "ok" },
			active_seconds: { used: 7, status: "ok" },
		});
	});

	it.each([408, 500, "network"] as const)("%s 保持结果未知保护，重建服务后也不重发", async (response) => {
		const f = setup();
		f.respond(response);
		await expect(f.run()).rejects.toMatchObject({ code: "conflict", retryable: false });
		f.respond(200);
		const recovered = f.make();
		for (const id of ["s", "other"])
			await expect(
				recovered.runSend(id, { text: "hello", clientMessageId: "message" }, undefined, () =>
					f.gateway.sendMessage(id, { text: "hello" }),
				),
			).rejects.toMatchObject({ code: "conflict", retryable: false });
		expect(f.post).toHaveBeenCalledOnce();
	});

	it("模版月度限额：采集双写条目月账，超限拒发并可通过重置恢复；未设置不拦", async () => {
		const f = setup();
		const templateId = listing(f.db);

		f.respond(200);
		await f.run();
		f.details.set("s", {
			session_id: "s",
			status: "idle",
			usage: { input_tokens: 100, output_tokens: 0 },
			stats: { active_seconds: 5 },
		});
		await f.service.member("member");
		// 发送采集与成员月账同事务双写条目月账（input 100 + output 0）。
		expect(f.store.agentTotals("agent", "2026-10").tokens).toBe(100);

		// 未设置覆盖时不拦。
		f.respond(200);
		await expect(f.run("s", "second")).resolves.toEqual({ event_ids: ["accepted-2"] });

		f.service.setTemplate(
			templateId,
			{ monthly_tokens: 50, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		// 详情必须带回与账本一致的用量：模版限额启用后，字段缺失的读取按不可确认拒绝（R3），不再凭旧账本放行。
		f.details.set("s", {
			session_id: "s",
			status: "idle",
			usage: { input_tokens: 100, output_tokens: 0 },
			stats: { active_seconds: 5 },
		});
		await expect(f.run("s", "third")).rejects.toMatchObject({
			code: "quota_exceeded",
			details: { scope: "template", limit: 50, used: 100, metric: "tokens" },
		});
		f.service.resetTemplate(templateId, "admin");
		// 403 拒绝发生在发送受理之前，不消耗 Provider POST 编号。
		await expect(f.run("s", "fourth")).resolves.toEqual({ event_ids: ["accepted-3"] });
	});

	it("模版共享月账：等待期间其他成员入账的增量不被明确拒绝的回滚覆盖", async () => {
		const f = setup();
		f.service.setTemplate(
			listing(f.db),
			{ monthly_tokens: 100, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
			"admin",
		);
		const now = new Date().toISOString();
		f.members.create(
			{
				member_id: "member_b",
				username: "member_b",
				display_name: "member_b",
				auth_type: "local",
				status: "active",
				created_at: now,
				updated_at: now,
			},
			"unused",
		);
		f.index.create({ sessionId: "sb", subjectId: "member_b", agentSlug: "agent" });
		f.details.set("sb", {
			session_id: "sb",
			status: "idle",
			usage: { input_tokens: 0, output_tokens: 0 },
			stats: { active_seconds: 0 },
		});
		f.events.set("sb", []);
		f.respond(200);
		await f.run("sb", "b-first"); // B 首轮成功：建立基线。
		await f.run("s", "a-first"); // A 首轮成功：建立基线。
		// A 第二轮受理后 POST 挂起；等待期间采集 B 的新增消耗（100 Token）入账共享月账。
		const original = f.post.getMockImplementation()!;
		let releaseA!: () => void;
		f.post.mockImplementationOnce(async (input) => {
			await new Promise<void>((resolve) => {
				releaseA = resolve;
			});
			return original(input);
		});
		const pendingA = f.run("s", "a-second");
		await vi.waitFor(() => expect(f.post).toHaveBeenCalledTimes(3), { interval: 1 });
		f.store.observe("sb", { input_tokens: 60, output_tokens: 40 }, now);
		expect(f.store.agentTotals("agent", "2026-10").tokens).toBe(100);
		f.respond(400); // A 的 POST 将被 Provider 明确拒绝。
		releaseA();
		await expect(pendingA).rejects.toMatchObject({ code: "provider_error", details: { request_rejected: true } });
		// 回滚只撤销本次请求引入的变更：B 已入账的 100 保留，重启后仍在，重复采集不重计。
		expect(f.store.agentTotals("agent", "2026-10")).toMatchObject({ tokens: 100, tokens_unknown: 0 });
		const reopened = openDatabase(f.dataDir);
		cleanup.push(() => reopened.close());
		expect(createUsageLimitStore(reopened).agentTotals("agent", "2026-10").tokens).toBe(100);
		f.store.observe("sb", { input_tokens: 60, output_tokens: 40 }, now);
		expect(f.store.agentTotals("agent", "2026-10").tokens).toBe(100);
	});

	it("允许审批被明确拒绝后仍可人工重试，不被审批缓存或月度账本改写为未知", async () => {
		const f = setup();
		const request: SessionEvent = {
			event_id: "approval",
			type: "tool_approval_request",
			content: [
				{
					type: "data",
					data: { batch_id: "batch", call_id: "call", name: "write_file", arguments: {}, tool_type: "builtin" },
				},
			],
		};
		f.events.set("s", [
			request,
			{
				event_id: "pending",
				type: "session_status",
				metadata: {
					status: "idle",
					stop_reason: { type: "requires_action", pending_batch_id: "batch", pending_call_ids: ["call"] },
				},
			},
		]);
		const approvals = createToolApprovals(f.gateway, createEventBufferRegistry(), (id, decision, send) =>
			f.service.runApproval(id, decision, send),
		);
		const decision = { batch_id: "batch", call_id: "call", result: "allow" as const };
		await expect(approvals.respond("s", decision)).rejects.toMatchObject({ details: { request_rejected: true } });
		f.respond(200);
		await expect(approvals.respond("s", decision)).resolves.toEqual({ event_ids: ["accepted-2"] });
		expect(f.post).toHaveBeenCalledTimes(2);
	});
});
