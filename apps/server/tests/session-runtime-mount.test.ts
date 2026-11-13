import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { DEFAULT_MOUNT_PREFIX } from "../src/services/attachments.ts";
import { createKitServices } from "../src/services/index.ts";
import { createSessionService } from "../src/services/sessions.ts";
import { openDatabase } from "../src/store/db.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const close of cleanup.splice(0).reverse()) close();
});

const json = { "content-type": "application/json", "x-kit-protocol-version": "2.0.0" };
const owner = "anon_mount_owner";
const other = "anon_mount_other";
const headersFor = (subjectId: string) => ({ cookie: `kit_subject=${subjectId}` });

async function makeServices() {
	const directory = mkdtempSync(join(tmpdir(), "kit-runtime-mount-"));
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
	const directory = mkdtempSync(join(tmpdir(), "kit-mount-route-"));
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

async function upload(app: ReturnType<typeof makeApp>["app"], subjectId = owner, name = "private.txt") {
	const form = new FormData();
	form.append("file", new Blob(["attachment body"], { type: "text/plain" }), name);
	const response = await app.request("/api/kit/files", {
		method: "POST",
		headers: headersFor(subjectId),
		body: form,
	});
	expect(response.status).toBe(201);
	return ((await response.json()) as { data: { file_id: string; filename: string } }).data;
}

async function createSession(app: ReturnType<typeof makeApp>["app"], subjectId = owner) {
	const response = await app.request("/api/kit/sessions", {
		method: "POST",
		headers: { ...json, ...headersFor(subjectId) },
		body: JSON.stringify({ agent_slug: "assistant" }),
	});
	expect(response.status).toBe(201);
	return ((await response.json()) as { data: { session_id: string } }).data.session_id;
}

describe("会话运行时挂载（挂载跟随消息发送）", () => {
	it("先挂载后发送；成功后解析出的挂载路径并入本地索引", async () => {
		const { services, sessions } = await makeServices();
		const created = await sessions.create({ subjectId: "u1", agentSlug: "assistant", remoteAgentId: "mock" });
		const order: string[] = [];
		vi.spyOn(services.gateway, "mountSessionResource").mockImplementation(async (_id, input) => {
			order.push(`mount:${input.fileId}`);
			return { resourceId: `r_${input.fileId}`, mountPath: input.mountPath };
		});
		vi.spyOn(services.gateway, "sendMessage").mockImplementation(async () => {
			order.push("send");
			return { event_ids: ["e1"] };
		});
		const result = await sessions.send(created.session_id, {
			text: "hi",
			attachments: [
				{ file_id: "f1", filename: "a.csv" },
				{ file_id: "f2", filename: "a.csv" },
			],
		});
		expect(result).toEqual({ event_ids: ["e1"] });
		expect(order).toEqual(["mount:f1", "mount:f2", "send"]);
		expect(services.sessionIndex.get(created.session_id)?.files.map((f) => f.mount_path)).toEqual([
			`${DEFAULT_MOUNT_PREFIX}/a.csv`,
			`${DEFAULT_MOUNT_PREFIX}/a-2.csv`,
		]);
		// 关联以发送响应的 event_ids 为键：刷新后的历史气泡附件展示只依赖这条本地索引
		expect(services.sessionIndex.get(created.session_id)?.messageFiles).toEqual([
			{
				event_ids: ["e1"],
				files: [
					{ file_id: "f1", filename: "a.csv", mount_path: `${DEFAULT_MOUNT_PREFIX}/a.csv` },
					{ file_id: "f2", filename: "a.csv", mount_path: `${DEFAULT_MOUNT_PREFIX}/a-2.csv` },
				],
			},
		]);
	});

	it("发送失败自动卸载全部挂载，索引与 mock 镜像都不残留", async () => {
		const { services, sessions } = await makeServices();
		const created = await sessions.create({ subjectId: "u1", agentSlug: "assistant", remoteAgentId: "mock" });
		const unmount = vi.spyOn(services.gateway, "unmountSessionResource");
		vi.spyOn(services.gateway, "sendMessage").mockRejectedValue(new Error("provider down"));
		await expect(
			sessions.send(created.session_id, {
				text: "hi",
				attachments: [
					{ file_id: "f1", filename: "a.csv" },
					{ file_id: "f2", filename: "b.csv" },
				],
			}),
		).rejects.toThrow("provider down");
		expect(unmount).toHaveBeenCalledTimes(2);
		expect(unmount.mock.calls.map((call) => call[1])).toEqual(
			expect.arrayContaining([expect.stringMatching(/^sesrsc_mock_/), expect.stringMatching(/^sesrsc_mock_/)]),
		);
		expect(services.sessionIndex.get(created.session_id)?.files).toEqual([]);
		// mock 的 getSession 在 files 为空时省略键，与 provider 行为一致
		expect((await services.gateway.getSession(created.session_id))?.files ?? []).toEqual([]);
		// 发送失败不落消息关联
		expect(services.sessionIndex.get(created.session_id)?.messageFiles).toEqual([]);
	});

	it("批量挂载中途失败：已挂载的资源照样回滚", async () => {
		const { services, sessions } = await makeServices();
		const created = await sessions.create({ subjectId: "u1", agentSlug: "assistant", remoteAgentId: "mock" });
		const original = services.gateway.mountSessionResource.bind(services.gateway);
		let attempts = 0;
		vi.spyOn(services.gateway, "mountSessionResource").mockImplementation(async (id, input) => {
			attempts += 1;
			if (attempts === 2) throw new Error("mount boom");
			return original(id, input);
		});
		const unmount = vi.spyOn(services.gateway, "unmountSessionResource");
		await expect(
			sessions.send(created.session_id, {
				text: "hi",
				attachments: [
					{ file_id: "f1", filename: "a.csv" },
					{ file_id: "f2", filename: "b.csv" },
				],
			}),
		).rejects.toThrow("mount boom");
		expect(unmount).toHaveBeenCalledTimes(1);
		expect(services.sessionIndex.get(created.session_id)?.files).toEqual([]);
	});

	it("附件扫描未就绪：409 可重试且不触碰 provider 挂载与发送", async () => {
		const { services, sessions } = await makeServices();
		const created = await sessions.create({ subjectId: "u1", agentSlug: "assistant", remoteAgentId: "mock" });
		vi.spyOn(services.gateway, "fileStatus").mockResolvedValue({ available: false, status: "checking" });
		const mount = vi.spyOn(services.gateway, "mountSessionResource");
		const send = vi.spyOn(services.gateway, "sendMessage");
		const error = await sessions
			.send(created.session_id, { text: "hi", attachments: [{ file_id: "f1", filename: "a.csv" }] })
			.catch((e: unknown) => e);
		expect(error).toMatchObject({ code: "conflict", retryable: true });
		expect(mount).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});

	it("运行时挂载路径与创建时挂载同会话去重（-2 后缀）", async () => {
		const { services, sessions } = await makeServices();
		const created = await sessions.create({
			subjectId: "u1",
			agentSlug: "assistant",
			remoteAgentId: "mock",
			files: [{ file_id: "f0", filename: "a.csv" }],
		});
		await sessions.send(created.session_id, { text: "hi", attachments: [{ file_id: "f1", filename: "a.csv" }] });
		expect(services.sessionIndex.get(created.session_id)?.files.map((f) => f.mount_path)).toEqual([
			`${DEFAULT_MOUNT_PREFIX}/a.csv`,
			`${DEFAULT_MOUNT_PREFIX}/a-2.csv`,
		]);
	});

	it("建会话后运行时挂载失败：回滚已挂载资源并删除刚建的 provider 会话", async () => {
		const { services, sessions } = await makeServices();
		const original = services.gateway.mountSessionResource.bind(services.gateway);
		let attempts = 0;
		vi.spyOn(services.gateway, "mountSessionResource").mockImplementation(async (id, input) => {
			attempts += 1;
			if (attempts === 2) throw new Error("mount boom");
			return original(id, input);
		});
		const unmount = vi.spyOn(services.gateway, "unmountSessionResource");
		const deleteSession = vi.spyOn(services.gateway, "deleteSession");
		await expect(
			sessions.create({
				subjectId: "u1",
				agentSlug: "assistant",
				remoteAgentId: "mock",
				files: [
					{ file_id: "f1", filename: "a.csv" },
					{ file_id: "f2", filename: "b.csv" },
				],
			}),
		).rejects.toThrow("mount boom");
		expect(unmount).toHaveBeenCalledTimes(1);
		expect(deleteSession).toHaveBeenCalledTimes(1);
	});

	it("建会话已挂载的附件随首条消息只落关联，不重复挂载", async () => {
		const { services, sessions } = await makeServices();
		const created = await sessions.create({
			subjectId: "u1",
			agentSlug: "assistant",
			remoteAgentId: "mock",
			files: [{ file_id: "f0", filename: "a.csv" }],
		});
		const mount = vi.spyOn(services.gateway, "mountSessionResource");
		vi.spyOn(services.gateway, "sendMessage").mockResolvedValue({ event_ids: ["e1"] });
		await sessions.send(created.session_id, { text: "hi", attachments: [{ file_id: "f0", filename: "a.csv" }] });
		expect(mount).not.toHaveBeenCalled();
		expect(services.sessionIndex.get(created.session_id)?.messageFiles).toEqual([
			{
				event_ids: ["e1"],
				files: [{ file_id: "f0", filename: "a.csv", mount_path: `${DEFAULT_MOUNT_PREFIX}/a.csv` }],
			},
		]);
	});

	it("发送失败：建会话已挂载的附件不回滚也不落关联", async () => {
		const { services, sessions } = await makeServices();
		const created = await sessions.create({
			subjectId: "u1",
			agentSlug: "assistant",
			remoteAgentId: "mock",
			files: [{ file_id: "f0", filename: "a.csv" }],
		});
		const unmount = vi.spyOn(services.gateway, "unmountSessionResource");
		vi.spyOn(services.gateway, "sendMessage").mockRejectedValue(new Error("provider down"));
		await expect(
			sessions.send(created.session_id, { text: "hi", attachments: [{ file_id: "f0", filename: "a.csv" }] }),
		).rejects.toThrow("provider down");
		expect(unmount).not.toHaveBeenCalled();
		expect(services.sessionIndex.get(created.session_id)?.messageFiles).toEqual([]);
		expect(services.sessionIndex.get(created.session_id)?.files.map((f) => f.mount_path)).toEqual([
			`${DEFAULT_MOUNT_PREFIX}/a.csv`,
		]);
	});
});

describe("路由：消息附件运行时挂载", () => {
	it("上传→建会话→带 attachments 发送成功；会话详情与 provider 镜像可见", async () => {
		const { app, services } = makeApp();
		const file = await upload(app);
		const sessionId = await createSession(app);
		const sent = await app.request(`/api/kit/sessions/${sessionId}/messages`, {
			method: "POST",
			headers: { ...json, ...headersFor(owner) },
			body: JSON.stringify({ text: "帮我读一下这个文件", attachments: [file] }),
		});
		expect(sent.status).toBe(202);
		const detail = await app.request(`/api/kit/sessions/${sessionId}`, { headers: headersFor(owner) });
		const { data } = (await detail.json()) as {
			data: {
				files?: { file_id: string; mount_path: string }[];
				message_files?: { event_ids: string[]; files: { file_id: string }[] }[];
			};
		};
		expect(data.files).toEqual([
			{
				file_id: file.file_id,
				filename: file.filename,
				mount_path: `${DEFAULT_MOUNT_PREFIX}/private.txt`,
				size: 15,
			},
		]);
		// 详情透出关联：event_ids 是 mock 发送响应回传的用户事件 id，files 与请求附件一致
		expect(data.message_files).toHaveLength(1);
		expect(data.message_files?.[0]?.event_ids).toHaveLength(1);
		expect(data.message_files?.[0]?.files).toEqual([
			{ file_id: file.file_id, filename: file.filename, mount_path: `${DEFAULT_MOUNT_PREFIX}/private.txt`, size: 15 },
		]);
		expect((await services.gateway.getSession(sessionId))?.files?.map((f) => f.file_id)).toContain(file.file_id);
	});

	it("attachments 引用他人或未知 file_id → 404，且不触碰 provider 挂载", async () => {
		const { app, services } = makeApp();
		const ownFile = await upload(app);
		const otherFile = await upload(app, other);
		const sessionId = await createSession(app);
		const mount = vi.spyOn(services.gateway, "mountSessionResource");
		const send = vi.spyOn(services.gateway, "sendMessage");
		const denied = await app.request(`/api/kit/sessions/${sessionId}/messages`, {
			method: "POST",
			headers: { ...json, ...headersFor(owner) },
			body: JSON.stringify({ text: "hi", attachments: [ownFile, otherFile] }),
		});
		expect(denied.status).toBe(404);
		const unknown = await app.request(`/api/kit/sessions/${sessionId}/messages`, {
			method: "POST",
			headers: { ...json, ...headersFor(owner) },
			body: JSON.stringify({ text: "hi", attachments: [{ file_id: "file_unknown", filename: "x.txt" }] }),
		});
		expect(unknown.status).toBe(404);
		expect(mount).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});
});
