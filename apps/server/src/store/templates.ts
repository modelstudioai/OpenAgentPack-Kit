import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
	type CatalogAgentView,
	KitError,
	type TemplatesPage,
	type TemplatesQuery,
	TemplateVersionSummarySchema,
	type TemplateVersionsPage,
	type TemplateVersionsQuery,
	type TemplateVersionView,
	TemplateVersionViewSchema,
	type TemplateView,
	TemplateViewSchema,
} from "@openagentpack/kit-sdk/protocol";

export type TemplateRecord = Omit<TemplateView, "template_id" | "created_at" | "updated_at" | "version" | "listing">;
interface TemplateRow {
	template_id: string;
	name: string;
	config_json: string;
	created_at: string;
	updated_at: string;
	version: number;
	catalog_id: string | null;
	catalog_slug: string | null;
	catalog_display_name: string | null;
	catalog_status: string | null;
	catalog_listed_at: string | null;
}
const TEMPLATE_SELECT = `SELECT t.*, c.id AS catalog_id, c.slug AS catalog_slug,
	c.display_name AS catalog_display_name, c.status AS catalog_status, c.listed_at AS catalog_listed_at
	FROM kit_templates t LEFT JOIN kit_template_listings l ON l.template_id=t.template_id
	LEFT JOIN catalog_agents c ON c.id=l.catalog_id`;
interface Cursor {
	id: string;
	created_at: string;
	search: string;
	status?: TemplatesQuery["status"];
	category?: TemplatesQuery["category"];
}
interface TemplateVersionRow {
	template_id: string;
	version: number;
	config_json: string;
	created_at: string;
}

function versionCursor(token: string | undefined, templateId: string): number | undefined {
	if (!token) return undefined;
	try {
		if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new Error("invalid cursor encoding");
		const value: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
		if (
			value &&
			typeof value === "object" &&
			"template_id" in value &&
			value.template_id === templateId &&
			"before" in value &&
			typeof value.before === "number" &&
			Number.isSafeInteger(value.before) &&
			value.before > 0
		)
			return value.before;
	} catch {
		/* 游标只用于当前模版的历史分页，不回显原始内容。 */
	}
	throw new KitError("invalid_request", "版本分页游标无效或不属于当前模版，请重新查询");
}

function cursorFor(
	token: string | undefined,
	search: string,
	status: TemplatesQuery["status"],
	category: TemplatesQuery["category"],
): Cursor | undefined {
	if (!token) return undefined;
	try {
		const value: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
		if (
			value &&
			typeof value === "object" &&
			"search" in value &&
			value.search === search &&
			("status" in value ? value.status === status : status === undefined) &&
			("category" in value ? value.category === category : category === undefined) &&
			"id" in value &&
			typeof value.id === "string" &&
			/^template_[0-9a-f-]{36}$/.test(value.id) &&
			"created_at" in value &&
			typeof value.created_at === "string" &&
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.created_at)
		) {
			return { id: value.id, created_at: value.created_at, search, status, category };
		}
	} catch {
		/* 不回显不可信游标。 */
	}
	throw new KitError("invalid_request", "分页游标无效或与当前查询不匹配，请重新查询");
}

function asTemplate(row: TemplateRow): TemplateView {
	return TemplateViewSchema.parse({
		...JSON.parse(row.config_json),
		template_id: row.template_id,
		name: row.name,
		created_at: row.created_at,
		updated_at: row.updated_at,
		version: row.version,
		...(row.catalog_id
			? {
					listing: {
						catalog_id: row.catalog_id,
						slug: row.catalog_slug,
						display_name: row.catalog_display_name,
						status: row.catalog_status,
						...(row.catalog_listed_at ? { listed_at: row.catalog_listed_at } : {}),
					},
				}
			: {}),
	});
}

/** 模版只保存管理员选择的资源引用和展示配置，不保存事件正文或 Provider 凭据。 */
export function createTemplateStore(db: DatabaseSync) {
	function transaction<T>(work: () => T): T {
		db.exec("BEGIN IMMEDIATE");
		try {
			const result = work();
			db.exec("COMMIT");
			return result;
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
	}
	function appendVersion(templateId: string, version: number, input: TemplateRecord, createdAt: string) {
		db.prepare(`INSERT INTO kit_template_versions (template_id,version,config_json,created_at)
			VALUES (?,?,?,?)`).run(templateId, version, JSON.stringify(input), createdAt);
	}
	function get(templateId: string): TemplateView {
		const row = db.prepare(`${TEMPLATE_SELECT} WHERE t.template_id=?`).get(templateId) as TemplateRow | undefined;
		if (!row) throw new KitError("not_found", "模版不存在");
		return asTemplate(row);
	}
	function currentVersion(templateId: string): number {
		const row = db.prepare("SELECT version FROM kit_templates WHERE template_id=?").get(templateId) as
			| { version: number }
			| undefined;
		if (!row) throw new KitError("not_found", "模版不存在");
		return row.version;
	}
	return {
		get,
		versions(templateId: string, query: TemplateVersionsQuery): TemplateVersionsPage {
			const version = currentVersion(templateId);
			const before = versionCursor(query.page_token, templateId);
			const rows = db
				.prepare(`SELECT template_id,version,config_json,created_at FROM kit_template_versions
					WHERE template_id=? ${before !== undefined ? "AND version < ?" : ""} ORDER BY version DESC LIMIT ?`)
				.all(templateId, ...(before !== undefined ? [before] : []), query.limit + 1) as unknown as TemplateVersionRow[];
			const data = rows.slice(0, query.limit).map((row) =>
				TemplateVersionSummarySchema.strip().parse({
					...JSON.parse(row.config_json),
					version: row.version,
					created_at: row.created_at,
				}),
			);
			const last = data.at(-1);
			return {
				data,
				current_version: version,
				...(rows.length > query.limit && last
					? {
							next_page_token: Buffer.from(JSON.stringify({ template_id: templateId, before: last.version })).toString(
								"base64url",
							),
						}
					: {}),
			};
		},
		version(templateId: string, version: number): TemplateVersionView {
			currentVersion(templateId);
			const row = db
				.prepare(
					"SELECT template_id,version,config_json,created_at FROM kit_template_versions WHERE template_id=? AND version=?",
				)
				.get(templateId, version) as unknown as TemplateVersionRow | undefined;
			if (!row) throw new KitError("not_found", "模版版本不存在");
			return TemplateVersionViewSchema.parse({
				...JSON.parse(row.config_json),
				template_id: row.template_id,
				version: row.version,
				created_at: row.created_at,
			});
		},
		/** 删除前在同一事务重新检查计划；显式清理子表，不依赖部署的外键开关。 */
		remove(templateId: string, beforeDelete: (template: TemplateView) => void): void {
			transaction(() => {
				beforeDelete(get(templateId));
				db.prepare("DELETE FROM kit_template_versions WHERE template_id=?").run(templateId);
				db.prepare("DELETE FROM kit_template_listings WHERE template_id=?").run(templateId);
				const removed = db.prepare("DELETE FROM kit_templates WHERE template_id=?").run(templateId);
				if (!removed.changes) throw new KitError("conflict", "模版已变更，请重试并再次确认删除");
			});
		},
		/** 确认后的目录写入与来源关联一起提交；回调中必须同步重读并校验计划快照。 */
		saveListing(templateId: string, commit: () => CatalogAgentView): CatalogAgentView {
			return transaction(() => {
				get(templateId);
				const entry = commit();
				db.prepare(`INSERT INTO kit_template_listings (template_id, catalog_id) VALUES (?, ?)
					ON CONFLICT(template_id) DO UPDATE SET catalog_id=excluded.catalog_id`).run(templateId, entry.id);
				return entry;
			});
		},
		create(input: TemplateRecord): TemplateView {
			return transaction(() => {
				const id = `template_${randomUUID()}`;
				const now = new Date().toISOString();
				const result = db
					.prepare(`INSERT INTO kit_templates
					(template_id,name,remote_agent_id,remote_agent_name,config_json,created_at,updated_at,version)
					VALUES (?,?,?,?,?,?,?,1) ON CONFLICT(name) DO NOTHING`)
					.run(id, input.name, input.remote_agent_id, input.remote_agent_name, JSON.stringify(input), now, now);
				if (!result.changes) throw new KitError("conflict", "模版名称已存在，请使用其他名称");
				appendVersion(id, 1, input, now);
				return get(id);
			});
		},
		/** 历史只追加；当前配置、版本和关联目录同步必须在同一事务提交。 */
		update(
			templateId: string,
			baseVersion: number,
			input: TemplateRecord,
			syncCatalog: (template: TemplateView) => void,
		): TemplateView {
			return transaction(() => {
				const current = get(templateId);
				if (current.version !== baseVersion) throw new KitError("conflict", "模版已有新版本，请刷新后重新编辑");
				const version = current.version + 1;
				const now = new Date().toISOString();
				const updated = db
					.prepare(`UPDATE kit_templates
					SET name=?,remote_agent_id=?,remote_agent_name=?,config_json=?,updated_at=?,version=?
					WHERE template_id=? AND version=? AND NOT EXISTS (
						SELECT 1 FROM kit_templates WHERE name=? AND template_id<>?
					)`)
					.run(
						input.name,
						input.remote_agent_id,
						input.remote_agent_name,
						JSON.stringify(input),
						now,
						version,
						templateId,
						baseVersion,
						input.name,
						templateId,
					);
				if (!updated.changes) throw new KitError("conflict", "模版名称已存在，请使用其他名称");
				appendVersion(templateId, version, input, now);
				syncCatalog(get(templateId));
				return get(templateId);
			});
		},
		list(query: TemplatesQuery): TemplatesPage {
			const search = (query.search ?? "").toLowerCase();
			const cursor = cursorFor(query.page_token, search, query.status, query.category);
			const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
			const rows = db
				.prepare(`${TEMPLATE_SELECT}
				WHERE (t.name LIKE ? ESCAPE '\\' OR t.remote_agent_id LIKE ? ESCAPE '\\' OR t.remote_agent_name LIKE ? ESCAPE '\\')
				${query.status ? "AND COALESCE(c.status, 'unlisted') = ?" : ""}
				${query.category ? "AND COALESCE(json_extract(t.config_json, '$.category'), 'general') = ?" : ""}
				${cursor ? "AND (t.created_at < ? OR (t.created_at=? AND t.template_id<?))" : ""}
				ORDER BY t.created_at DESC, t.template_id DESC LIMIT ?`)
				.all(
					pattern,
					pattern,
					pattern,
					...[query.status, query.category].filter((value) => value !== undefined),
					...(cursor ? [cursor.created_at, cursor.created_at, cursor.id] : []),
					query.limit + 1,
				) as unknown as TemplateRow[];
			const data = rows.slice(0, query.limit).map(asTemplate);
			const last = data.at(-1);
			return {
				data,
				...(rows.length > query.limit && last
					? {
							next_page_token: Buffer.from(
								JSON.stringify({
									id: last.template_id,
									created_at: last.created_at,
									search,
									status: query.status,
									category: query.category,
								}),
							).toString("base64url"),
						}
					: {}),
			};
		},
	};
}
export type TemplateStore = ReturnType<typeof createTemplateStore>;
