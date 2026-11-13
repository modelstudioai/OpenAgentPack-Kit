import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const owner = "anon_file_owner";
const other = "anon_file_other";
const json = { "content-type": "application/json", "x-kit-protocol-version": "2.0.0" };
const headersFor = (subjectId: string) => ({ cookie: `kit_subject=${subjectId}` });

function makeApp() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-file-ownership-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_AUTH_MODE: "anonymous",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "admin-token",
	});
	const db = openDatabase(dataDir);
	cleanup.push(() => db.close());
	const services = createKitServices(config, db);
	services.catalog.upsert({ slug: "assistant", display_name: "Assistant", remote_agent_id: "agent_mock" });
	services.catalog.setStatus("assistant", "listed");
	return { app: createApp(services), services, db, dataDir, config };
}

async function upload(app: ReturnType<typeof makeApp>["app"], subjectId = owner) {
	const form = new FormData();
	form.append("file", new Blob(["private file content"], { type: "text/plain" }), "private.txt");
	const response = await app.request("/api/kit/files", {
		method: "POST",
		headers: headersFor(subjectId),
		body: form,
	});
	expect(response.status).toBe(201);
	return ((await response.json()) as { data: { file_id: string; filename: string } }).data;
}

function createSession(
	app: ReturnType<typeof makeApp>["app"],
	subjectId = owner,
	files: { file_id: string; filename?: string }[] = [],
) {
	return app.request("/api/kit/sessions", {
		method: "POST",
		headers: { ...json, ...headersFor(subjectId) },
		body: JSON.stringify({ agent_slug: "assistant", files }),
	});
}

async function sessionIdOf(response: Response) {
	expect(response.status).toBe(201);
	return ((await response.json()) as { data: { session_id: string } }).data.session_id;
}

describe("文件授权与成员隔离", () => {
	it("上传归属持久化且不保存内容；本人下载成功，其他身份与未知 ID 均为 404", async () => {
		const { app, db, config, dataDir } = makeApp();
		const file = await upload(app);
		const url = `/api/kit/files/${file.file_id}/download`;
		const downloaded = await app.request(url, { headers: headersFor(owner) });
		expect(downloaded.status).toBe(200);
		expect(await downloaded.text()).toBe("private file content");
		expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
		const record = db.prepare("SELECT * FROM kit_uploaded_files").get();
		expect(record).toEqual({
			file_id: file.file_id,
			subject_id: owner,
			purpose: "experience",
			created_at: expect.any(String),
		});
		const denied = await app.request(url, { headers: headersFor(other) });
		const missing = await app.request("/api/kit/files/file_missing/download", { headers: headersFor(other) });
		expect(denied.status).toBe(404);
		expect(missing.status).toBe(404);
		expect(await denied.json()).toEqual(await missing.json());
		const reopenedDb = openDatabase(dataDir);
		cleanup.push(() => reopenedDb.close());
		const reopened = createApp(createKitServices(config, reopenedDb));
		expect((await reopened.request(url, { headers: headersFor(owner) })).status).toBe(200);
		expect((await reopened.request(url, { headers: headersFor(other) })).status).toBe(404);
	});

	it("非 ASCII 文件名按 RFC 5987 编码进下载响应头，不使响应构造失败", async () => {
		const { app } = makeApp();
		const form = new FormData();
		form.append("file", new Blob(["报告内容"], { type: "application/pdf" }), "使用指南.pdf");
		const created = await app.request("/api/kit/files", { method: "POST", headers: headersFor(owner), body: form });
		expect(created.status).toBe(201);
		const { file_id } = ((await created.json()) as { data: { file_id: string } }).data;
		const downloaded = await app.request(`/api/kit/files/${file_id}/download`, { headers: headersFor(owner) });
		expect(downloaded.status).toBe(200);
		const disposition = downloaded.headers.get("content-disposition") ?? "";
		expect(disposition).toContain('filename="____.pdf"');
		expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent("使用指南.pdf")}`);
	});

	it("建会话只允许挂载本人上传的文件，混入其他人的文件在扫描或创建 Provider Session 前被拒", async () => {
		const { app, services } = makeApp();
		const ownFile = await upload(app);
		const otherFile = await upload(app, other);
		const sessionId = await sessionIdOf(await createSession(app, owner, [ownFile]));
		const mounted = await services.gateway.getSession(sessionId);
		expect(mounted?.files?.[0]?.file_id).toBe(ownFile.file_id);
		const scan = vi.spyOn(services.gateway, "fileStatus");
		const create = vi.spyOn(services.gateway, "createSession");
		const denied = await createSession(app, owner, [ownFile, otherFile]);
		expect(denied.status).toBe(404);
		expect((await createSession(app, owner, [{ file_id: "file_unknown" }])).status).toBe(404);
		expect(scan).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
		expect(services.sessionIndex.listForSubject(owner)).toHaveLength(1);
	});

	it("交付文件须出现在本人指定会话完整分页历史中；仅知道文件 ID 或本人其他会话均不能下载", async () => {
		const { app, services } = makeApp();
		const sessionId = await sessionIdOf(await createSession(app));
		const otherSessionId = await sessionIdOf(await createSession(app, other));
		// Provider 文件真实存在，但不是经任何 Kit 成员上传。
		const artifact = await services.gateway.uploadFile({
			filename: "report.txt",
			bytes: new TextEncoder().encode("generated report"),
		});
		const unrelated = await services.gateway.uploadFile({ filename: "unrelated.txt", bytes: new Uint8Array([1]) });
		const history = vi.spyOn(services.gateway, "listEvents").mockImplementation(async (id, options) => {
			if (id !== sessionId) return { events: [], next_page_token: null };
			if (options?.pageToken === "opaque-next-page") {
				return {
					events: [{ event_id: "report_event", type: "message", metadata: { artifacts: [artifact] } }],
					next_page_token: null,
				};
			}
			return { events: [{ event_id: "before_report", type: "message" }], next_page_token: "opaque-next-page" };
		});
		const download = vi.spyOn(services.gateway, "downloadFile");
		const url = `/api/kit/files/${artifact.file_id}/download`;
		const allowed = await app.request(`${url}?session_id=${sessionId}`, { headers: headersFor(owner) });
		expect(allowed.status).toBe(200);
		expect(await allowed.text()).toBe("generated report");
		expect(history).toHaveBeenCalledWith(sessionId, { limit: 100, pageToken: "opaque-next-page" });
		history.mockClear();
		download.mockClear();
		// 无会话证据或他人的会话：不得查询 Provider 历史或下载。
		expect((await app.request(url, { headers: headersFor(owner) })).status).toBe(404);
		expect((await app.request(`${url}?session_id=${sessionId}`, { headers: headersFor(other) })).status).toBe(404);
		expect(history).not.toHaveBeenCalled();
		// 自己拥有的另一个会话也不能给任意 file_id 授权。
		expect((await app.request(`${url}?session_id=${otherSessionId}`, { headers: headersFor(other) })).status).toBe(404);
		expect(
			(
				await app.request(`/api/kit/files/${unrelated.file_id}/download?session_id=${sessionId}`, {
					headers: headersFor(owner),
				})
			).status,
		).toBe(404);
		expect(download).not.toHaveBeenCalled();
	});
});
