import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

// esbuild 会把静态 `node:sqlite` 改写为 `sqlite`（丢前缀），故用变量间接动态 import 绕过。
const SQLITE_SPEC = "node:sqlite";
const { DatabaseSync: DatabaseSyncCtor } = (await import(SQLITE_SPEC)) as typeof import("node:sqlite");

/** 迁移默认执行 sql；需要按数据内容重算的迁移用 run（同一事务内，勿自行开事务）。 */
const MIGRATIONS: { id: string; sql?: string; run?: (db: DatabaseSync) => void }[] = [
	{
		id: "001_init",
		sql: `
CREATE TABLE IF NOT EXISTS catalog_agents (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  opening_remarks TEXT,
  suggested_prompts TEXT NOT NULL DEFAULT '[]',
  capabilities TEXT NOT NULL DEFAULT '{}',
  theme TEXT,
  remote_agent_id TEXT NOT NULL,
  remote_agent_version INTEGER,
  visibility TEXT NOT NULL DEFAULT 'public',
  ordering INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'unlisted',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kit_sessions (
  session_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  remote_agent_id TEXT,
  title TEXT,
  status TEXT,
  created_at TEXT NOT NULL,
  last_event_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_subject ON kit_sessions(subject_id, created_at);
CREATE TABLE IF NOT EXISTS kit_operations (
  operation_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL,
  phase TEXT,
  progress REAL NOT NULL DEFAULT 0,
  log TEXT NOT NULL DEFAULT '[]',
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kit_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  subject TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);
`,
	},
	{
		// 会话创建时挂载的附件（file_id/mount_path）。只是「挂载映射」索引，不含文件内容。
		id: "002_session_files",
		sql: `ALTER TABLE kit_sessions ADD COLUMN files_json TEXT;`,
	},
	{
		// 广场分类/精选 + Credits 用量配额与提额审批（纯增量；用量只存 turn 账本，不存事件正文）。
		id: "003_quota_plaza",
		sql: `
ALTER TABLE catalog_agents ADD COLUMN category TEXT NOT NULL DEFAULT 'general';
ALTER TABLE catalog_agents ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS quota_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  monthly_credits INTEGER NOT NULL,
  updated_at TEXT,
  updated_by TEXT
);
INSERT OR IGNORE INTO quota_policy (id, monthly_credits) VALUES (1, 200);
CREATE TABLE IF NOT EXISTS quota_override (
  subject_id TEXT PRIMARY KEY,
  monthly_credits INTEGER NOT NULL,
  reason TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quota_pack (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  month TEXT NOT NULL,
  credits INTEGER NOT NULL,
  reason TEXT,
  granted_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quota_pack_subject ON quota_pack(subject_id, month);
CREATE TABLE IF NOT EXISTS quota_request (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  requested_credits INTEGER NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  mode TEXT,
  granted_credits INTEGER,
  review_note TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_quota_request_subject ON quota_request(subject_id, created_at);
CREATE TABLE IF NOT EXISTS usage_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  session_id TEXT NOT NULL,
  client_message_id TEXT,
  day TEXT NOT NULL,
  month TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_turns_idempotency
  ON usage_turns(session_id, client_message_id) WHERE client_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_turns_subject_month ON usage_turns(subject_id, month);
CREATE INDEX IF NOT EXISTS idx_usage_turns_month_agent ON usage_turns(month, agent_slug);
`,
	},
	{
		id: "004_members",
		sql: `
CREATE TABLE kit_members (
  member_id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT,
  auth_type TEXT NOT NULL CHECK (auth_type = 'local'),
  status TEXT NOT NULL CHECK (status = 'active'),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_members_created ON kit_members(created_at, member_id);
`,
	},
	{
		id: "005_member_auth",
		sql: `
CREATE TABLE kit_member_sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_member_sessions_member ON kit_member_sessions(member_id);
CREATE INDEX idx_member_sessions_expiry ON kit_member_sessions(expires_at);
CREATE TABLE kit_uploaded_files (
  file_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_uploaded_files_subject ON kit_uploaded_files(subject_id);
`,
	},
	{
		// 兼容已应用 005 的数据库；只迁移能由历史挂载索引确定唯一 subject 的文件。
		id: "006_legacy_file_ownership",
		sql: `
WITH legacy_attachments AS (
  SELECT s.subject_id, s.created_at,
    CASE WHEN f.type = 'object' THEN json_extract(f.value, '$.file_id') END AS file_id,
    CASE WHEN f.type = 'object' THEN json_type(f.value, '$.file_id') END AS file_id_type
  FROM kit_sessions AS s, json_each(
    CASE WHEN json_valid(s.files_json)
      THEN CASE WHEN json_type(s.files_json) = 'array' THEN s.files_json ELSE '[]' END
      ELSE '[]' END
  ) AS f
)
INSERT OR IGNORE INTO kit_uploaded_files (file_id, subject_id, created_at)
SELECT file_id, MIN(subject_id), MIN(created_at)
FROM legacy_attachments
WHERE file_id_type = 'text' AND length(trim(file_id)) > 0
GROUP BY file_id
HAVING COUNT(DISTINCT subject_id) = 1;
`,
	},
	{
		// 调试会话没有 Catalog slug；用途域与主体共同决定访问权限，历史数据保持 experience。
		id: "007_admin_debug_scope",
		sql: `
CREATE TABLE kit_sessions_scoped (
  session_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'experience' CHECK (purpose IN ('experience', 'admin_debug')),
  agent_slug TEXT,
  remote_agent_id TEXT,
  project_name TEXT,
  agent_key TEXT,
  project_revision TEXT,
  source_dirty INTEGER,
  title TEXT,
  status TEXT,
  created_at TEXT NOT NULL,
  last_event_at TEXT,
  files_json TEXT,
  CHECK ((purpose = 'experience' AND agent_slug IS NOT NULL)
    OR (purpose = 'admin_debug' AND agent_slug IS NULL AND project_name IS NOT NULL
      AND agent_key IS NOT NULL AND remote_agent_id IS NOT NULL))
);
INSERT INTO kit_sessions_scoped
  (session_id, subject_id, agent_slug, remote_agent_id, title, status, created_at, last_event_at, files_json)
SELECT session_id, subject_id, agent_slug, remote_agent_id, title, status, created_at, last_event_at, files_json
FROM kit_sessions;
DROP TABLE kit_sessions;
ALTER TABLE kit_sessions_scoped RENAME TO kit_sessions;
CREATE INDEX idx_sessions_subject ON kit_sessions(purpose, subject_id, created_at);
CREATE INDEX idx_debug_sessions_project ON kit_sessions(purpose, subject_id, project_name, agent_key, created_at);
ALTER TABLE kit_uploaded_files ADD COLUMN purpose TEXT NOT NULL DEFAULT 'experience'
  CHECK (purpose IN ('experience', 'admin_debug'));
`,
	},
	{
		id: "008_member_session_usage",
		sql: `
CREATE TABLE kit_session_usage (
  session_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  title TEXT,
  status TEXT,
  created_at TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_input_tokens INTEGER,
  cache_creation_input_tokens INTEGER,
  active_seconds REAL,
  duration_seconds REAL,
  collection_status TEXT NOT NULL DEFAULT 'pending',
  captured_at TEXT,
  attempted_at TEXT,
  capture_revision INTEGER NOT NULL DEFAULT 0,
  finalized_at TEXT,
  deleted_at TEXT
);
CREATE INDEX idx_session_usage_member ON kit_session_usage(member_id, agent_slug, created_at, session_id);
CREATE TABLE kit_session_deletions (
  session_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
	},
	{
		id: "009_member_usage_limits",
		sql: `
CREATE TABLE kit_usage_limit_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1), monthly_tokens INTEGER, monthly_active_seconds REAL,
  updated_at TEXT, updated_by TEXT
);
INSERT INTO kit_usage_limit_policy (id) VALUES (1);
CREATE TABLE kit_usage_limit_overrides (
  member_id TEXT PRIMARY KEY, monthly_tokens INTEGER, monthly_active_seconds REAL,
  updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);
CREATE TABLE kit_usage_limit_members (
  member_id TEXT PRIMARY KEY, accounting_started_at TEXT NOT NULL
);
CREATE TABLE kit_usage_limit_sessions (
  session_id TEXT PRIMARY KEY, member_id TEXT NOT NULL,
  input_tokens INTEGER, output_tokens INTEGER, active_seconds REAL,
  admission_month TEXT, captured_at TEXT
);
CREATE INDEX idx_usage_limit_sessions_member ON kit_usage_limit_sessions(member_id);
CREATE TABLE kit_usage_limit_months (
  member_id TEXT NOT NULL, month TEXT NOT NULL, tokens INTEGER NOT NULL DEFAULT 0,
  active_seconds REAL NOT NULL DEFAULT 0, tokens_unknown INTEGER NOT NULL DEFAULT 0,
  active_seconds_unknown INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (member_id, month)
);
CREATE TABLE kit_usage_limit_requests (
  session_id TEXT NOT NULL, request_key TEXT NOT NULL, member_id TEXT NOT NULL,
  request_hash TEXT NOT NULL, status TEXT NOT NULL, event_ids TEXT,
  previous_status TEXT, created_at TEXT NOT NULL, PRIMARY KEY (session_id, request_key)
);
CREATE INDEX idx_usage_limit_requests_member ON kit_usage_limit_requests(member_id, status);
`,
	},
	{
		// 历史条目不覆盖 Agent 默认环境；只影响此后创建的体验会话。
		id: "010_catalog_environment",
		sql: `ALTER TABLE catalog_agents ADD COLUMN remote_environment_id TEXT;`,
	},
	{
		id: "011_catalog_files",
		sql: `ALTER TABLE catalog_agents ADD COLUMN files_json TEXT NOT NULL DEFAULT '[]';`,
	},
	{
		id: "012_catalog_memory_stores",
		sql: `ALTER TABLE catalog_agents ADD COLUMN memory_stores_json TEXT NOT NULL DEFAULT '[]';`,
	},
	{
		id: "013_catalog_vaults",
		sql: `ALTER TABLE catalog_agents ADD COLUMN vault_ids_json TEXT NOT NULL DEFAULT '[]';`,
	},
	{
		id: "014_member_groups",
		sql: `
CREATE TABLE kit_groups (
  group_id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT,
  revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_groups_created ON kit_groups(created_at, group_id);
CREATE TABLE kit_group_members (
  group_id TEXT NOT NULL REFERENCES kit_groups(group_id),
  member_id TEXT NOT NULL REFERENCES kit_members(member_id),
  PRIMARY KEY (group_id, member_id)
);
CREATE INDEX idx_group_members_member ON kit_group_members(member_id, group_id);
`,
	},
	{
		id: "015_template_debug_sessions",
		sql: `
CREATE TABLE kit_sessions_targets (
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
        OR (debug_source = 'template' AND project_name IS NULL AND agent_key IS NULL
          AND remote_environment_id IS NOT NULL))))
);
INSERT INTO kit_sessions_targets
  (session_id, subject_id, purpose, agent_slug, remote_agent_id, project_name, agent_key,
   project_revision, source_dirty, title, status, created_at, last_event_at, files_json, debug_source)
SELECT session_id, subject_id, purpose, agent_slug, remote_agent_id, project_name, agent_key,
  project_revision, source_dirty, title, status, created_at, last_event_at, files_json,
  CASE WHEN purpose = 'admin_debug' THEN 'project' ELSE NULL END
FROM kit_sessions;
DROP TABLE kit_sessions;
ALTER TABLE kit_sessions_targets RENAME TO kit_sessions;
CREATE INDEX idx_sessions_subject ON kit_sessions(purpose, subject_id, created_at);
CREATE INDEX idx_debug_sessions_project ON kit_sessions(purpose, subject_id, project_name, agent_key, created_at);
`,
	},
	{
		id: "016_saved_templates",
		sql: `
CREATE TABLE kit_templates (
  template_id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  remote_agent_id TEXT NOT NULL, remote_agent_name TEXT NOT NULL,
  config_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_templates_created ON kit_templates(created_at, template_id);
`,
	},
	{
		id: "017_template_listings",
		sql: `
CREATE TABLE kit_template_listings (
  template_id TEXT PRIMARY KEY REFERENCES kit_templates(template_id) ON DELETE CASCADE,
  catalog_id TEXT NOT NULL UNIQUE REFERENCES catalog_agents(id) ON DELETE CASCADE
);
`,
	},
	{
		id: "018_template_versions",
		sql: `
ALTER TABLE kit_templates ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE kit_templates ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE kit_templates SET updated_at=created_at;
CREATE TABLE kit_template_versions (
  template_id TEXT NOT NULL REFERENCES kit_templates(template_id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0), config_json TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (template_id, version)
);
INSERT INTO kit_template_versions (template_id,version,config_json,created_at)
SELECT template_id,version,config_json,created_at FROM kit_templates;
`,
	},
	{
		id: "019_template_usage_limits",
		sql: `
CREATE TABLE kit_usage_limit_templates (
  template_id TEXT PRIMARY KEY REFERENCES kit_templates(template_id) ON DELETE CASCADE,
  monthly_tokens INTEGER, monthly_active_seconds REAL,
  updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);
CREATE TABLE kit_usage_limit_agent_months (
  agent_slug TEXT NOT NULL, month TEXT NOT NULL, tokens INTEGER NOT NULL DEFAULT 0,
  active_seconds REAL NOT NULL DEFAULT 0, tokens_unknown INTEGER NOT NULL DEFAULT 0,
  active_seconds_unknown INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (agent_slug, month)
);
`,
	},
	{
		// 广场「每日用量」的逐日增量账；与成员月账同事务双写，归因到采集确认日。
		id: "020_usage_limit_days",
		sql: `
CREATE TABLE kit_usage_limit_days (
  member_id TEXT NOT NULL, day TEXT NOT NULL, tokens INTEGER NOT NULL DEFAULT 0,
  active_seconds REAL NOT NULL DEFAULT 0, PRIMARY KEY (member_id, day)
);
`,
	},
	{
		// 启用逐日账前已采集的历史基线没有逐日归属；一次性按最后采集日入账，
		// 基线之后的增量仍由 observe 逐日追加，不与回填重复。
		id: "021_usage_limit_days_backfill",
		sql: `
INSERT INTO kit_usage_limit_days (member_id, day, tokens, active_seconds)
SELECT member_id, substr(captured_at, 1, 10) AS day,
       CAST(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS INTEGER) AS tokens,
       SUM(COALESCE(active_seconds, 0)) AS active_seconds
FROM kit_usage_limit_sessions
WHERE captured_at IS NOT NULL AND admission_month IS NOT NULL
GROUP BY member_id, substr(captured_at, 1, 10)
ON CONFLICT(member_id, day) DO UPDATE SET tokens = excluded.tokens, active_seconds = excluded.active_seconds;
`,
	},
	{
		// 021 的「基线按最后采集日回填」把会话生命周期累计量（含启用前与跨月部分）堆到最近采集日，
		// 与「当月已用」明显对不上。重建逐日账：清掉回填行，把每月已记账增量按当月每日调用次数
		// 占比分摊（当日真实 Token 无法还原，属估算）；每日总和与月账一致，之后的增量仍由 observe 实时追加。
		id: "022_usage_limit_days_rebuild",
		run: (db) => {
			db.exec("DELETE FROM kit_usage_limit_days");
			// 早期旧库升级路径可能还没有 usage_turns（分摊权重来源），此时保持空缺。
			const hasTurns = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'usage_turns'").get();
			if (!hasTurns) return;
			const months = db
				.prepare(
					"SELECT member_id, month, tokens, active_seconds FROM kit_usage_limit_months WHERE tokens > 0 OR active_seconds > 0",
				)
				.all() as { member_id: string; month: string; tokens: number; active_seconds: number }[];
			const dayTurns = db.prepare(
				"SELECT day, COUNT(*) AS turns FROM usage_turns WHERE subject_id = ? AND substr(day, 1, 7) = ? GROUP BY day ORDER BY day",
			);
			const insert = db.prepare(
				"INSERT INTO kit_usage_limit_days (member_id, day, tokens, active_seconds) VALUES (?, ?, ?, ?)",
			);
			for (const row of months) {
				const days = dayTurns.all(row.member_id, row.month) as { day: string; turns: number }[];
				// 没有逐日调用记录可做分摊权重的月份保持空缺，不虚构归属日。
				if (days.length === 0) continue;
				const totalTurns = days.reduce((sum, day) => sum + day.turns, 0);
				const shares = days.map((day) => ({
					day: day.day,
					turns: day.turns,
					tokens: Math.floor((row.tokens * day.turns) / totalTurns),
				}));
				// 整数下取整的余数记到调用次数最多的一天（次数相同取靠后日期），保证逐日总和等于月账。
				let allocated = 0;
				for (const share of shares) allocated += share.tokens;
				shares
					.slice()
					.sort((a, b) => b.turns - a.turns || (a.day < b.day ? 1 : -1))
					.slice(0, row.tokens - allocated)
					.forEach((share) => {
						share.tokens += 1;
					});
				let secondsLeft = row.active_seconds;
				shares.forEach((share, index) => {
					const seconds = index === shares.length - 1 ? secondsLeft : (row.active_seconds * share.turns) / totalTurns;
					secondsLeft -= seconds;
					insert.run(row.member_id, share.day, share.tokens, seconds);
				});
			}
		},
	},
	// 与 feat 线的 019-022（模版限额与逐日账）撞号：合并后统一重排为 023-026，
	// 并加幂等守卫——已按旧 id 应用过这些迁移的 main 线存量库不会重复执行。
	{
		id: "023_catalog_agent_version_binding",
		run: (db) => {
			const columns = db.prepare("PRAGMA table_info(catalog_agents)").all() as { name: string }[];
			if (columns.some((column) => column.name === "agent_version")) return;
			db.exec("ALTER TABLE catalog_agents ADD COLUMN agent_version INTEGER CHECK (agent_version > 0);");
		},
	},
	{
		// 模版调试可沿用 Agent 默认环境；保持原来的用途、来源和归属约束。
		// 对已按旧 id 应用过的 main 线库会重复重建一次：INSERT SELECT 原样搬行，无副作用。
		id: "024_template_default_environment",
		sql: `
CREATE TABLE kit_sessions_optional_environment (
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
        OR (debug_source = 'template' AND project_name IS NULL AND agent_key IS NULL))))
);
INSERT INTO kit_sessions_optional_environment
  (session_id, subject_id, purpose, agent_slug, remote_agent_id, project_name, agent_key,
   project_revision, source_dirty, title, status, created_at, last_event_at, files_json,
   debug_source, remote_environment_id, runtime_json)
SELECT session_id, subject_id, purpose, agent_slug, remote_agent_id, project_name, agent_key,
  project_revision, source_dirty, title, status, created_at, last_event_at, files_json,
  debug_source, remote_environment_id, runtime_json
FROM kit_sessions;
DROP TABLE kit_sessions;
ALTER TABLE kit_sessions_optional_environment RENAME TO kit_sessions;
CREATE INDEX idx_sessions_subject ON kit_sessions(purpose, subject_id, created_at);
CREATE INDEX idx_debug_sessions_project ON kit_sessions(purpose, subject_id, project_name, agent_key, created_at);
`,
	},
	{
		id: "025_resource_draft_batches",
		sql: `
CREATE TABLE IF NOT EXISTS kit_resource_drafts (
  draft_id TEXT PRIMARY KEY, owner TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','publishing','published','failed')),
  phase TEXT NOT NULL CHECK (phase IN ('editable','executing','uncertain','succeeded')),
  resources_json TEXT NOT NULL DEFAULT '[]', cleanup_pending INTEGER NOT NULL DEFAULT 0,
  operation_id TEXT, expected_revision TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_drafts_active_owner ON kit_resource_drafts(owner)
  WHERE status != 'published' OR cleanup_pending = 1;
`,
	},
	{
		id: "026_resource_draft_cleanup_ownership",
		run: (db) => {
			const columns = db.prepare("PRAGMA table_info(kit_resource_drafts)").all() as { name: string }[];
			if (columns.some((column) => column.name === "cleanup_key_hash")) return;
			db.exec("ALTER TABLE kit_resource_drafts ADD COLUMN cleanup_key_hash TEXT;");
		},
	},
	{
		// 限额体系增加「日」周期：三张配置表补 daily_* 列（历史行视为不限量），
		// 条目日账与成员逐日账（020）同构，observe 双写，供日限额准入与面板展示。
		id: "027_usage_limit_daily",
		run: (db) => {
			const addColumn = (table: string, column: string, type: string) => {
				const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
				if (!columns.some((entry) => entry.name === column))
					db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
			};
			for (const table of ["kit_usage_limit_policy", "kit_usage_limit_overrides", "kit_usage_limit_templates"]) {
				addColumn(table, "daily_tokens", "INTEGER");
				addColumn(table, "daily_active_seconds", "REAL");
			}
			db.exec(`CREATE TABLE IF NOT EXISTS kit_usage_limit_agent_days (
  agent_slug TEXT NOT NULL, day TEXT NOT NULL, tokens INTEGER NOT NULL DEFAULT 0,
  active_seconds REAL NOT NULL DEFAULT 0, PRIMARY KEY (agent_slug, day)
);`);
		},
	},
	{
		// 旧条目的创建/更新时间不能证明上架时间，保留 NULL，等待下次实际上架时记录。
		id: "023_catalog_listed_at",
		sql: "ALTER TABLE catalog_agents ADD COLUMN listed_at TEXT;",
	},
	{
		// 随消息运行时挂载的附件 ↔ 发送响应 event_ids 关联；provider 不回显，刷新后的气泡附件展示靠它。
		id: "023_session_message_files",
		sql: `ALTER TABLE kit_sessions ADD COLUMN message_files_json TEXT;`,
	},
	{
		id: "028_preset_packs",
		sql: `CREATE TABLE kit_preset_packs (
  preset_pack_id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);`,
	},
	{
		id: "029_yaml_resource_drafts",
		sql: `ALTER TABLE kit_resource_drafts ADD COLUMN engine TEXT NOT NULL DEFAULT 'directory';
CREATE TABLE kit_resource_draft_documents (
  draft_id TEXT PRIMARY KEY REFERENCES kit_resource_drafts(draft_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1,
  yaml TEXT NOT NULL,
  assets_json TEXT NOT NULL DEFAULT '[]',
  sdk_state_json TEXT NOT NULL DEFAULT '{"resources":[]}',
  proof_json TEXT
);`,
	},
	{
		id: "030_resource_draft_assets",
		run(db) {
			// 早期开发服务已应用过不含上传清单的 029；追加迁移，保留现有声明、state 和成功证明。
			const columns = db.prepare("PRAGMA table_info(kit_resource_draft_documents)").all() as { name: string }[];
			if (!columns.some((column) => column.name === "assets_json"))
				db.exec("ALTER TABLE kit_resource_draft_documents ADD COLUMN assets_json TEXT NOT NULL DEFAULT '[]'");
		},
	},

	{
		id: "031_retire_directory_drafts",
		run(db) {
			db.exec(
				"CREATE TABLE kit_retired_directory_drafts (draft_id TEXT PRIMARY KEY, record_json TEXT NOT NULL, document_json TEXT, retired_at TEXT NOT NULL)",
			);
			const rows = db.prepare("SELECT * FROM kit_resource_drafts WHERE engine != 'yaml'").all();
			const archive = db.prepare("INSERT INTO kit_retired_directory_drafts VALUES (?,?,?,?)");
			for (const row of rows) {
				const document = db
					.prepare("SELECT * FROM kit_resource_draft_documents WHERE draft_id=?")
					.get(String(row.draft_id));
				archive.run(
					String(row.draft_id),
					JSON.stringify(row),
					document ? JSON.stringify(document) : null,
					new Date().toISOString(),
				);
				db.prepare("DELETE FROM kit_resource_drafts WHERE draft_id=?").run(String(row.draft_id));
			}
		},
	},
	{
		id: "032_publication_result_contract",
		sql: `ALTER TABLE kit_operations ADD COLUMN publication_json TEXT;
ALTER TABLE kit_operations ADD COLUMN error_details_json TEXT;`,
	},
	{
		// 员工端品牌由管理端维护；单行表保证读取稳定，首次启动种入默认产品名。
		id: "029_branding",
		sql: `CREATE TABLE IF NOT EXISTS kit_branding (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  product_name TEXT NOT NULL,
  logo_url TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
INSERT OR IGNORE INTO kit_branding (id, product_name, updated_at) VALUES (1, 'OpenAgentPack Kit', '2026-11-13T00:00:00.000Z');`,
	},
	{
		// 上传的 Logo 存二进制与 contentType，公开读取走 /api/branding/logo；与外部 URL 二选一。
		id: "030_branding_logo",
		sql: `CREATE TABLE IF NOT EXISTS kit_branding_logo (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content_type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
	},
];

/**
 * SQLite（Node 内置 node:sqlite）+ 幂等迁移 + 版本表。见 docs/adr/0003。
 * 保存目录、运营索引、临时资源声明与 SDK state，以及成员密码派生值；绝不存事件正文与凭据明文。
 */
export function openDatabase(dataDir: string): DatabaseSync {
	const db = new DatabaseSyncCtor(join(dataDir, "kit.sqlite"));
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec(`CREATE TABLE IF NOT EXISTS _kit_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);`);
	const applied = new Set((db.prepare("SELECT id FROM _kit_migrations").all() as { id: string }[]).map((r) => r.id));
	for (const migration of MIGRATIONS) {
		if (applied.has(migration.id)) continue;
		db.exec("BEGIN");
		try {
			if (migration.run) migration.run(db);
			else db.exec(migration.sql!);
			db.prepare("INSERT INTO _kit_migrations (id, applied_at) VALUES (?, ?)").run(
				migration.id,
				new Date().toISOString(),
			);
			db.exec("COMMIT");
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
	}
	return db;
}
