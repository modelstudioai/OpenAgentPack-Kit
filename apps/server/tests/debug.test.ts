import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DebugSessionDetail, PlanResponse, ToolApprovalsResponse } from "@openagentpack/kit-sdk/protocol";
import { KitError } from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const close of cleanup.splice(0).reverse()) close();
});
const headers = {
	authorization: "Bearer debug-admin",
	"content-type": "application/json",
	"x-kit-protocol-version": "2.0.0",
};
const other = { ...headers, authorization: "Bearer other-admin" };
const auditor = { ...headers, authorization: "Bearer auditor" };

function setup() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-debug-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_AUTH_MODE: "anonymous",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "debug-admin",
		KIT_ADMIN_TOKENS: "other-admin:admin,auditor:auditor",
		KIT_RATE_LIMIT_RPS: "0",
	});
	const db = openDatabase(dataDir);
	cleanup.push(() => db.close());
	const services = createKitServices(config, db);
	const resolve = vi.spyOn(services.gateway, "listRemoteAgents");
	const app = createApp(services);
	const createPath = "/api/admin/debug/sessions";
	async function create(body: unknown = {}) {
		const response = await app.request(createPath, {
			method: "POST",
			headers,
			body: JSON.stringify({ remote_agent_id: "agent_mock_assistant", ...(body as Record<string, unknown>) }),
		});
		expect(response.status, await response.clone().text()).toBe(201);
		return ((await response.json()) as { data: DebugSessionDetail }).data;
	}
	return { app, services, db, config, dataDir, createPath, create, resolve };
}

async function upload(
	app: ReturnType<typeof setup>["app"],
	path = "/api/admin/debug/files",
	customHeaders: Record<string, string> = { authorization: headers.authorization },
) {
	const body = new FormData();
	body.append("file", new Blob(["private debug input"], { type: "text/plain" }), "debug.txt");
	const response = await app.request(path, { method: "POST", headers: customHeaders, body });
	expect(response.status).toBe(201);
	return ((await response.json()) as { data: { file_id: string; filename: string; size: number } }).data;
}

async function readUntilReady(response: Response) {
	const reader = response.body!.getReader();
	let text = "";
	while (!text.includes("event: ready")) {
		const next = await reader.read();
		if (next.done) throw new Error("stream ended before ready");
		text += new TextDecoder().decode(next.value);
	}
	await reader.cancel();
	return text;
}

describe("管理员调试合同", () => {
	it("从已发布目标建会话，消息/审批复用运行时且不产生 Catalog 或员工 Credits", async () => {
		const { app, create, services, db, resolve } = setup();
		const session = await create({ title: "调试" });
		expect(resolve).toHaveBeenCalled();
		expect(session).toMatchObject({
			remote_agent_id: "agent_mock_assistant",
			title: "调试",
		});
		expect(session).not.toHaveProperty("agent_slug");
		const path = `/api/admin/debug/sessions/${session.session_id}`;
		expect((await app.request(path, { headers })).status).toBe(200);
		expect(
			(
				await app.request(`${path}/messages`, {
					method: "POST",
					headers,
					body: JSON.stringify({ text: "approval thread" }),
				})
			).status,
		).toBe(202);
		const approvals = (
			(await (await app.request(`${path}/tool-approvals`, { headers })).json()) as { data: ToolApprovalsResponse }
		).data;
		expect(approvals.requires_action).toBe(true);
		expect(
			(await app.request(`${path}/messages`, { method: "POST", headers, body: JSON.stringify({ text: "pending" }) }))
				.status,
		).toBe(409);
		const decision = { batch_id: approvals.batch_id, call_id: "call_read", result: "allow" };
		expect(
			(await app.request(`${path}/tool-approvals`, { method: "POST", headers, body: JSON.stringify(decision) })).status,
		).toBe(202);
		expect(
			(await app.request(`${path}/tool-approvals`, { method: "POST", headers, body: JSON.stringify(decision) })).status,
		).toBe(409);
		expect((await app.request(`${path}/interrupt`, { method: "POST", headers })).status).toBe(200);
		expect(services.catalog.all()).toHaveLength(0);
		expect(db.prepare("SELECT count(*) AS count FROM usage_turns").get()?.count).toBe(0);
		expect(db.prepare("SELECT purpose, agent_slug FROM kit_sessions").get()).toEqual({
			purpose: "admin_debug",
			agent_slug: null,
		});
		expect(services.audit.list()).toEqual([]);
	});

	it("未发布拒绝且不创建 Provider Session；角色与跨管理员/跨用途隔离验证已存在资源", async () => {
		const { app, create, createPath, resolve, services } = setup();
		const identity = (
			(await (await app.request("/api/admin/identity", { headers })).json()) as {
				data: { subject: string; role: string };
			}
		).data;
		expect(identity.role).toBe("admin");
		expect(
			((await (await app.request("/api/admin/identity", { headers: auditor })).json()) as { data: { role: string } })
				.data.role,
		).toBe("auditor");
		const session = await create();
		const path = `/api/admin/debug/sessions/${session.session_id}`;
		expect((await app.request(path, { headers })).status).toBe(200);
		expect((await app.request(path, { headers: other })).status).toBe(404);
		expect(
			(
				await app.request(`${path}/messages`, {
					method: "POST",
					headers: other,
					body: JSON.stringify({ text: "other" }),
				})
			).status,
		).toBe(404);
		expect((await app.request(createPath, { method: "POST", headers: auditor, body: "{}" })).status).toBe(403);
		// 相同 subject 的员工身份也不能访问调试域，不能靠管理员前缀作为隔离。
		const employee = { cookie: `kit_subject=${identity.subject}`, "x-kit-protocol-version": "2.0.0" };
		expect((await app.request(`/api/kit/sessions/${session.session_id}`, { headers: employee })).status).toBe(404);
		expect((await app.request(`/api/kit/sessions/${session.session_id}/stream`, { headers: employee })).status).toBe(
			404,
		);
		expect(
			((await (await app.request("/api/kit/sessions", { headers: employee })).json()) as { data: unknown[] }).data,
		).toEqual([]);
		const createRemote = vi.spyOn(services.gateway, "createSession");
		resolve.mockRejectedValueOnce(new KitError("conflict", "请先发布 Agent"));
		expect(
			(
				await app.request(createPath, {
					method: "POST",
					headers,
					body: JSON.stringify({ remote_agent_id: "agent_mock_assistant" }),
				})
			).status,
		).toBe(409);
		expect(createRemote).not.toHaveBeenCalled();
	});

	it("调试 SSE 使用 Kit ready/after 协议，缺版本拒绝且重新连接不发送新消息", async () => {
		const { app, create, services } = setup();
		const session = await create();
		const path = `/api/admin/debug/sessions/${session.session_id}`;
		expect((await app.request(`${path}/stream`, { headers: { authorization: headers.authorization } })).status).toBe(
			409,
		);
		expect(
			(
				await app.request(`${path}/messages`, {
					method: "POST",
					headers: { authorization: headers.authorization, "content-type": "application/json" },
					body: JSON.stringify({ text: "hello" }),
				})
			).status,
		).toBe(409);
		expect(
			(
				await app.request(`${path}/messages`, {
					method: "POST",
					headers,
					body: JSON.stringify({ text: "approval" }),
				})
			).status,
		).toBe(202);
		const send = vi.spyOn(services.gateway, "sendMessage");
		const first = await readUntilReady(await app.request(`${path}/stream`, { headers }));
		expect(first).toContain("event: reset");
		const cursor = /"cursor":"([^"]+)"/.exec(first)?.[1];
		expect(cursor).toBeTruthy();
		const resumed = await readUntilReady(
			await app.request(`${path}/stream?after=${encodeURIComponent(cursor!)}`, { headers }),
		);
		expect(resumed).toContain("event: ready");
		expect(resumed).toContain(`"after":"${cursor}"`);
		expect(send).not.toHaveBeenCalled();
		expect((await app.request(`${path}/events`, { headers })).status).toBe(200);
		expect(services.audit.list()).toEqual([]);
	});

	it("上传、挂载与交付下载都按用途及管理员主体隔离，中途附件拒绝", async () => {
		const { app, create, services, db } = setup();
		const identity = (
			(await (await app.request("/api/admin/identity", { headers })).json()) as { data: { subject: string } }
		).data;
		const own = await upload(app);
		expect((await app.request(`/api/admin/debug/files/${own.file_id}/download`, { headers })).status).toBe(200);
		expect((await app.request(`/api/admin/debug/files/${own.file_id}/download`, { headers: other })).status).toBe(404);
		const employeeHeaders = { cookie: `kit_subject=${identity.subject}` };
		expect((await app.request(`/api/kit/files/${own.file_id}/download`, { headers: employeeHeaders })).status).toBe(
			404,
		);
		const employeeUpload = await upload(app, "/api/kit/files", employeeHeaders);
		expect((await app.request(`/api/admin/debug/files/${employeeUpload.file_id}/download`, { headers })).status).toBe(
			404,
		);
		const session = await create({ files: [own] });
		expect(session.files?.[0]?.file_id).toBe(own.file_id);
		expect((await services.gateway.getSession(session.session_id))?.files?.[0]?.file_id).toBe(own.file_id);
		const path = `/api/admin/debug/sessions/${session.session_id}`;
		expect(
			(
				await app.request(`${path}/messages`, {
					method: "POST",
					headers,
					body: JSON.stringify({ text: "attachment", attachments: [own] }),
				})
			).status,
		).toBe(400);
		expect(() => services.files.requireUploads(identity.subject, [employeeUpload], "admin_debug")).toThrow();
		await expect(
			services.debug.createTemplate(identity.subject, {
				remote_agent_id: "agent_mock_assistant",
				files: [employeeUpload],
			}),
		).resolves.toMatchObject({ files: [expect.objectContaining({ file_id: employeeUpload.file_id })] });
		const artifact = await services.gateway.uploadFile({
			filename: "result.txt",
			bytes: new TextEncoder().encode("result"),
		});
		vi.spyOn(services.gateway, "listEvents").mockResolvedValue({
			events: [{ event_id: "output", type: "message", metadata: { artifacts: [artifact] } }],
			next_page_token: null,
		});
		const url = `/api/admin/debug/files/${artifact.file_id}/download?session_id=${session.session_id}`;
		expect((await app.request(url, { headers })).status).toBe(200);
		expect((await app.request(url, { headers: other })).status).toBe(404);
		expect(
			(
				await app.request(`/api/kit/files/${artifact.file_id}/download?session_id=${session.session_id}`, {
					headers: employeeHeaders,
				})
			).status,
		).toBe(404);
		expect(db.prepare("SELECT purpose FROM kit_uploaded_files WHERE file_id = ?").get(own.file_id)?.purpose).toBe(
			"admin_debug",
		);
		expect(services.audit.list()).toEqual([]);
	});

	it("删除必须先确认，令牌绑定实际调试会话，不可用于另一会话", async () => {
		const { app, create, services } = setup();
		const one = await create();
		const two = await create();
		const path = `/api/admin/debug/sessions/${one.session_id}`;
		expect((await app.request(path, { headers })).status).toBe(200);
		expect((await app.request(path, { method: "DELETE", headers, body: "{}" })).status).toBe(400);
		expect(
			(
				await app.request(path, {
					method: "DELETE",
					headers,
					body: JSON.stringify({ plan_id: "missing", confirm_token: "forged" }),
				})
			).status,
		).toBe(428);
		const plan = (
			(await (
				await app.request(`${path}/plan`, { method: "POST", headers, body: JSON.stringify({ action: "delete" }) })
			).json()) as { data: PlanResponse }
		).data;
		expect(plan.diff[0]?.resource).toBe(`session:${one.session_id}`);
		const body = JSON.stringify({ plan_id: plan.plan_id, confirm_token: plan.confirm_token });
		expect(
			(await app.request(`/api/admin/debug/sessions/${two.session_id}`, { method: "DELETE", headers, body })).status,
		).toBe(428);
		expect((await app.request(path, { method: "DELETE", headers, body })).status).toBe(200);
		expect(await services.gateway.getSession(one.session_id)).toBeNull();
		expect((await app.request(path, { headers })).status).toBe(404);
		expect((await app.request(`/api/admin/debug/sessions/${two.session_id}`, { headers })).status).toBe(200);
		expect(services.audit.list()).toEqual([]);
	});
});
