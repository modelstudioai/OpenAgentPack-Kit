import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { openDatabase } from "../src/store/db.ts";
import { createFileStore } from "../src/store/files.ts";
import { createSessionIndex } from "../src/store/sessions.ts";

it("升级真实旧会话/文件索引后保留员工数据，并持久隔离同 subject 的调试记录", () => {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-debug-migration-"));
	let db = new DatabaseSync(join(dataDir, "kit.sqlite"));
	try {
		// 006 的真实旧形状，没有 purpose 或任何调试字段。
		db.exec(`
CREATE TABLE _kit_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE catalog_agents (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
  description TEXT, icon TEXT, opening_remarks TEXT, suggested_prompts TEXT NOT NULL DEFAULT '[]',
  capabilities TEXT NOT NULL DEFAULT '{}', theme TEXT, remote_agent_id TEXT NOT NULL,
  remote_agent_version INTEGER, visibility TEXT NOT NULL DEFAULT 'public', ordering INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'unlisted', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general', featured INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE kit_sessions (
  session_id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, agent_slug TEXT NOT NULL,
  remote_agent_id TEXT, title TEXT, status TEXT, created_at TEXT NOT NULL, last_event_at TEXT, files_json TEXT
);
CREATE INDEX idx_sessions_subject ON kit_sessions(subject_id, created_at);
CREATE TABLE kit_uploaded_files (file_id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE kit_operations (
 operation_id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT, status TEXT NOT NULL,
 phase TEXT, progress REAL NOT NULL DEFAULT 0, log TEXT NOT NULL DEFAULT '[]', result TEXT, error TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT INTO kit_operations (operation_id,kind,status,error,created_at,updated_at)
 VALUES ('legacy-operation','publish','failed','historical failure','2026-10-20','2026-10-20');
INSERT INTO kit_sessions VALUES ('old-session','same-subject','assistant','remote-old','保留的会话','idle','2026-10-20',NULL,'[{"file_id":"old-file"}]');
INSERT INTO kit_uploaded_files VALUES ('old-file','same-subject','2026-10-20');
`);
		for (const id of [
			"001_init",
			"002_session_files",
			"003_quota_plaza",
			"004_members",
			"005_member_auth",
			"006_legacy_file_ownership",
		]) {
			db.prepare("INSERT INTO _kit_migrations VALUES (?, ?)").run(id, "2026-10-20");
		}
		db.close();
		db = openDatabase(dataDir);
		expect(
			db
				.prepare("SELECT error,publication_json,error_details_json FROM kit_operations WHERE operation_id=?")
				.get("legacy-operation"),
		).toMatchObject({ error: "historical failure", publication_json: null, error_details_json: null });
		const sessions = createSessionIndex(db);
		const files = createFileStore(db);
		expect(sessions.getForSubject("old-session", "same-subject")?.summary).toMatchObject({
			title: "保留的会话",
			agent_slug: "assistant",
		});
		expect(sessions.getForSubject("old-session", "same-subject")?.files).toEqual([{ file_id: "old-file" }]);
		expect(files.isUploadedBy("old-file", "same-subject")).toBe(true);
		expect(files.isUploadedBy("old-file", "same-subject", "admin_debug")).toBe(false);
		sessions.create({
			sessionId: "debug-session",
			subjectId: "same-subject",
			purpose: "admin_debug",
			debug: {
				project_name: "project",
				agent_key: "assistant",
				remote_agent_id: "remote-debug",
				source_dirty: false,
			},
		});
		files.recordUpload("debug-file", "same-subject", "admin_debug");
		db.close();
		db = openDatabase(dataDir);
		const reopened = createSessionIndex(db);
		expect(reopened.listForSubject("same-subject").map((row) => row.session_id)).toEqual(["old-session"]);
		expect(reopened.listDebugForSubject("same-subject", "project", "assistant").map((row) => row.session_id)).toEqual([
			"debug-session",
		]);
		expect(reopened.getDebugForSubject("debug-session", "same-subject")?.summary.source_dirty).toBe(false);
		expect(reopened.getForSubject("debug-session", "same-subject")).toBeNull();
		expect(reopened.getDebugForSubject("old-session", "same-subject")).toBeNull();
		expect(createFileStore(db).isUploadedBy("debug-file", "same-subject")).toBe(false);
		expect(createFileStore(db).isUploadedBy("debug-file", "same-subject", "admin_debug")).toBe(true);
	} finally {
		if (db.isOpen) db.close();
		rmSync(dataDir, { recursive: true, force: true });
	}
});

it("已有项目调试迁移后明确来源并保留原归属，允许无项目的模版调试持久化", () => {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-template-migration-"));
	let db = openDatabase(dataDir);
	try {
		// 重建 014 的真实 Session 表，证明新迁移不把已存在的项目记录当成模版。
		db.exec(`
DELETE FROM _kit_migrations WHERE id IN ('015_template_debug_sessions', '024_template_default_environment');
DROP TABLE kit_sessions;
CREATE TABLE kit_sessions (
 session_id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, purpose TEXT NOT NULL,
 agent_slug TEXT, remote_agent_id TEXT, project_name TEXT, agent_key TEXT,
 project_revision TEXT, source_dirty INTEGER, title TEXT, status TEXT,
 created_at TEXT NOT NULL, last_event_at TEXT, files_json TEXT
);
INSERT INTO kit_sessions VALUES ('project-debug','admin','admin_debug',NULL,'agent_remote','project','assistant','rev',0,'旧调试','idle','2026-10-20',NULL,'[]');
INSERT INTO kit_sessions VALUES ('employee','admin','experience','assistant','agent_remote',NULL,NULL,NULL,NULL,'员工会话','idle','2026-10-20',NULL,'[]');
`);
		db.close();
		db = openDatabase(dataDir);
		const index = createSessionIndex(db);
		expect(index.getDebugForSubject("project-debug", "admin")?.summary).toMatchObject({
			source: "project",
			project_name: "project",
			agent_key: "assistant",
			project_revision: "rev",
			source_dirty: false,
		});
		expect(index.listForSubject("admin").map((row) => row.session_id)).toEqual(["employee"]);
		index.create({
			sessionId: "template-debug",
			subjectId: "admin",
			purpose: "admin_debug",
			debug: {
				source: "template",
				remote_agent_id: "agent_remote",
				remote_environment_id: "env_remote",
				vault_ids: ["vault_1"],
			},
		});
		db.close();
		db = openDatabase(dataDir);
		const reopened = createSessionIndex(db);
		expect(reopened.getDebugForSubject("template-debug", "admin")).toMatchObject({
			summary: { source: "template", remote_environment_id: "env_remote" },
			runtime: { vault_ids: ["vault_1"] },
		});
		expect(reopened.getDebugForSubject("template-debug", "other")).toBeNull();
		expect(reopened.getForSubject("template-debug", "admin")).toBeNull();
	} finally {
		if (db.isOpen) db.close();
		rmSync(dataDir, { recursive: true, force: true });
	}
});

it("升级旧模版调试索引保留完整配置，允许默认环境但仍拒绝混淆用途和来源", () => {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-default-environment-migration-"));
	let db = openDatabase(dataDir);
	try {
		// 015 仍要求模版调试显式指定环境，重建该形状验证 024 的实际升级。
		db.exec(`
DELETE FROM _kit_migrations WHERE id = '024_template_default_environment';
DROP TABLE kit_sessions;
CREATE TABLE kit_sessions (
  session_id TEXT PRIMARY KEY, subject_id TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'experience' CHECK (purpose IN ('experience', 'admin_debug')),
  agent_slug TEXT, remote_agent_id TEXT, project_name TEXT, agent_key TEXT,
  project_revision TEXT, source_dirty INTEGER, title TEXT, status TEXT,
  created_at TEXT NOT NULL, last_event_at TEXT, files_json TEXT,
  debug_source TEXT CHECK (debug_source IN ('project', 'template')),
  remote_environment_id TEXT, runtime_json TEXT,
  CHECK ((purpose = 'experience' AND agent_slug IS NOT NULL AND debug_source IS NULL)
    OR (purpose = 'admin_debug' AND agent_slug IS NULL AND remote_agent_id IS NOT NULL AND debug_source IS NOT NULL AND
      ((debug_source = 'project' AND project_name IS NOT NULL AND agent_key IS NOT NULL)
        OR (debug_source = 'template' AND project_name IS NULL AND agent_key IS NULL AND remote_environment_id IS NOT NULL))))
);
CREATE INDEX idx_sessions_subject ON kit_sessions(purpose, subject_id, created_at);
CREATE INDEX idx_debug_sessions_project ON kit_sessions(purpose, subject_id, project_name, agent_key, created_at);
`);
		const previous = createSessionIndex(db);
		previous.create({ sessionId: "employee", subjectId: "admin", agentSlug: "assistant" });
		previous.create({
			sessionId: "project-debug",
			subjectId: "admin",
			purpose: "admin_debug",
			debug: { project_name: "project", agent_key: "assistant", remote_agent_id: "agent_remote" },
		});
		previous.create({
			sessionId: "template-explicit",
			subjectId: "admin",
			purpose: "admin_debug",
			title: "环境覆盖",
			files: [{ file_id: "file_1", mount_path: "/mnt/file.txt" }],
			debug: {
				source: "template",
				remote_agent_id: "agent_remote",
				agent_version: 3,
				remote_environment_id: "env_remote",
				vault_ids: ["vault_1"],
			},
		});
		const originalRows = db.prepare("SELECT * FROM kit_sessions ORDER BY session_id").all();
		db.close();
		db = openDatabase(dataDir);
		expect(db.prepare("SELECT * FROM kit_sessions ORDER BY session_id").all()).toEqual(originalRows);
		const upgraded = createSessionIndex(db);
		upgraded.create({
			sessionId: "template-default",
			subjectId: "admin",
			purpose: "admin_debug",
			debug: { source: "template", remote_agent_id: "agent_remote", agent_version: 3 },
		});
		expect(upgraded.getDebugForSubject("template-default", "admin")?.summary).not.toHaveProperty(
			"remote_environment_id",
		);
		expect(upgraded.getForSubject("template-default", "admin")).toBeNull();
		expect(upgraded.getDebugForSubject("template-default", "other")).toBeNull();
		expect(upgraded.listForSubject("admin").map((row) => row.session_id)).toEqual(["employee"]);
		for (const invalidUpdate of [
			"purpose='experience'",
			"debug_source='project'",
			"debug_source=NULL",
			"project_name='project'",
			"remote_agent_id=NULL",
		]) {
			expect(() => db.exec(`UPDATE kit_sessions SET ${invalidUpdate} WHERE session_id='template-default'`)).toThrow();
		}
		db.close();
		db = openDatabase(dataDir);
		expect(createSessionIndex(db).getDebugForSubject("template-default", "admin")?.runtime.agent_version).toBe(3);
	} finally {
		if (db.isOpen) db.close();
		rmSync(dataDir, { recursive: true, force: true });
	}
});
