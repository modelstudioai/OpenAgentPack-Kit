import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createMockGateway } from "../src/gateway/mock.ts";
import { createFileService } from "../src/services/files.ts";
import { openDatabase } from "../src/store/db.ts";
import { createFileStore } from "../src/store/files.ts";
import { createSessionIndex } from "../src/store/sessions.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const close of cleanup.splice(0).reverse()) close();
});

/** 构造 004 / 005 时的持久库；旧挂载数据通过 Session 索引写入，不使用新上传归属接口。 */
function legacyDatabase(version: "004" | "005") {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-legacy-files-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	let db = openDatabase(dataDir);
	cleanup.push(() => db.close());
	db.prepare("DELETE FROM _kit_migrations WHERE id = '006_legacy_file_ownership'").run();
	if (version === "004") {
		db.exec("DROP TABLE kit_uploaded_files; DROP TABLE kit_member_sessions;");
		// 本测试回退成员/文件 schema；007 也必须重跑，为重建的上传表添加用途域。
		db.prepare("DELETE FROM _kit_migrations WHERE id = '007_admin_debug_scope'").run();
		db.prepare("DELETE FROM _kit_migrations WHERE id = '005_member_auth'").run();
	}
	return {
		get db() {
			return db;
		},
		reopen() {
			db.close();
			db = openDatabase(dataDir);
			return db;
		},
	};
}

function mount(db: DatabaseSync, sessionId: string, subjectId: string, fileId: string) {
	createSessionIndex(db).create({
		sessionId,
		subjectId,
		agentSlug: "assistant",
		files: [{ file_id: fileId, filename: "old.txt" }],
	});
}

const owner = "anon_legacy_owner";
const other = "anon_other";

describe("历史附件归属升级", () => {
	it.each(["004", "005"] as const)("从 %s 升级后，原身份可下载和重新挂载旧文件，其他身份仍被拒", async (version) => {
		const legacy = legacyDatabase(version);
		const gateway = createMockGateway();
		const file = await gateway.uploadFile({ filename: "old.txt", bytes: new TextEncoder().encode("old contents") });
		mount(legacy.db, "session_before_upgrade", owner, file.file_id);
		mount(legacy.db, "session_same_owner", owner, file.file_id);
		// 负向检查前先证明 Provider 文件和原有 Session 归属确实存在。
		expect(new TextDecoder().decode((await gateway.downloadFile(file.file_id)).body)).toBe("old contents");
		expect(createSessionIndex(legacy.db).getForSubject("session_before_upgrade", owner)).not.toBeNull();
		const db = legacy.reopen();
		const files = createFileService({ gateway, store: createFileStore(db), sessionIndex: createSessionIndex(db) });
		expect(new TextDecoder().decode((await files.download(owner, file.file_id)).body)).toBe("old contents");
		expect(() => files.requireUploads(owner, [file])).not.toThrow();
		expect(() => files.requireUploads(other, [file])).toThrow("文件不存在");
		await expect(files.download(other, file.file_id, "session_before_upgrade")).rejects.toMatchObject({ status: 404 });
		// 重开不重复迁移；删掉会话索引也不会丢掉已恢复的上传归属。
		createSessionIndex(db).remove("session_before_upgrade");
		createSessionIndex(db).remove("session_same_owner");
		const reopened = legacy.reopen();
		expect(createFileStore(reopened).isUploadedBy(file.file_id, owner)).toBe(true);
		expect(reopened.prepare("SELECT COUNT(*) AS count FROM kit_uploaded_files").get()?.count).toBe(1);
	});

	it("跨身份歧义不授权，已有上传记录不被覆盖，无挂载证据或坏数据不产生归属", async () => {
		const legacy = legacyDatabase("005");
		const gateway = createMockGateway();
		const ambiguous = await gateway.uploadFile({ filename: "shared.txt", bytes: new Uint8Array([1]) });
		const recorded = await gateway.uploadFile({ filename: "recorded.txt", bytes: new Uint8Array([2]) });
		const unattached = await gateway.uploadFile({ filename: "unattached.txt", bytes: new Uint8Array([3]) });
		mount(legacy.db, "shared_a", owner, ambiguous.file_id);
		mount(legacy.db, "shared_b", other, ambiguous.file_id);
		mount(legacy.db, "recorded_old_index", other, recorded.file_id);
		createFileStore(legacy.db).recordUpload(recorded.file_id, owner);
		for (const [i, value] of [
			"invalid json",
			'{"file_id":"not-an-array"}',
			'[null,"text",1,{}, {"file_id":2}, {"file_id":""}]',
		].entries()) {
			mount(legacy.db, `malformed_${i}`, owner, "placeholder");
			legacy.db.prepare("UPDATE kit_sessions SET files_json = ? WHERE session_id = ?").run(value, `malformed_${i}`);
		}
		const db = legacy.reopen();
		const files = createFileService({ gateway, store: createFileStore(db), sessionIndex: createSessionIndex(db) });
		for (const subjectId of [owner, other]) {
			expect(() => files.requireUploads(subjectId, [ambiguous])).toThrow("文件不存在");
			await expect(files.download(subjectId, ambiguous.file_id)).rejects.toMatchObject({ status: 404 });
		}
		expect(() => files.requireUploads(owner, [recorded])).not.toThrow();
		expect(() => files.requireUploads(other, [recorded])).toThrow("文件不存在");
		await expect(files.download(owner, unattached.file_id)).rejects.toMatchObject({ status: 404 });
		expect(db.prepare("SELECT file_id, subject_id FROM kit_uploaded_files").all()).toEqual([
			{ file_id: recorded.file_id, subject_id: owner },
		]);
	});
});
