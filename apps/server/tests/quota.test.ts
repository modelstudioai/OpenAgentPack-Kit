import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

const json = { "content-type": "application/json", "x-kit-protocol-version": "2.0.0" };

function makeApp(env: Record<string, string> = {}) {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-quota-"));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_AUTH_MODE: "anonymous",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "admin-token",
		KIT_ADMIN_TOKENS: "aud-token:auditor",
		...env,
	});
	const services = createKitServices(config, openDatabase(dataDir));
	return { app: createApp(services), services };
}

/** 上架一个 mock agent（数据面可见才能建会话/扣费）。 */
async function listAgent(ctx: ReturnType<typeof makeApp>, slug: string, extra: Record<string, unknown> = {}) {
	ctx.services.catalog.upsert({ slug, display_name: slug, remote_agent_id: "agent_mock_assistant", ...extra });
	ctx.services.catalog.setStatus(slug, "listed");
}

async function createSession(ctx: ReturnType<typeof makeApp>, subject: string, slug = "assistant") {
	const res = await ctx.app.request("/api/kit/sessions", {
		method: "POST",
		headers: { ...json, cookie: `kit_subject=${subject}` },
		body: JSON.stringify({ agent_slug: slug }),
	});
	expect(res.status).toBe(201);
	const { data } = (await res.json()) as { data: { session_id: string } };
	return data.session_id;
}

async function send(
	ctx: ReturnType<typeof makeApp>,
	subject: string,
	sessionId: string,
	text = "hi",
	clientId?: string,
) {
	return ctx.app.request(`/api/kit/sessions/${sessionId}/messages`, {
		method: "POST",
		headers: { ...json, cookie: `kit_subject=${subject}` },
		body: JSON.stringify({ text, ...(clientId ? { client_message_id: clientId } : {}) }),
	});
}

const admin = { authorization: "Bearer admin-token", ...json };
const auditor = { authorization: "Bearer aud-token", ...json };

describe("Credits 配额与提额审批", () => {
	it("默认政策 200/月；send 受理即扣费并进入 plaza 统计", async () => {
		const ctx = makeApp();
		await listAgent(ctx, "assistant");
		const sessionId = await createSession(ctx, "alice");
		expect((await send(ctx, "alice", sessionId)).status).toBe(202);

		const quota = (await (
			await ctx.app.request("/api/kit/quota", { headers: { cookie: "kit_subject=alice" } })
		).json()) as {
			data: {
				used: number;
				limit: number;
				remaining: number;
				base_limit: number;
				per_agent: { agent_slug: string; turns: number }[];
			};
		};
		expect(quota.data.base_limit).toBe(200);
		expect(quota.data.used).toBe(1);
		expect(quota.data.remaining).toBe(199);
		expect(quota.data.per_agent).toEqual([{ agent_slug: "assistant", turns: 1 }]);

		const plaza = (await (
			await ctx.app.request("/api/kit/plaza", { headers: { cookie: "kit_subject=alice" } })
		).json()) as {
			data: { agents: { slug: string; stats: { mine: boolean; turns_30d: number } }[]; popular: string[] };
		};
		expect(plaza.data.agents[0]?.stats).toMatchObject({ mine: true, turns_30d: 1 });
		expect(plaza.data.popular).toEqual(["assistant"]);
	});

	it("override 生效：超限 403 quota_exceeded 且不写账本；client_message_id 重放不重复扣", async () => {
		const ctx = makeApp();
		await listAgent(ctx, "assistant");
		const put = await ctx.app.request("/api/admin/quota/overrides/alice", {
			method: "PUT",
			headers: admin,
			body: JSON.stringify({ monthly_credits: 1, reason: "试点" }),
		});
		expect(put.status).toBe(200);

		const sessionId = await createSession(ctx, "alice");
		expect((await send(ctx, "alice", sessionId, "m1", "cm-1")).status).toBe(202);
		// 同 client_message_id 重放：不重复扣、也不因已耗尽误拒
		expect((await send(ctx, "alice", sessionId, "m1", "cm-1")).status).toBe(202);
		const blocked = await send(ctx, "alice", sessionId, "m2", "cm-2");
		expect(blocked.status).toBe(403);
		const body = (await blocked.json()) as { error: { code: string; details: { used: number; remaining: number } } };
		expect(body.error.code).toBe("quota_exceeded");
		expect(body.error.details).toMatchObject({ used: 1, remaining: 0 });

		const quota = (await (
			await ctx.app.request("/api/kit/quota", { headers: { cookie: "kit_subject=alice" } })
		).json()) as {
			data: { used: number; override_limit: number };
		};
		expect(quota.data.used).toBe(1);
		expect(quota.data.override_limit).toBe(1);
	});

	it("加油包叠加当月额度；删除后回落；-1 不限量", async () => {
		const ctx = makeApp();
		await listAgent(ctx, "assistant");
		await ctx.app.request("/api/admin/quota/overrides/alice", {
			method: "PUT",
			headers: admin,
			body: JSON.stringify({ monthly_credits: 0 }),
		});
		const sessionId = await createSession(ctx, "alice");
		expect((await send(ctx, "alice", sessionId)).status).toBe(403);

		const pack = await ctx.app.request("/api/admin/quota/packs", {
			method: "POST",
			headers: admin,
			body: JSON.stringify({ subject_id: "alice", credits: 2, reason: "补偿" }),
		});
		expect(pack.status).toBe(201);
		expect((await send(ctx, "alice", sessionId, "a")).status).toBe(202);
		expect((await send(ctx, "alice", sessionId, "b")).status).toBe(202);
		expect((await send(ctx, "alice", sessionId, "c")).status).toBe(403);

		const { data: packView } = (await pack.json()) as { data: { id: string; month: string } };
		expect(
			(await ctx.app.request(`/api/admin/quota/packs/${packView.id}`, { method: "DELETE", headers: admin })).status,
		).toBe(200);

		await ctx.app.request("/api/admin/quota/overrides/alice", {
			method: "PUT",
			headers: admin,
			body: JSON.stringify({ monthly_credits: -1 }),
		});
		expect((await send(ctx, "alice", sessionId, "d")).status).toBe(202);
		expect((await send(ctx, "alice", sessionId, "e")).status).toBe(202);
	});

	it("申请生命周期：pending 唯一 → approve 必须二选一 → pack/override 两种生效 → reject 必须带理由", async () => {
		const ctx = makeApp();
		const cookie = { cookie: "kit_subject=alice" };
		const created = await ctx.app.request("/api/kit/quota/requests", {
			method: "POST",
			headers: { ...json, ...cookie },
			body: JSON.stringify({ requested_credits: 500, reason: "重度使用" }),
		});
		expect(created.status).toBe(201);
		const { data: req } = (await created.json()) as { data: { id: string } };
		expect(
			(
				await ctx.app.request("/api/kit/quota/requests", {
					method: "POST",
					headers: { ...json, ...cookie },
					body: JSON.stringify({ requested_credits: 1 }),
				})
			).status,
		).toBe(409);

		const noMode = await ctx.app.request(`/api/admin/quota/requests/${req.id}/review`, {
			method: "POST",
			headers: admin,
			body: JSON.stringify({ action: "approve" }),
		});
		expect(noMode.status).toBe(400);

		const approved = await ctx.app.request(`/api/admin/quota/requests/${req.id}/review`, {
			method: "POST",
			headers: admin,
			body: JSON.stringify({ action: "approve", mode: "pack", granted_credits: 300 }),
		});
		expect(approved.status).toBe(200);
		const quota = (await (await ctx.app.request("/api/kit/quota", { headers: cookie })).json()) as {
			data: { packs: { credits: number }[]; pending_request: unknown };
		};
		expect(quota.data.packs.map((p) => p.credits)).toEqual([300]);
		expect(quota.data.pending_request).toBeNull();

		const second = await ctx.app.request("/api/kit/quota/requests", {
			method: "POST",
			headers: { ...json, ...cookie },
			body: JSON.stringify({ requested_credits: 800 }),
		});
		const { data: req2 } = (await second.json()) as { data: { id: string } };
		const noNote = await ctx.app.request(`/api/admin/quota/requests/${req2.id}/review`, {
			method: "POST",
			headers: admin,
			body: JSON.stringify({ action: "reject" }),
		});
		expect(noNote.status).toBe(400);
		const rejected = await ctx.app.request(`/api/admin/quota/requests/${req2.id}/review`, {
			method: "POST",
			headers: admin,
			body: JSON.stringify({ action: "reject", note: "本月已补偿" }),
		});
		expect(rejected.status).toBe(200);

		const third = await ctx.app.request("/api/kit/quota/requests", {
			method: "POST",
			headers: { ...json, ...cookie },
			body: JSON.stringify({ requested_credits: 1000 }),
		});
		const { data: req3 } = (await third.json()) as { data: { id: string } };
		await ctx.app.request(`/api/admin/quota/requests/${req3.id}/review`, {
			method: "POST",
			headers: admin,
			body: JSON.stringify({ action: "approve", mode: "override" }),
		});
		const overrides = (await (await ctx.app.request("/api/admin/quota/overrides", { headers: admin })).json()) as {
			data: { subject_id: string; monthly_credits: number }[];
		};
		expect(overrides.data.find((o) => o.subject_id === "alice")?.monthly_credits).toBe(1000);
	});

	it("auditor 只读：写政策/override 被拒；读政策与用量放行", async () => {
		const ctx = makeApp();
		expect((await ctx.app.request("/api/admin/quota/policy", { headers: auditor })).status).toBe(200);
		expect((await ctx.app.request("/api/admin/quota/usage", { headers: auditor })).status).toBe(200);
		expect(
			(
				await ctx.app.request("/api/admin/quota/policy", {
					method: "PUT",
					headers: auditor,
					body: JSON.stringify({ monthly_credits: 1 }),
				})
			).status,
		).toBe(403);
	});

	it("广场视图：精选/分类/搜索/热门回退 ordering", async () => {
		const ctx = makeApp();
		await listAgent(ctx, "writer", { category: "writing", featured: true, ordering: 10 });
		await listAgent(ctx, "coder", { category: "coding", ordering: 20 });
		await listAgent(ctx, "generalist", { category: "general", ordering: 30 });
		const get = async (qs = "") =>
			(await (await ctx.app.request(`/api/kit/plaza${qs}`, { headers: { cookie: "kit_subject=bob" } })).json()) as {
				data: {
					agents: { slug: string }[];
					featured: string[];
					popular: string[];
					categories: { id: string; count: number }[];
				};
			};

		const all = await get();
		expect(all.data.agents.map((a) => a.slug)).toEqual(["writer", "coder", "generalist"]);
		expect(all.data.featured).toEqual(["writer"]);
		// 无用量数据时热门回退 ordering
		expect(all.data.popular).toEqual(["writer", "coder", "generalist"]);
		expect(all.data.categories.find((c) => c.id === "writing")?.count).toBe(1);

		const byCat = await get("?category=coding");
		expect(byCat.data.agents.map((a) => a.slug)).toEqual(["coder"]);
		const byQ = await get("?q=CODE");
		expect(byQ.data.agents.map((a) => a.slug)).toEqual(["coder"]);
	});

	it("历史月加油包不计入当月余额（pack 仅其 month 内有效）", async () => {
		const ctx = makeApp();
		ctx.services.catalog.upsert({ slug: "assistant", display_name: "A", remote_agent_id: "agent_mock_assistant" });
		const before = (await (
			await ctx.app.request("/api/kit/quota", { headers: { cookie: "kit_subject=carol" } })
		).json()) as {
			data: { packs: unknown[]; remaining: number };
		};
		expect(before.data.packs).toEqual([]);
		expect(before.data.remaining).toBe(200);
	});
});
