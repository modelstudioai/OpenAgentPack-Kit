import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdminIdentityView, DebugSessionDetail, SessionThreadsResponse } from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";
import { createSessionIndex } from "../src/store/sessions.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const close of cleanup.splice(0).reverse()) close();
});
const headers = {
	authorization: "Bearer template-admin",
	"content-type": "application/json",
	"x-kit-protocol-version": "2.0.0",
};
const selected = { remote_agent_id: "agent_mock_assistant", remote_environment_id: "env_mock_analysis" };

function setup() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-template-debug-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_AUTH_MODE: "anonymous",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "template-admin",
		KIT_ADMIN_TOKENS: "other-admin:admin,auditor:auditor",
		KIT_RATE_LIMIT_RPS: "0",
	});
	const db = openDatabase(dataDir);
	cleanup.push(() => db.close());
	const services = createKitServices(config, db);
	const app = createApp(services);
	const create = (input: unknown = selected, authorization = headers.authorization) =>
		app.request("/api/admin/debug/sessions", {
			method: "POST",
			headers: { ...headers, authorization },
			body: JSON.stringify(input),
		});
	return { app, services, db, dataDir, create };
}

async function adminSubject(app: ReturnType<typeof setup>["app"]) {
	const response = await app.request("/api/admin/identity", { headers });
	return ((await response.json()) as { data: AdminIdentityView }).data.subject;
}

describe("模版远端资源调试", () => {
	it("未选择环境时沿用所选 Agent 版本的默认环境，不查询或持久化环境覆盖", async () => {
		const { app, services, db, dataDir, create } = setup();
		const environments = vi
			.spyOn(services.gateway, "listRemoteEnvironments")
			.mockRejectedValue(new Error("环境目录暂不可用"));
		const createRemote = vi.spyOn(services.gateway, "createSession");
		const response = await create({ remote_agent_id: selected.remote_agent_id, agent_version: 1 });
		expect(response.status, await response.clone().text()).toBe(201);
		const { data: session } = (await response.json()) as { data: DebugSessionDetail };
		expect(createRemote).toHaveBeenCalledExactlyOnceWith({ agentId: selected.remote_agent_id, agentVersion: 1 });
		expect(environments).not.toHaveBeenCalled();
		expect(session).not.toHaveProperty("remote_environment_id");
		expect(
			db.prepare("SELECT remote_environment_id FROM kit_sessions WHERE session_id=?").get(session.session_id)
				?.remote_environment_id,
		).toBeNull();
		const reopened = openDatabase(dataDir);
		cleanup.push(() => reopened.close());
		const persisted = createSessionIndex(reopened).getDebugForSubject(session.session_id, await adminSubject(app));
		expect(persisted?.summary).toMatchObject({ source: "template", remote_agent_id: selected.remote_agent_id });
		expect(persisted?.summary).not.toHaveProperty("remote_environment_id");
		expect(services.audit.list()).toEqual([]);
	});

	it("复核全部选择并创建远端调试，持久回显配置且不伪造项目或授予上传归属", async () => {
		const { app, services, db, dataDir, create } = setup();
		const file = await services.gateway.uploadFile({ filename: "source.txt", bytes: new Uint8Array([1, 2]) });
		const memories = [
			{ memory_store_id: "memory-guide", access: "read_only", instructions: "检索说明" },
			{ memory_store_id: "memory-notes", access: "read_write" },
		];
		const createRemote = vi.spyOn(services.gateway, "createSession");
		const mountRemote = vi.spyOn(services.gateway, "mountSessionResource");
		const response = await create({
			...selected,
			files: [{ ...file, filename: "untrusted.txt" }],
			memory_stores: memories,
			vault_ids: ["vlt_mock_1", "vlt_mock_2"],
			title: "预览调试",
		});
		expect(response.status, await response.clone().text()).toBe(201);
		const { data: session } = (await response.json()) as { data: DebugSessionDetail };
		expect(createRemote).toHaveBeenCalledWith({
			agentId: selected.remote_agent_id,
			environmentId: selected.remote_environment_id,
			title: "预览调试",
			memoryStores: memories,
			vaultIds: ["vlt_mock_1", "vlt_mock_2"],
		});
		// 调试附件不进创建载荷：服务层在创建后走运行时挂载（实际文件名取 provider 元数据）
		expect(mountRemote).toHaveBeenCalledWith(expect.anything(), {
			fileId: file.file_id,
			mountPath: "/mnt/session/uploads/source.txt",
		});
		expect(session).toMatchObject({
			...selected,
			source: "template",
			memory_stores: memories,
			vault_ids: ["vlt_mock_1", "vlt_mock_2"],
			files: [{ filename: "source.txt", mount_path: "/mnt/session/uploads/source.txt" }],
		});
		expect(session).not.toHaveProperty("project_name");
		expect(session).not.toHaveProperty("agent_key");
		const subject = services.debug.requireSession(await adminSubject(app), session.session_id).subject_id;
		const reopened = openDatabase(dataDir);
		cleanup.push(() => reopened.close());
		expect(createSessionIndex(reopened).getDebugForSubject(session.session_id, subject)).toMatchObject({
			summary: { source: "template", ...selected },
			runtime: { memory_stores: memories, vault_ids: ["vlt_mock_1", "vlt_mock_2"] },
		});
		expect(services.catalog.all()).toHaveLength(0);
		expect(db.prepare("SELECT count(*) AS count FROM usage_turns").get()?.count).toBe(0);
		expect(
			(
				await app.request(`/api/admin/debug/files/${file.file_id}/download?session_id=${session.session_id}`, {
					headers,
				})
			).status,
		).toBe(404);
		expect((await app.request(`/api/admin/debug/sessions/${session.session_id}`, { headers })).status).toBe(200);
	});

	it("拒绝选择后失效的资源、非法配置与auditor写入，均不创建Provider会话", async () => {
		const { create, services } = setup();
		const createRemote = vi.spyOn(services.gateway, "createSession");
		for (const input of [
			{ ...selected, remote_environment_id: "" },
			{ ...selected, remote_environment_id: null },
			{ ...selected, remote_agent_id: "removed-agent" },
			{ ...selected, remote_environment_id: "removed-environment" },
			{ ...selected, files: [{ file_id: "removed-file" }] },
			{ ...selected, memory_stores: [{ memory_store_id: "archived-memory", access: "read_write" }] },
			{ ...selected, vault_ids: ["archived-vault"] },
			{ ...selected, vault_ids: ["vlt_mock_1?secret"] },
			{ ...selected, memory_stores: [{ memory_store_id: "memory-guide", access: "invalid" }] },
		])
			expect((await create(input)).status).toBe(400);
		expect((await create(selected, "Bearer auditor")).status).toBe(403);
		expect(createRemote).not.toHaveBeenCalled();
	});

	it("调试流与多Agent线程沿用管理员归属，其他管理员和员工均不能读取已存在资源", async () => {
		const { app, services, create } = setup();
		const { data: session } = (await (await create()).json()) as { data: DebugSessionDetail };
		const path = `/api/admin/debug/sessions/${session.session_id}`;
		expect(
			(
				await app.request(`${path}/messages`, {
					method: "POST",
					headers,
					body: JSON.stringify({ text: "multi-agent" }),
				})
			).status,
		).toBe(202);
		await vi.waitFor(async () => expect((await services.gateway.listThreads(session.session_id)).data).toHaveLength(2));
		const threads = await app.request(`${path}/threads?limit=1`, { headers });
		expect(threads.status).toBe(200);
		const page = (await threads.json()) as SessionThreadsResponse;
		expect(page.next_page_token).toBe("page:1");
		const thread = page.data[0]!.id;
		expect((await app.request(`${path}/threads/${thread}/events?limit=2`, { headers })).status).toBe(200);
		const subject = await adminSubject(app);
		for (const suffix of ["", "/stream", "/threads", `/threads/${thread}/events`]) {
			expect(
				(await app.request(`${path}${suffix}`, { headers: { ...headers, authorization: "Bearer other-admin" } }))
					.status,
			).toBe(404);
			expect(
				(
					await app.request(`/api/kit/sessions/${session.session_id}${suffix}`, {
						headers: { cookie: `kit_subject=${subject}`, "x-kit-protocol-version": "2.0.0" },
					})
				).status,
			).toBe(404);
		}
		expect(
			(
				await app.request(`${path}/messages`, {
					method: "POST",
					headers: { ...headers, authorization: "Bearer other-admin" },
					body: JSON.stringify({ text: "forbidden" }),
				})
			).status,
		).toBe(404);
		expect((await app.request(`${path}/interrupt`, { method: "POST", headers })).status).toBe(200);
	});
});
