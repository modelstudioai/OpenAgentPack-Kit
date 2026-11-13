import "@hono/zod-openapi";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PresetPackAgentResourcesSchema } from "@openagentpack/kit-sdk/protocol";
import { afterEach, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
});

// 保护仅管理身份可用、选定 Agent 范围、零远端写入/零事件正文及元数据不落本地会话索引。
it("admin/auditor 发现指定 Agent 的会话与挂载，未认证拒绝且不混入其他智能体", async () => {
	const dataDir = await mkdtemp(join(tmpdir(), "kit-preset-packs-"));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "preset-admin",
		KIT_ADMIN_TOKENS: "preset-auditor:auditor",
		KIT_RATE_LIMIT_RPS: "0",
	});
	const db = openDatabase(dataDir);
	cleanup.push(async () => {
		db.close();
		await rm(dataDir, { recursive: true, force: true });
	});
	const services = createKitServices(config, db);
	const app = createApp(services);
	const gateway = services.gateway;
	const selected = await gateway.createSession({
		agentId: "agent_mock_assistant",
		environmentId: "env_selected",
		memoryStores: [{ memory_store_id: "memory_one", access: "read_only" }],
		vaultIds: ["vault_one"],
	});
	const other = await gateway.createSession({ agentId: "agent_mock_designer" });
	await gateway.mountSessionResource(selected.session_id, {
		fileId: "file_one",
		mountPath: "/mnt/session/uploads/one.txt",
	});
	const endpoint = (id: string) => `/api/admin/preset-packs/agents/${id}/resources`;
	const auditBefore = services.audit.list();
	const foreign = await app.request(endpoint("agent_mock_designer"), {
		headers: { authorization: "Bearer preset-admin" },
	});
	const foreignData = PresetPackAgentResourcesSchema.parse(((await foreign.json()) as { data: unknown }).data);
	expect(foreignData.sessions).toContainEqual(expect.objectContaining({ session_id: other.session_id }));
	for (const token of ["preset-admin", "preset-auditor"]) {
		const response = await app.request(endpoint("agent_mock_assistant"), {
			headers: { authorization: `Bearer ${token}` },
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		const data = PresetPackAgentResourcesSchema.parse(((await response.json()) as { data: unknown }).data);
		expect(data.complete).toBe(true);
		expect(data.sessions).toHaveLength(1);
		expect(data.sessions[0]?.session_id).toBe(selected.session_id);
		expect(data.sessions[0]?.resources).toHaveLength(4);
		expect(data.sessions[0]?.resources).toContainEqual(expect.objectContaining({ type: "file", file_id: "file_one" }));
	}
	expect((await app.request(endpoint("agent_mock_assistant"))).status).toBe(401);
	expect((await app.request(endpoint("missing"), { headers: { authorization: "Bearer preset-admin" } })).status).toBe(
		404,
	);
	expect(services.audit.list()).toEqual(auditBefore);
	expect(db.prepare("SELECT COUNT(*) AS count FROM kit_sessions").get()).toMatchObject({ count: 0 });
	expect(await gateway.getSession(selected.session_id)).not.toBeNull();
	expect(await gateway.getSession(other.session_id)).not.toBeNull();
});
