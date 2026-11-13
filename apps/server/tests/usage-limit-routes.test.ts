import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "@openagentpack/kit-sdk/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const close of cleanup.splice(0).reverse()) close();
});
const json = { "content-type": "application/json", "x-kit-protocol-version": PROTOCOL_VERSION };
const admin = { ...json, authorization: "Bearer limits-admin" };
const auditor = { ...json, authorization: "Bearer limits-auditor" };

async function setup() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-usage-limit-routes-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const db = openDatabase(dataDir);
	cleanup.push(() => db.close());
	const services = createKitServices(
		loadConfig({
			KIT_GATEWAY: "mock",
			KIT_DATA_DIR: dataDir,
			ADMIN_TOKEN: "limits-admin",
			KIT_ADMIN_TOKENS: "limits-auditor:auditor",
		}),
		db,
	);
	const app = createApp(services);
	const { member } = await services.members.create(
		{
			username: "limits-member",
			display_name: "额度成员",
			auth_type: "local",
			password_mode: "custom",
			password: "Limits!Flow2026",
		},
		"test-admin",
	);
	const login = await services.memberAuth.login({ username: member.username, password: "Limits!Flow2026" });
	const memberHeaders = { ...json, authorization: `Bearer ${login.access_token}` };
	return { app, services, db, member, memberHeaders };
}

it("月度限额设置、成员覆盖与恢复默认可回读；auditor只读、成员只可读取自己的额度", async () => {
	const { app, member, memberHeaders } = await setup();
	const policyPath = "/api/admin/usage-limits/policy";
	const memberPath = `/api/admin/members/${member.member_id}/usage-limit`;
	const limits = { monthly_tokens: 1000, monthly_active_seconds: 3600 };
	// 日上限高于月上限：服务端拒绝（400），三主体共用同一校验。
	const inverted = await app.request(memberPath, {
		method: "PUT",
		headers: admin,
		body: JSON.stringify({ ...limits, daily_tokens: 2000, daily_active_seconds: 7200 }),
	});
	expect(inverted.status).toBe(400);
	expect(await inverted.json()).toMatchObject({ error: { code: "invalid_request" } });
	const saved = await app.request(policyPath, { method: "PUT", headers: admin, body: JSON.stringify(limits) });
	expect(saved.status).toBe(200);
	expect(await saved.json()).toMatchObject({ data: { limits } });
	expect(await (await app.request(memberPath, { headers: auditor })).json()).toMatchObject({
		data: { limits, override: null },
	});
	for (const method of ["PUT", "DELETE"]) {
		const denied = await app.request(memberPath, {
			method,
			headers: auditor,
			...(method === "PUT" ? { body: JSON.stringify(limits) } : {}),
		});
		expect(denied.status).toBe(403);
	}
	const override = { monthly_tokens: null, monthly_active_seconds: 0 };
	expect(
		(await app.request(memberPath, { method: "PUT", headers: admin, body: JSON.stringify(override) })).status,
	).toBe(200);
	const mine = await app.request("/api/kit/usage-limits", { headers: memberHeaders });
	expect(mine.headers.get("cache-control")).toBe("no-store");
	expect(await mine.json()).toMatchObject({ data: { member_id: member.member_id, limits: override, override } });
	expect((await app.request(memberPath, { headers: memberHeaders })).status).toBe(403);
	expect((await app.request(policyPath)).status).toBe(401);
	const invalid = await app.request(memberPath, {
		method: "PUT",
		headers: admin,
		body: JSON.stringify({ ...limits, monthly_tokens: 0.5 }),
	});
	expect(invalid.status).toBe(400);
	expect((await app.request("/api/admin/members/missing/usage-limit", { headers: admin })).status).toBe(404);
	const reset = await app.request(memberPath, { method: "DELETE", headers: admin });
	expect(await reset.json()).toMatchObject({ data: { limits, override: null } });
});

it("HTTP发送使用Token/时长限额；超限不请求Provider，提额后可用，旧Credits不再限制本地成员", async () => {
	const { app, services, member, memberHeaders, db } = await setup();
	services.catalog.upsert({ slug: "limits-agent", display_name: "额度测试", remote_agent_id: "agent_mock_assistant" });
	services.catalog.setStatus("limits-agent", "listed");
	services.quota.putPolicy(0, "test-admin");
	const created = await app.request("/api/kit/sessions", {
		method: "POST",
		headers: memberHeaders,
		body: JSON.stringify({ agent_slug: "limits-agent" }),
	});
	expect(created.status).toBe(201);
	const { data: createdSession } = (await created.json()) as { data: { session_id: string } };
	const sessionId = createdSession.session_id;
	const path = `/api/kit/sessions/${sessionId}/messages`;
	const limitPath = `/api/admin/members/${member.member_id}/usage-limit`;
	const setLimit = (monthly_tokens: number | null, monthly_active_seconds: number | null) =>
		app.request(limitPath, {
			method: "PUT",
			headers: admin,
			body: JSON.stringify({ monthly_tokens, monthly_active_seconds }),
		});
	const send = (id: string) =>
		app.request(path, {
			method: "POST",
			headers: memberHeaders,
			body: JSON.stringify({ text: "用量测试", client_message_id: id }),
		});
	const provider = vi.spyOn(services.gateway, "sendMessage");
	await setLimit(0, null);
	const blocked = await send("blocked");
	expect(blocked.status).toBe(403);
	expect(await blocked.json()).toMatchObject({
		error: { code: "quota_exceeded", details: { metric: "tokens", limit: 0 } },
	});
	expect(provider).not.toHaveBeenCalled();
	expect(db.prepare("SELECT COUNT(*) AS n FROM usage_turns").get()).toMatchObject({ n: 0 });
	await setLimit(200, 10);
	expect((await send("first")).status).toBe(202);
	await vi.waitFor(async () => expect((await services.gateway.getSession(sessionId))?.status).toBe("idle"));
	const quota = await app.request("/api/kit/usage-limits", { headers: memberHeaders });
	expect(await quota.json()).toMatchObject({
		data: {
			tokens: { used: 200, status: "exceeded" },
			active_seconds: { used: 2, status: "ok" },
		},
	});
	const tokenBlocked = await send("second");
	expect(tokenBlocked.status).toBe(403);
	expect(provider).toHaveBeenCalledTimes(1);
	await setLimit(null, 2);
	const timeBlocked = await send("second");
	expect(await timeBlocked.json()).toMatchObject({
		error: { code: "quota_exceeded", details: { metric: "active_seconds", used: 2 } },
	});
	await setLimit(null, 4);
	expect((await send("second")).status).toBe(202);
	await vi.waitFor(async () => expect((await services.gateway.getSession(sessionId))?.status).toBe("idle"));
	expect(provider).toHaveBeenCalledTimes(2);
	expect(await (await app.request("/api/kit/quota", { headers: memberHeaders })).json()).toMatchObject({
		data: { unlimited: true, limit: -1, used: 2 },
	});
});

it("每日用量窗口参数：days 决定逐日序列长度与起点，非法值 400，两个 kit 读接口同口径", async () => {
	const { app, member, memberHeaders, db } = await setup();
	const today = new Date().toISOString().slice(0, 10);
	const yesterday = new Date(Date.parse(`${today}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
	db.prepare("INSERT INTO kit_usage_limit_days (member_id, day, tokens, active_seconds) VALUES (?, ?, ?, ?)").run(
		member.member_id,
		yesterday,
		100,
		1,
	);
	db.prepare("INSERT INTO kit_usage_limit_days (member_id, day, tokens, active_seconds) VALUES (?, ?, ?, ?)").run(
		member.member_id,
		today,
		200,
		2,
	);
	db.prepare(
		"INSERT INTO usage_turns (subject_id, agent_slug, session_id, client_message_id, day, month, created_at) VALUES (?, 'agent', 's-window', 't1', ?, ?, ?)",
	).run(member.member_id, today, today.slice(0, 7), `${today}T00:00:00.000Z`);

	const single = (await (await app.request("/api/kit/usage-limits?days=1", { headers: memberHeaders })).json()) as {
		data: { daily: { day: string; tokens: number; active_seconds: number }[] };
	};
	expect(single.data.daily).toEqual([{ day: today, tokens: 200, active_seconds: 2 }]);

	const three = (await (await app.request("/api/kit/usage-limits?days=3", { headers: memberHeaders })).json()) as {
		data: { daily: { day: string; tokens: number; active_seconds: number }[] };
	};
	expect(three.data.daily).toHaveLength(3);
	expect(three.data.daily.at(-1)).toEqual({ day: today, tokens: 200, active_seconds: 2 });
	expect(three.data.daily[1]).toMatchObject({ day: yesterday, tokens: 100 }); // 窗口首日零值补全，增量只在真实记录日

	const defaulted = (await (await app.request("/api/kit/usage-limits", { headers: memberHeaders })).json()) as {
		data: { daily: unknown[] };
	};
	expect(defaulted.data.daily).toHaveLength(30);

	const creditDaily = (await (await app.request("/api/kit/quota?days=1", { headers: memberHeaders })).json()) as {
		data: { daily: { day: string; turns: number }[] };
	};
	expect(creditDaily.data.daily).toEqual([{ day: today, turns: 1 }]);

	for (const days of ["0", "401", "abc"]) {
		expect((await app.request(`/api/kit/usage-limits?days=${days}`, { headers: memberHeaders })).status).toBe(400);
		expect((await app.request(`/api/kit/quota?days=${days}`, { headers: memberHeaders })).status).toBe(400);
	}
});
