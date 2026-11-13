import type { DatabaseSync } from "node:sqlite";
import {
	KitError,
	type MemberSessionsPage,
	type MemberSessionsQuery,
	type MemberSessionUsage,
	type MemberUsageSummary,
	SESSION_USAGE_METRICS,
	type SessionStats,
	type SessionUsage,
	type TemplateSessionUsage,
} from "@openagentpack/kit-sdk/protocol";

type SnapshotValues = SessionUsage & SessionStats;
type Row = Omit<MemberSessionUsage, "usage" | "stats" | "title" | "status" | "captured_at" | "deleted_at"> & {
	title: string | null;
	status: string | null;
	captured_at: string | null;
	deleted_at: string | null;
	finalized_at: string | null;
	attempted_at: string | null;
	capture_revision: number;
} & Record<(typeof SESSION_USAGE_METRICS)[number], number | null>;

function view(row: Row): MemberSessionUsage {
	const usage: SessionUsage = {};
	const stats: SessionStats = {};
	for (const key of SESSION_USAGE_METRICS) {
		const value = row[key];
		if (value === null) continue;
		if (key === "active_seconds" || key === "duration_seconds") stats[key] = value;
		else usage[key] = value;
	}
	return {
		session_id: row.session_id,
		member_id: row.member_id,
		agent_slug: row.agent_slug,
		created_at: row.created_at,
		collection_status: row.collection_status,
		...(row.title !== null ? { title: row.title } : {}),
		...(row.status !== null ? { status: row.status } : {}),
		...(row.captured_at ? { captured_at: row.captured_at } : {}),
		...(row.deleted_at ? { deleted_at: row.deleted_at } : {}),
		...(Object.keys(usage).length ? { usage } : {}),
		...(Object.keys(stats).length ? { stats } : {}),
	};
}

function readCursor(token: string | undefined, memberId: string, agentSlug?: string) {
	if (!token) return undefined;
	try {
		const value = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
		if (
			value.member_id === memberId &&
			value.agent_slug === (agentSlug ?? null) &&
			typeof value.created_at === "string" &&
			typeof value.session_id === "string"
		) {
			return value as { created_at: string; session_id: string };
		}
	} catch {
		/* 不回显不可信游标。 */
	}
	throw new KitError("invalid_request", "会话用量游标无效或与筛选条件不匹配，请重新查询");
}

function refreshStatus(
	counts: { failed: number; captured: number; incomplete: number },
	refreshing: boolean,
): MemberUsageSummary["refresh_status"] {
	if (refreshing) return "refreshing";
	if (counts.failed && !counts.captured) return "failed";
	return counts.incomplete ? "partial" : "idle";
}

function metricSummary(totals: Record<string, number | null>, sessionCount: number): MemberUsageSummary["metrics"] {
	return Object.fromEntries(
		SESSION_USAGE_METRICS.map((key) => [
			key,
			{
				value: sessionCount === 0 ? 0 : (totals[key] ?? null),
				covered_sessions: totals[`${key}_count`] ?? 0,
			},
		]),
	) as MemberUsageSummary["metrics"];
}

/** 仅保留成员会话累计数值；Provider 事件、消息和附件不进入本表。 */
export function createSessionUsageStore(db: DatabaseSync) {
	function get(sessionId: string) {
		return db.prepare("SELECT * FROM kit_session_usage WHERE session_id = ?").get(sessionId) as Row | undefined;
	}
	function syncMember(memberId: string) {
		db.prepare(`INSERT INTO kit_session_usage (session_id, member_id, agent_slug, title, status, created_at)
			SELECT s.session_id, s.subject_id, s.agent_slug, s.title, s.status, s.created_at
			FROM kit_sessions s JOIN kit_members m ON m.member_id = s.subject_id
			WHERE s.purpose = 'experience' AND m.member_id = ?
			ON CONFLICT(session_id) DO UPDATE SET title = excluded.title
			WHERE kit_session_usage.deleted_at IS NULL AND kit_session_usage.finalized_at IS NULL`).run(memberId);
	}
	/** 登记全部成员的体验会话并返回涉及成员，供调用方调度后台采集。 */
	function syncAll(): string[] {
		db.prepare(`INSERT INTO kit_session_usage (session_id, member_id, agent_slug, title, status, created_at)
			SELECT s.session_id, s.subject_id, s.agent_slug, s.title, s.status, s.created_at
			FROM kit_sessions s JOIN kit_members m ON m.member_id = s.subject_id
			WHERE s.purpose = 'experience'
			ON CONFLICT(session_id) DO UPDATE SET title = excluded.title
			WHERE kit_session_usage.deleted_at IS NULL AND kit_session_usage.finalized_at IS NULL`).run();
		return (
			db
				.prepare(`SELECT DISTINCT u.member_id FROM kit_session_usage u
			JOIN kit_members m ON m.member_id = u.member_id`)
				.all() as { member_id: string }[]
		).map((row) => row.member_id);
	}
	function writeSnapshot(sessionId: string, values: SnapshotValues, status: string, revision: number, final: boolean) {
		const complete = SESSION_USAGE_METRICS.every((key) => values[key] !== undefined);
		const now = new Date().toISOString();
		return (
			db
				.prepare(`UPDATE kit_session_usage SET
			${SESSION_USAGE_METRICS.map((key) => `${key} = ?`).join(", ")},
			status = ?, collection_status = ?, captured_at = ?, attempted_at = ?, finalized_at = ?
			WHERE session_id = ? AND capture_revision = ? AND deleted_at IS NULL AND finalized_at IS NULL`)
				.run(
					...SESSION_USAGE_METRICS.map((key) => values[key] ?? null),
					status,
					complete ? "complete" : "partial",
					now,
					now,
					final ? now : null,
					sessionId,
					revision,
				).changes > 0
		);
	}
	return {
		syncMember,
		syncAll,
		/** 以模版为主键聚合：只统计从该模版上架条目发起的体验会话；未产生会话的模版也返回；search 按模版名/智能体名/模版 ID 过滤。 */
		summaryByTemplate(search = "") {
			const pattern = `%${search.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
			const filter = search
				? `WHERE (t.name LIKE ? ESCAPE '\\' OR t.remote_agent_name LIKE ? ESCAPE '\\' OR t.template_id LIKE ? ESCAPE '\\')`
				: "";
			const rows = db
				.prepare(`SELECT t.template_id, t.name, t.remote_agent_id, t.remote_agent_name,
				CASE WHEN c.status = 'listed' THEN 'listed' ELSE 'unlisted' END AS listing_status,
				COUNT(u.session_id) AS total, COUNT(u.deleted_at) AS deleted, MAX(u.captured_at) AS refreshed,
				${SESSION_USAGE_METRICS.map((key) => `SUM(u.${key}) AS ${key}, COUNT(u.${key}) AS ${key}_count`).join(",")}
				FROM kit_templates t
				LEFT JOIN kit_template_listings l ON l.template_id = t.template_id
				LEFT JOIN catalog_agents c ON c.id = l.catalog_id
				LEFT JOIN kit_session_usage u ON u.agent_slug = c.slug
				${filter}
				GROUP BY t.template_id ORDER BY t.created_at, t.template_id`)
				.all(...(search ? [pattern, pattern, pattern] : [])) as (Record<string, number | null> & {
				template_id: string;
				name: string;
				remote_agent_id: string;
				remote_agent_name: string;
				listing_status: "listed" | "unlisted";
				total: number;
				deleted: number;
				refreshed: string | null;
			})[];
			return rows.map((row) => ({
				template_id: row.template_id,
				name: row.name,
				remote_agent_id: row.remote_agent_id,
				remote_agent_name: row.remote_agent_name,
				listing_status: row.listing_status,
				session_count: row.total,
				deleted_session_count: row.deleted,
				...(row.refreshed ? { refreshed_at: row.refreshed } : {}),
				metrics: metricSummary(row, row.total),
			}));
		},
		/** mock 遥测数据源：只统计从模版上架条目发起的体验会话（与模版汇总的口径 B 一致），
		 *  聚合键为模版绑定的 remote_agent_id；手动创建条目的会话不计入，避免「未上架模版也有调用」。 */
		telemetryByAgent() {
			const rows = db
				.prepare(`SELECT t.remote_agent_id AS agent_key, COUNT(*) AS sessions,
				COALESCE(SUM(u.input_tokens), 0) AS input_tokens, COALESCE(SUM(u.output_tokens), 0) AS output_tokens,
				COALESCE(SUM(u.cache_read_input_tokens), 0) AS cache_read_tokens,
				COALESCE(SUM(u.cache_creation_input_tokens), 0) AS cache_creation_tokens
				FROM kit_session_usage u
				JOIN catalog_agents c ON c.slug = u.agent_slug
				JOIN kit_template_listings l ON l.catalog_id = c.id
				JOIN kit_templates t ON t.template_id = l.template_id
				GROUP BY t.remote_agent_id`)
				.all() as {
				agent_key: string;
				sessions: number;
				input_tokens: number;
				output_tokens: number;
				cache_read_tokens: number;
				cache_creation_tokens: number;
			}[];
			return new Map(rows.map((row) => [row.agent_key, row]));
		},
		/** mock 遥测数据源：单会话口径；无账本行返回 null。 */
		telemetryBySession(sessionId: string) {
			const row = db
				.prepare(`SELECT COUNT(*) AS sessions,
				COALESCE(SUM(u.input_tokens), 0) AS input_tokens, COALESCE(SUM(u.output_tokens), 0) AS output_tokens,
				COALESCE(SUM(u.cache_read_input_tokens), 0) AS cache_read_tokens,
				COALESCE(SUM(u.cache_creation_input_tokens), 0) AS cache_creation_tokens
				FROM kit_session_usage u WHERE u.session_id = ?`)
				.get(sessionId) as
				| {
						sessions: number;
						input_tokens: number;
						output_tokens: number;
						cache_read_tokens: number;
						cache_creation_tokens: number;
				  }
				| undefined;
			return row?.sessions ? row : null;
		},
		isMemberSession(sessionId: string) {
			return Boolean(
				db
					.prepare(`SELECT 1 FROM kit_sessions s JOIN kit_members m ON m.member_id = s.subject_id
				WHERE s.session_id = ? AND s.purpose = 'experience'`)
					.get(sessionId),
			);
		},
		get,
		hasPending(memberId: string) {
			return Boolean(
				db
					.prepare(`SELECT 1 FROM kit_session_usage u JOIN kit_sessions s ON s.session_id = u.session_id
				WHERE u.member_id = ? AND s.subject_id = ? AND s.purpose = 'experience'
				AND u.collection_status = 'pending' AND u.finalized_at IS NULL AND u.deleted_at IS NULL LIMIT 1`)
					.get(memberId, memberId),
			);
		},
		/** 每批固定上限但游标遍历全量，不能复用会话列表的 50/100 条默认上限。 */
		captureCandidates(memberId: string, after = "", limit = 100): string[] {
			return (
				db
					.prepare(`SELECT u.session_id FROM kit_session_usage u JOIN kit_sessions s ON s.session_id = u.session_id
				WHERE u.member_id = ? AND s.subject_id = ? AND s.purpose = 'experience'
				AND u.deleted_at IS NULL AND u.finalized_at IS NULL AND u.session_id > ?
				ORDER BY u.session_id LIMIT ?`)
					.all(memberId, memberId, after, limit) as { session_id: string }[]
			).map((row) => row.session_id);
		},
		beginCapture(sessionId: string): number | null {
			const row = db
				.prepare(`UPDATE kit_session_usage SET capture_revision = capture_revision + 1
				WHERE session_id = ? AND deleted_at IS NULL AND finalized_at IS NULL RETURNING capture_revision`)
				.get(sessionId) as { capture_revision: number } | undefined;
			return row?.capture_revision ?? null;
		},
		save(sessionId: string, values: SnapshotValues, status: string, revision: number) {
			return writeSnapshot(sessionId, values, status, revision, false);
		},
		fail(sessionId: string, revision: number, status: "failed" | "not_found") {
			db.prepare(`UPDATE kit_session_usage SET collection_status = ?, attempted_at = ?
				WHERE session_id = ? AND capture_revision = ? AND finalized_at IS NULL AND deleted_at IS NULL`).run(
				status,
				new Date().toISOString(),
				sessionId,
				revision,
			);
		},
		/** 同步事务返回即已提交；递增版本使之前开始的后台查询失效。 */
		finalize(sessionId: string, values: SnapshotValues, status: string) {
			db.exec("BEGIN IMMEDIATE");
			try {
				const existing = get(sessionId);
				if (!existing || existing.deleted_at) throw new KitError("conflict", "会话用量记录不可用，请重试");
				db.prepare(
					"UPDATE kit_session_usage SET finalized_at = NULL, capture_revision = capture_revision + 1 WHERE session_id = ?",
				).run(sessionId);
				if (!writeSnapshot(sessionId, values, status, existing.capture_revision + 1, true)) {
					throw new KitError("conflict", "会话用量快照未保存，请重试");
				}
				db.exec("COMMIT");
			} catch (error) {
				db.exec("ROLLBACK");
				throw error;
			}
		},
		releaseFinal(sessionId: string) {
			db.prepare("UPDATE kit_session_usage SET finalized_at = NULL WHERE session_id = ? AND deleted_at IS NULL").run(
				sessionId,
			);
		},
		markDeleted(sessionId: string) {
			db.exec("BEGIN IMMEDIATE");
			try {
				const row = get(sessionId);
				if (!row?.finalized_at) throw new KitError("conflict", "必须先成功保存最终用量快照");
				db.prepare(
					"UPDATE kit_session_usage SET deleted_at = COALESCE(deleted_at, ?), status = 'deleted' WHERE session_id = ?",
				).run(new Date().toISOString(), sessionId);
				db.prepare("DELETE FROM kit_sessions WHERE session_id = ?").run(sessionId);
				db.prepare("UPDATE kit_session_deletions SET stage = 'deleted', updated_at = ? WHERE session_id = ?").run(
					new Date().toISOString(),
					sessionId,
				);
				db.exec("COMMIT");
			} catch (error) {
				db.exec("ROLLBACK");
				throw error;
			}
		},
		summary(memberId: string, agentSlug?: string, refreshStartedAt?: string): MemberUsageSummary {
			const filter = `member_id = ?${agentSlug ? " AND agent_slug = ?" : ""}`;
			const params = agentSlug ? [memberId, agentSlug] : [memberId];
			const counts = db
				.prepare(`SELECT COUNT(*) AS total, COUNT(deleted_at) AS deleted,
				SUM(CASE WHEN collection_status IN ('failed','not_found') THEN 1 ELSE 0 END) AS failed,
				SUM(CASE WHEN collection_status <> 'complete' THEN 1 ELSE 0 END) AS incomplete,
				COUNT(captured_at) AS captured, MAX(captured_at) AS refreshed,
				SUM(CASE WHEN attempted_at IS NOT NULL ${refreshStartedAt ? "AND (attempted_at >= ? OR finalized_at IS NOT NULL)" : ""} THEN 1 ELSE 0 END) AS completed
				FROM kit_session_usage WHERE ${filter}`)
				.get(...(refreshStartedAt ? [refreshStartedAt, ...params] : params)) as {
				total: number;
				deleted: number;
				failed: number;
				incomplete: number;
				captured: number;
				refreshed: string | null;
				completed: number | null;
			};
			const totals = db
				.prepare(`SELECT ${SESSION_USAGE_METRICS.map((key) => `SUM(${key}) AS ${key}, COUNT(${key}) AS ${key}_count`).join(",")}
				FROM kit_session_usage WHERE ${filter}`)
				.get(...params) as Record<string, number | null>;
			const metrics = metricSummary(totals, counts.total);
			const agents = (
				db
					.prepare("SELECT DISTINCT agent_slug FROM kit_session_usage WHERE member_id = ? ORDER BY agent_slug")
					.all(memberId) as { agent_slug: string }[]
			).map((row) => row.agent_slug);
			return {
				session_count: counts.total,
				deleted_session_count: counts.deleted,
				metrics,
				agents,
				...(counts.refreshed ? { refreshed_at: counts.refreshed } : {}),
				completed_sessions: counts.completed ?? 0,
				refresh_status: refreshStatus(counts, Boolean(refreshStartedAt)),
			};
		},
		list(memberId: string, options: MemberSessionsQuery): MemberSessionsPage {
			const cursor = readCursor(options.cursor, memberId, options.agent_slug);
			const rows = db
				.prepare(`SELECT * FROM kit_session_usage WHERE member_id = ?
				${options.agent_slug ? "AND agent_slug = ?" : ""}
				${cursor ? "AND (created_at < ? OR (created_at = ? AND session_id < ?))" : ""}
				ORDER BY created_at DESC, session_id DESC LIMIT ?`)
				.all(
					memberId,
					...(options.agent_slug ? [options.agent_slug] : []),
					...(cursor ? [cursor.created_at, cursor.created_at, cursor.session_id] : []),
					options.limit + 1,
				) as Row[];
			const data = rows.slice(0, options.limit).map(view);
			const last = data.at(-1);
			return {
				data,
				...(last && rows.length > options.limit
					? {
							next_cursor: Buffer.from(
								JSON.stringify({
									member_id: memberId,
									agent_slug: options.agent_slug ?? null,
									session_id: last.session_id,
									created_at: last.created_at,
								}),
							).toString("base64url"),
						}
					: {}),
			};
		},
		/** 模版维度的会话明细：跨成员取该模版上架条目的用量行，附带成员公开资料。 */
		listByTemplate(
			templateId: string,
			options: { cursor?: string; limit: number },
		): { data: TemplateSessionUsage[]; next_cursor?: string } {
			let cursor: { created_at: string; session_id: string } | undefined;
			if (options.cursor) {
				try {
					const value = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8"));
					if (
						value.template_id === templateId &&
						typeof value.created_at === "string" &&
						typeof value.session_id === "string"
					) {
						cursor = value;
					} else {
						throw new Error("mismatch");
					}
				} catch {
					throw new KitError("invalid_request", "会话用量游标无效或与筛选条件不匹配，请重新查询");
				}
			}
			const rows = db
				.prepare(`SELECT u.*, m.display_name AS member_display_name, m.username AS member_username
				FROM kit_template_listings l
				JOIN catalog_agents c ON c.id = l.catalog_id
				JOIN kit_session_usage u ON u.agent_slug = c.slug
				JOIN kit_members m ON m.member_id = u.member_id
				WHERE l.template_id = ?
				${cursor ? "AND (u.created_at < ? OR (u.created_at = ? AND u.session_id < ?))" : ""}
				ORDER BY u.created_at DESC, u.session_id DESC LIMIT ?`)
				.all(
					templateId,
					...(cursor ? [cursor.created_at, cursor.created_at, cursor.session_id] : []),
					options.limit + 1,
				) as unknown as (Row & { member_display_name: string; member_username: string })[];
			const data = rows.slice(0, options.limit).map((row) => ({
				...view(row),
				member_display_name: row.member_display_name,
				member_username: row.member_username,
			}));
			const last = data.at(-1);
			return {
				data,
				...(last && rows.length > options.limit
					? {
							next_cursor: Buffer.from(
								JSON.stringify({
									template_id: templateId,
									session_id: last.session_id,
									created_at: last.created_at,
								}),
							).toString("base64url"),
						}
					: {}),
			};
		},
	};
}
export type SessionUsageStore = ReturnType<typeof createSessionUsageStore>;
