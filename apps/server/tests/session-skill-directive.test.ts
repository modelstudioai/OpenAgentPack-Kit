import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import type { GatewaySendInput } from "../src/gateway/types.ts";
import { createKitServices } from "../src/services/index.ts";
import { createSessionService } from "../src/services/sessions.ts";
import { openDatabase } from "../src/store/db.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const close of cleanup.splice(0).reverse()) close();
});

const json = { "content-type": "application/json", "x-kit-protocol-version": "2.0.0" };
const headersFor = (subjectId: string) => ({ cookie: `kit_subject=${subjectId}` });

async function makeServices() {
	const directory = mkdtempSync(join(tmpdir(), "kit-skill-directive-"));
	cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
	const config = loadConfig({ KIT_GATEWAY: "mock", KIT_DATA_DIR: directory, ADMIN_TOKEN: "test-admin" });
	const db = openDatabase(directory);
	cleanup.push(() => db.close());
	const services = createKitServices(config, db);
	const sessions = createSessionService({
		gateway: services.gateway,
		buffers: services.buffers,
		sessionIndex: services.sessionIndex,
		fileScanTimeoutMs: 200,
	});
	return { services, sessions };
}

function makeApp() {
	const directory = mkdtempSync(join(tmpdir(), "kit-skill-route-"));
	cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_AUTH_MODE: "anonymous",
		KIT_DATA_DIR: directory,
		ADMIN_TOKEN: "admin-token",
	});
	const db = openDatabase(directory);
	cleanup.push(() => db.close());
	const services = createKitServices(config, db);
	services.catalog.upsert({ slug: "assistant", display_name: "Assistant", remote_agent_id: "agent_mock_assistant" });
	services.catalog.setStatus("assistant", "listed");
	return { app: createApp(services), services };
}

function captureSend(services: Awaited<ReturnType<typeof makeServices>>["services"]) {
	const seen: GatewaySendInput[] = [];
	vi.spyOn(services.gateway, "sendMessage").mockImplementation(async (_sessionId, input) => {
		seen.push(input);
		return { event_ids: ["e1"] };
	});
	return seen;
}

describe("发送服务层技能 token 合成（ADR-0016）", () => {
	it("skills 授权名单内的输入标记在到达 gateway 前转为协议 token", async () => {
		const { services, sessions } = await makeServices();
		const created = await sessions.create({ subjectId: "u1", agentSlug: "assistant", remoteAgentId: "mock" });
		const seen = captureSend(services);
		const result = await sessions.send(created.session_id, {
			text: "帮我 /frontend-design 审查页面",
			skills: ["frontend-design", "animate"],
		});
		expect(result).toEqual({ event_ids: ["e1"] });
		expect(seen[0]?.text).toBe("帮我 [使用 Skill:frontend-design] 审查页面");
	});

	it("未授权名与未知标记原样透传；省略 skills 不改写正文", async () => {
		const { services, sessions } = await makeServices();
		const created = await sessions.create({ subjectId: "u1", agentSlug: "assistant", remoteAgentId: "mock" });
		const seen = captureSend(services);
		await sessions.send(created.session_id, { text: "路径 /usr/bin 与 /frontend-design", skills: ["animate"] });
		await sessions.send(created.session_id, { text: "原样 /foo" });
		expect(seen[0]?.text).toBe("路径 /usr/bin 与 /frontend-design");
		expect(seen[1]?.text).toBe("原样 /foo");
	});

	it("路由层接收 skills 并按授权名单合成（zod 不剥字段）", async () => {
		const { app, services } = makeApp();
		const create = await app.request("/api/kit/sessions", {
			method: "POST",
			headers: { ...json, ...headersFor("anon_user") },
			body: JSON.stringify({ agent_slug: "assistant" }),
		});
		expect(create.status).toBe(201);
		const sessionId = ((await create.json()) as { data: { session_id: string } }).data.session_id;
		const seen = captureSend(services);
		const response = await app.request(`/api/kit/sessions/${sessionId}/messages`, {
			method: "POST",
			headers: { ...json, ...headersFor("anon_user") },
			body: JSON.stringify({ text: "先 /animate 起草", skills: ["animate", "ghost"] }),
		});
		expect(response.status).toBe(202);
		expect(seen[0]?.text).toBe("先 [使用 Skill:animate] 起草");
	});
});
