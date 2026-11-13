import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttachmentRef } from "@openagentpack/kit-sdk/protocol";
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
const json = { "content-type": "application/json", "x-kit-protocol-version": "2.0.0" };
const admin = { ...json, authorization: "Bearer admin-token" };

function setup() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-catalog-files-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const db = openDatabase(dataDir);
	cleanup.push(() => db.close());
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_AUTH_MODE: "anonymous",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "admin-token",
	});
	const services = createKitServices(config, db);
	const app = createApp(services);
	const upload = (subject: string, filename = "guide.txt") =>
		services.files.upload(subject, { filename, bytes: new TextEncoder().encode("file content") });
	const create = (files: AttachmentRef[]) =>
		app.request("/api/admin/agents", {
			method: "POST",
			headers: admin,
			body: JSON.stringify({
				slug: "files-agent",
				display_name: "文件条目",
				remote_agent_id: "agent_mock_assistant",
				files,
			}),
		});
	const update = (body: Record<string, unknown>) =>
		app.request("/api/admin/agents/files-agent", { method: "PUT", headers: admin, body: JSON.stringify(body) });
	const session = (files: AttachmentRef[] = []) =>
		app.request("/api/kit/sessions", {
			method: "POST",
			headers: { ...json, cookie: "kit_subject=member-one" },
			body: JSON.stringify({ agent_slug: "files-agent", files }),
		});
	return { app, services, upload, create, update, session, dataDir, config };
}

describe("上架目录的共享文件白名单", () => {
	it("管理端列表有认证保护；保存校准元数据与默认路径，持久化后省略保留、[]清空", async () => {
		const { app, services, upload, create, update, dataDir, config } = setup();
		const file = await upload("uploader", "文档 v1.txt");
		const path = "/api/admin/remote/files";
		const listed = await app.request(path, { headers: admin });
		expect(listed.status).toBe(200);
		expect(await listed.json()).toMatchObject({ data: [{ file_id: file.file_id, available: true }] });
		expect((await app.request(path)).status).toBe(401);
		expect((await create([{ file_id: file.file_id, filename: "forged.txt", size: 999 }])).status).toBe(201);
		const expected = [{ ...file, mount_path: "/mnt/session/uploads/文档_v1.txt" }];
		expect(services.catalog.getBySlug("files-agent")?.files).toEqual(expected);
		expect((await update({ description: "保留文件" })).status).toBe(200);
		const reopened = openDatabase(dataDir);
		cleanup.push(() => reopened.close());
		expect(createKitServices(config, reopened).catalog.getBySlug("files-agent")?.files).toEqual(expected);
		expect((await update({ files: [] })).status).toBe(200);
		expect(services.catalog.getBySlug("files-agent")?.files).toEqual([]);
	});

	it("保存拒绝不存在/非上传/不可用文件以及重复ID和路径；失败保留原配置", async () => {
		const { services, upload, create, update } = setup();
		const first = await upload("uploader", "first.txt");
		const second = await upload("uploader", "second.txt");
		expect((await create([first])).status).toBe(201);
		const original = services.catalog.getBySlug("files-agent")?.files;
		for (const invalid of [
			[{ file_id: "not-an-upload" }],
			[first, first],
			[
				{ ...first, mount_path: "/mnt/a.txt" },
				{ ...second, mount_path: "/mnt/./a.txt" },
			],
			[{ ...first, mount_path: "relative.txt" }],
			[{ ...first, mount_path: "/mnt/../escape.txt" }],
			[{ ...first, mount_path: "/mnt/invalid\u0000.txt" }],
			[{ ...first, mount_path: "/mnt/invalid\u0085.txt" }],
		])
			expect((await update({ files: invalid })).status).toBe(400);
		vi.spyOn(services.gateway, "getRemoteFile").mockResolvedValue({
			file_id: second.file_id,
			filename: second.filename,
			available: false,
			status: "checking",
		});
		expect((await update({ files: [second] })).status).toBe(409);
		expect(services.catalog.getBySlug("files-agent")?.files).toEqual(original);
	});

	it("新会话合并目录文件与本人附件；目录授权不能被请求借用或转成直接下载权限", async () => {
		const { app, services, upload, create, update, session } = setup();
		const shared = await upload("another-uploader");
		const own = await upload("member-one");
		const privateFile = await upload("another-uploader", "private.txt");
		expect((await create([shared])).status).toBe(201);
		services.catalog.setStatus("files-agent", "listed");
		const createRemote = vi.spyOn(services.gateway, "createSession");
		const created = await session([{ ...own, mount_path: "/mnt/session//uploads/./guide.txt" }]);
		expect(created.status).toBe(201);
		const body = (await created.json()) as { data: { session_id: string; files: AttachmentRef[] } };
		expect(body.data.files.map(({ file_id, mount_path }) => ({ file_id, mount_path }))).toEqual([
			{ file_id: shared.file_id, mount_path: "/mnt/session/uploads/guide.txt" },
			{ file_id: own.file_id, mount_path: "/mnt/session/uploads/guide-2.txt" },
		]);
		createRemote.mockClear();
		expect((await session([shared])).status).toBe(404);
		expect((await session([privateFile])).status).toBe(404);
		expect(createRemote).not.toHaveBeenCalled();
		const deniedDownload = await app.request(
			`/api/kit/files/${shared.file_id}/download?session_id=${body.data.session_id}`,
			{ headers: { cookie: "kit_subject=member-one" } },
		);
		expect(deniedDownload.status).toBe(404);
		expect((await update({ files: [] })).status).toBe(200);
		expect((await session()).status).toBe(201);
		expect(createRemote).toHaveBeenLastCalledWith({ agentId: "agent_mock_assistant" });
	});

	it("相同本人文件与目录去重，合并超过10项在创建远端会话前拒绝", async () => {
		const { services, upload, create, session } = setup();
		const files = await Promise.all(
			Array.from({ length: 10 }, (_, index) => upload("member-one", `file-${index}.txt`)),
		);
		expect((await create(files)).status).toBe(201);
		services.catalog.setStatus("files-agent", "listed");
		const createRemote = vi.spyOn(services.gateway, "createSession");
		const mountRemote = vi.spyOn(services.gateway, "mountSessionResource");
		expect((await session([files[0]!])).status).toBe(201);
		// 合并结果在创建远端会话后经运行时挂载落到 provider（创建载荷不携带文件）
		expect(createRemote).toHaveBeenCalledTimes(1);
		expect(mountRemote).toHaveBeenCalledTimes(10);
		createRemote.mockClear();
		const extra = await upload("member-one", "extra.txt");
		expect((await session([extra])).status).toBe(400);
		expect(createRemote).not.toHaveBeenCalled();
	});
});
