import type { DatabaseSync } from "node:sqlite";
import { type CatalogAgentView, KitError } from "@openagentpack/kit-sdk/protocol";

export interface CatalogRow {
	id: string;
	slug: string;
	display_name: string;
	description: string | null;
	icon: string | null;
	opening_remarks: string | null;
	suggested_prompts: string;
	capabilities: string;
	theme: string | null;
	remote_agent_id: string;
	remote_agent_version: number | null;
	agent_version: number | null;
	remote_environment_id: string | null;
	files_json: string;
	memory_stores_json: string;
	vault_ids_json: string;
	visibility: string;
	ordering: number;
	category: string;
	featured: number;
	status: string;
	created_at: string;
	updated_at: string;
}

/**
 * 上架条目的可写入参：slug 是身份（创建后不改），status 只经 plan → 确认，
 * 其余展示字段全部可选（创建时给默认值，更新时只改传进来的）。
 */
export type CatalogEntryInput = {
	slug: string;
	display_name: string;
	remote_agent_id: string;
} & Partial<
	Omit<CatalogAgentView, "id" | "slug" | "status" | "created_at" | "updated_at" | "display_name" | "remote_agent_id">
>;

/** 去掉 undefined 键：避免 `{...current, ...patch}` 把已有值抹成 undefined。 */
function definedOnly<T extends object>(input: T): Partial<T> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) if (value !== undefined) out[key] = value;
	return out as Partial<T>;
}

/** 历史版本快照与显式运行绑定分别保存；数据库的 null 在读取时归一为未设置。 */
function agentVersionFields(input: { remote_agent_version?: number | null; agent_version?: number | null }) {
	return {
		...(input.remote_agent_version != null ? { remote_agent_version: input.remote_agent_version } : {}),
		...(input.agent_version != null ? { agent_version: input.agent_version } : {}),
	};
}

/** 新条目的默认值：未上架、public、排序 100、能力全开（体验页按 capabilities 决定显示什么）。 */
function newEntry(input: CatalogEntryInput): CatalogAgentView {
	const now = new Date().toISOString();
	return {
		id: `cat_${Math.random().toString(36).slice(2, 10)}`,
		slug: input.slug,
		display_name: input.display_name,
		remote_agent_id: input.remote_agent_id,
		remote_environment_id: input.remote_environment_id ?? null,
		files: input.files ?? [],
		memory_stores: input.memory_stores ?? [],
		vault_ids: input.vault_ids ?? [],
		...(input.description ? { description: input.description } : {}),
		...(input.icon ? { icon: input.icon } : {}),
		...(input.opening_remarks ? { opening_remarks: input.opening_remarks } : {}),
		suggested_prompts: input.suggested_prompts ?? [],
		capabilities: input.capabilities ?? {
			streaming: true,
			fileUpload: true,
			artifacts: true,
			threads: true,
			reasoning: true,
		},
		...(input.theme ? { theme: input.theme } : {}),
		...agentVersionFields(input),
		visibility: input.visibility ?? "public",
		ordering: input.ordering ?? 100,
		category: input.category ?? "general",
		featured: input.featured ?? false,
		status: "unlisted",
		created_at: now,
		updated_at: now,
	};
}

function toView(row: CatalogRow): CatalogAgentView {
	return {
		id: row.id,
		slug: row.slug,
		display_name: row.display_name,
		...(row.description ? { description: row.description } : {}),
		...(row.icon ? { icon: row.icon } : {}),
		...(row.opening_remarks ? { opening_remarks: row.opening_remarks } : {}),
		suggested_prompts: JSON.parse(row.suggested_prompts) as string[],
		capabilities: JSON.parse(row.capabilities) as CatalogAgentView["capabilities"],
		...(row.theme ? { theme: JSON.parse(row.theme) } : {}),
		remote_agent_id: row.remote_agent_id,
		remote_environment_id: row.remote_environment_id,
		files: JSON.parse(row.files_json) as CatalogAgentView["files"],
		memory_stores: JSON.parse(row.memory_stores_json) as CatalogAgentView["memory_stores"],
		vault_ids: JSON.parse(row.vault_ids_json) as CatalogAgentView["vault_ids"],
		...agentVersionFields(row),
		visibility: row.visibility as CatalogAgentView["visibility"],
		ordering: row.ordering,
		category: row.category as CatalogAgentView["category"],
		featured: row.featured === 1,
		status: row.status as CatalogAgentView["status"],
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

export function createCatalogStore(db: DatabaseSync) {
	return {
		list(): CatalogAgentView[] {
			const rows = db
				.prepare("SELECT * FROM catalog_agents ORDER BY ordering ASC, created_at ASC")
				.all() as unknown as CatalogRow[];
			return rows.map(toView);
		},
		listed(): CatalogAgentView[] {
			const rows = db
				.prepare("SELECT * FROM catalog_agents WHERE status = 'listed' ORDER BY ordering ASC, created_at ASC")
				.all() as unknown as CatalogRow[];
			return rows.map(toView);
		},
		get(id: string): CatalogAgentView | null {
			const row = db.prepare("SELECT * FROM catalog_agents WHERE id = ?").get(id) as unknown as CatalogRow | undefined;
			return row ? toView(row) : null;
		},
		getBySlug(slug: string): CatalogAgentView | null {
			const row = db.prepare("SELECT * FROM catalog_agents WHERE slug = ?").get(slug) as unknown as
				| CatalogRow
				| undefined;
			return row ? toView(row) : null;
		},
		insert(view: CatalogAgentView) {
			const { files = [], memory_stores = [], vault_ids = [], agent_version = null } = view;
			const inserted = db
				.prepare(
					`INSERT INTO catalog_agents (id, slug, display_name, description, icon, opening_remarks, suggested_prompts,
				 capabilities, theme, remote_agent_id, remote_agent_version, agent_version, remote_environment_id, files_json, memory_stores_json, vault_ids_json, visibility, ordering, category, featured, status, created_at, updated_at, listed_at)
					 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='listed' THEN ? ELSE NULL END
					 WHERE NOT EXISTS (SELECT 1 FROM catalog_agents WHERE display_name = ?)
					 ON CONFLICT(slug) DO NOTHING`,
				)
				.run(
					view.id,
					view.slug,
					view.display_name,
					view.description ?? null,
					view.icon ?? null,
					view.opening_remarks ?? null,
					JSON.stringify(view.suggested_prompts ?? []),
					JSON.stringify(view.capabilities),
					view.theme ? JSON.stringify(view.theme) : null,
					view.remote_agent_id,
					view.remote_agent_version ?? null,
					agent_version,
					view.remote_environment_id ?? null,
					JSON.stringify(files),
					JSON.stringify(memory_stores),
					JSON.stringify(vault_ids),
					view.visibility,
					view.ordering,
					view.category,
					view.featured ? 1 : 0,
					view.status,
					view.created_at,
					view.updated_at,
					view.status,
					new Date().toISOString(),
					view.display_name,
				);
			if (!inserted.changes) {
				throw new KitError(
					"conflict",
					this.getBySlug(view.slug) ? "ID 已存在，请使用其他 ID" : "展示名已存在，请使用其他展示名",
				);
			}
		},
		update(id: string, patch: Partial<CatalogAgentView>) {
			const current = this.get(id);
			if (!current) return null;
			const next: CatalogAgentView = { ...current, ...patch, id, updated_at: new Date().toISOString() };
			const { remote_environment_id: environmentId = null } = next;
			const { files = [], memory_stores = [], vault_ids = [], agent_version = null } = next;
			// 历史同名条目可保留原名修改其他信息；新增名称冲突在同一写语句内拒绝。
			const updated = db
				.prepare(
					`UPDATE catalog_agents SET slug=?, display_name=?, description=?, icon=?, opening_remarks=?, suggested_prompts=?,
				 capabilities=?, theme=?, remote_agent_id=?, remote_agent_version=?, agent_version=?, remote_environment_id=?, files_json=?, memory_stores_json=?, vault_ids_json=?, visibility=?, ordering=?, category=?, featured=?, status=?, updated_at=?,
				 listed_at=CASE WHEN status<>'listed' AND ?='listed' THEN ? ELSE listed_at END
				 WHERE id=? AND (display_name=? OR NOT EXISTS (
				   SELECT 1 FROM catalog_agents WHERE display_name=? AND id<>?
				 ))`,
				)
				.run(
					next.slug,
					next.display_name,
					next.description ?? null,
					next.icon ?? null,
					next.opening_remarks ?? null,
					JSON.stringify(next.suggested_prompts ?? []),
					JSON.stringify(next.capabilities),
					next.theme ? JSON.stringify(next.theme) : null,
					next.remote_agent_id,
					next.remote_agent_version ?? null,
					agent_version,
					environmentId,
					JSON.stringify(files),
					JSON.stringify(memory_stores),
					JSON.stringify(vault_ids),
					next.visibility,
					next.ordering,
					next.category,
					next.featured ? 1 : 0,
					next.status,
					next.updated_at,
					next.status,
					next.updated_at,
					id,
					next.display_name,
					next.display_name,
					id,
				);
			if (updated.changes) return next;
			if (!this.get(id)) return null;
			throw new KitError("conflict", "展示名已存在，请使用其他展示名");
		},
		all(): CatalogAgentView[] {
			return this.list();
		},
		/** 仅创建新条目；数据库写入原子拒绝重复 ID 或展示名，不覆盖已有条目。 */
		create(input: CatalogEntryInput): CatalogAgentView {
			const view = newEntry(input);
			this.insert(view);
			return view;
		},
		/**
		 * 创建条目，或按 slug 更新已存在条目的展示信息。
		 * **status 不在这里改**：上/下架必须走 plan → 确认令牌（AGENTS.md 红线）。
		 */
		upsert(input: CatalogEntryInput) {
			const { slug, ...display } = input;
			const existing = this.getBySlug(slug);
			if (existing) return this.update(existing.id, definedOnly(display)) as CatalogAgentView;
			return this.create(input);
		},
		/** 按 slug 改展示信息（PUT /api/admin/agents/:slug）；不存在返回 null。 */
		updateBySlug(slug: string, patch: Partial<Omit<CatalogEntryInput, "slug">>): CatalogAgentView | null {
			const existing = this.getBySlug(slug);
			if (!existing) return null;
			return this.update(existing.id, definedOnly(patch));
		},
		setStatus(slug: string, status: "listed" | "unlisted") {
			const existing = this.getBySlug(slug);
			if (!existing) return null;
			return this.update(existing.id, { status });
		},
		remove(id: string): boolean {
			const result = db.prepare("DELETE FROM catalog_agents WHERE id = ?").run(id);
			return result.changes > 0;
		},
	};
}
export type CatalogStore = ReturnType<typeof createCatalogStore>;
