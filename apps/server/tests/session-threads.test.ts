import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDefaultFetch } from "@openagentpack/sdk";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

function setup() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-threads-"));
	const config = loadConfig({ KIT_GATEWAY: "mock", KIT_AUTH_MODE: "anonymous", KIT_DATA_DIR: dataDir });
	const db = openDatabase(dataDir);
	const services = createKitServices(config, db);
	return { db, services, app: createApp(services) };
}

describe("员工线程查询的归属与分页", () => {
	it("上游拒绝返回安全的可重试错误，不将 Provider 原始正文写日志", async () => {
		const secret = "opaque-credential-must-not-be-logged";
		const dataDir = mkdtempSync(join(tmpdir(), "kit-threads-errors-"));
		const config = loadConfig({
			KIT_GATEWAY: "sdk",
			KIT_AUTH_MODE: "anonymous",
			KIT_DATA_DIR: dataDir,
			BAILIAN_API_KEY: secret,
			BAILIAN_BASE_URL: "https://provider.example.test/api/v1/agentstudio",
		});
		const db = openDatabase(dataDir);
		const services = createKitServices(config, db);
		services.sessionIndex.create({ sessionId: "session", subjectId: "alice", agentSlug: "assistant" });
		const app = createApp(services);
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		setDefaultFetch(async () => Response.json({ message: `rejected ${secret}` }, { status: 400 }));
		try {
			for (const suffix of ["threads", "threads/sthr_one/events"]) {
				const response = await app.request(`/api/kit/sessions/session/${suffix}`, {
					headers: { cookie: "kit_subject=alice" },
				});
				expect(response.status).toBe(502);
				expect(await response.json()).toEqual({
					error: { code: "provider_error", message: "查询子 Agent 失败，请稍后重试", retryable: true },
				});
			}
			expect(log).not.toHaveBeenCalled();
		} finally {
			setDefaultFetch(fetch);
			log.mockRestore();
			db.close();
		}
	});
	it("真实存在的本人子线程可分页；跨用户、跨 Session 及管理员调试域均不可读取", async () => {
		const { app, services, db } = setup();
		try {
			const own = await services.gateway.createSession({ agentId: "mock" });
			services.sessionIndex.create({ sessionId: own.session_id, subjectId: "alice", agentSlug: "assistant" });
			await services.gateway.sendMessage(own.session_id, { text: "multi-agent" });
			// 等首个子线程收尾，分页断言才有稳定的事件全集；交错流式约 2.6s，需放宽默认超时。
			await vi.waitFor(
				async () => {
					const threads = (await services.gateway.listThreads(own.session_id)).data;
					expect(threads).toHaveLength(2);
					expect(threads[0]?.status).toBe("idle");
				},
				{ timeout: 10_000, interval: 100 },
			);
			const first = (await services.gateway.listThreads(own.session_id)).data[0];
			expect(first).toBeDefined();
			const headers = { cookie: "kit_subject=alice" };
			const base = `/api/kit/sessions/${own.session_id}/threads`;
			const listed = await app.request(`${base}?limit=1`, { headers });
			expect(listed.status).toBe(200);
			expect(await listed.json()).toMatchObject({ data: [{ id: first?.id }], next_page_token: "page:1" });
			const later = await app.request(`${base}?limit=1&page_token=page:1`, { headers });
			expect(await later.json()).toMatchObject({ data: [{ agent: { name: "研究员" } }], next_page_token: null });
			const path = `${base}/${first?.id}/events`;
			const events = await app.request(`${path}?limit=2`, { headers });
			expect(events.status).toBe(200);
			expect(await events.json()).toMatchObject({
				data: [{ type: "thread_status" }, { type: "message" }],
				next_page_token: "page:2",
			});
			// 翻页到最旧：thread_created 收尾，主 Agent 派发任务书也归档在子线程历史里。
			const olderTypes: string[] = [];
			for (let cursor = "page:2"; cursor; ) {
				const older = await app.request(`${path}?limit=2&page_token=${cursor}`, { headers });
				const body = (await older.json()) as { data: Array<{ type: string }>; next_page_token: string | null };
				olderTypes.push(...body.data.map((item) => item.type));
				cursor = body.next_page_token ?? "";
			}
			expect(olderTypes.at(-1)).toBe("thread_created");
			expect(olderTypes).toContain("thread_message_sent");
			const listSpy = vi.spyOn(services.gateway, "listThreads");
			const eventsSpy = vi.spyOn(services.gateway, "listThreadEvents");
			for (const url of [base, path])
				expect((await app.request(url, { headers: { cookie: "kit_subject=bob" } })).status).toBe(404);
			expect(listSpy).not.toHaveBeenCalled();
			expect(eventsSpy).not.toHaveBeenCalled();
			const other = await services.gateway.createSession({ agentId: "mock" });
			services.sessionIndex.create({ sessionId: other.session_id, subjectId: "alice", agentSlug: "assistant" });
			expect(
				(await app.request(`/api/kit/sessions/${other.session_id}/threads/${first?.id}/events`, { headers })).status,
			).toBe(404);
			const debug = await services.gateway.createSession({ agentId: "mock" });
			services.sessionIndex.create({
				sessionId: debug.session_id,
				subjectId: "alice",
				purpose: "admin_debug",
				debug: { project_name: "p", agent_key: "a", remote_agent_id: "mock" },
			});
			for (const suffix of ["threads", `threads/${first?.id}/events`]) {
				expect((await app.request(`/api/kit/sessions/${debug.session_id}/${suffix}`, { headers })).status).toBe(404);
			}
			expect((await app.request(`${base}?limit=0`, { headers })).status).toBe(400);
			expect((await app.request(`${base}/thrd_main/events`, { headers })).status).toBe(400);
			await services.gateway.interrupt(own.session_id);
		} finally {
			db.close();
		}
	});
});
