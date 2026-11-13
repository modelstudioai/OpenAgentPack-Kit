import type { DatabaseSync } from "node:sqlite";

/**
 * Credits 用量与提额审批的存储层（node:sqlite，见 migration 003）。
 * 不变量：
 * - `usage_turns` 是扣费账本（1 行 = 1 个被受理的 Turn），**不存事件正文**；
 * - 重试幂等靠部分唯一索引 `(session_id, client_message_id)`，`INSERT OR IGNORE` 后看 changes；
 * - 月/日键由 service 以 UTC 计算后传入，存储层不做时间运算。
 */

export interface QuotaPolicyRow {
	monthly_credits: number;
	updated_at: string | null;
	updated_by: string | null;
}

export interface QuotaOverrideRow {
	subject_id: string;
	monthly_credits: number;
	reason: string | null;
	updated_by: string;
	updated_at: string;
}

export interface QuotaPackRow {
	id: string;
	subject_id: string;
	month: string;
	credits: number;
	reason: string | null;
	granted_by: string;
	created_at: string;
}

export interface QuotaRequestRow {
	id: string;
	subject_id: string;
	requested_credits: number;
	reason: string | null;
	status: "pending" | "approved" | "rejected";
	mode: "override" | "pack" | null;
	granted_credits: number | null;
	review_note: string | null;
	reviewed_by: string | null;
	created_at: string;
	reviewed_at: string | null;
}

export function createQuotaStore(db: DatabaseSync) {
	return {
		getPolicy(): QuotaPolicyRow {
			const row = db.prepare("SELECT monthly_credits, updated_at, updated_by FROM quota_policy WHERE id = 1").get() as
				| QuotaPolicyRow
				| undefined;
			if (row) return row;
			// 迁移种子行缺失（极端：手工删库）时兜底重建，避免 get 返回 undefined 炸路由
			db.prepare("INSERT OR IGNORE INTO quota_policy (id, monthly_credits) VALUES (1, 200)").run();
			return { monthly_credits: 200, updated_at: null, updated_by: null };
		},
		setPolicy(monthlyCredits: number, by: string) {
			db.prepare("UPDATE quota_policy SET monthly_credits = ?, updated_at = ?, updated_by = ? WHERE id = 1").run(
				monthlyCredits,
				new Date().toISOString(),
				by,
			);
			return this.getPolicy();
		},

		getOverride(subjectId: string): QuotaOverrideRow | null {
			return (
				(db.prepare("SELECT * FROM quota_override WHERE subject_id = ?").get(subjectId) as
					| QuotaOverrideRow
					| undefined) ?? null
			);
		},
		setOverride(input: { subjectId: string; monthlyCredits: number; reason?: string; by: string }) {
			db.prepare(
				`INSERT INTO quota_override (subject_id, monthly_credits, reason, updated_by, updated_at)
				 VALUES (?,?,?,?,?)
				 ON CONFLICT(subject_id) DO UPDATE SET monthly_credits = excluded.monthly_credits,
				   reason = excluded.reason, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
			).run(input.subjectId, input.monthlyCredits, input.reason ?? null, input.by, new Date().toISOString());
			return this.getOverride(input.subjectId) as QuotaOverrideRow;
		},
		deleteOverride(subjectId: string): boolean {
			return db.prepare("DELETE FROM quota_override WHERE subject_id = ?").run(subjectId).changes > 0;
		},
		listOverrides(): QuotaOverrideRow[] {
			return db.prepare("SELECT * FROM quota_override ORDER BY updated_at DESC").all() as unknown as QuotaOverrideRow[];
		},

		listPacks(subjectId: string, month: string): QuotaPackRow[] {
			return db
				.prepare("SELECT * FROM quota_pack WHERE subject_id = ? AND month = ? ORDER BY created_at ASC")
				.all(subjectId, month) as unknown as QuotaPackRow[];
		},
		addPack(input: { id: string; subjectId: string; month: string; credits: number; reason?: string; by: string }) {
			const createdAt = new Date().toISOString();
			db.prepare(
				"INSERT INTO quota_pack (id, subject_id, month, credits, reason, granted_by, created_at) VALUES (?,?,?,?,?,?,?)",
			).run(input.id, input.subjectId, input.month, input.credits, input.reason ?? null, input.by, createdAt);
			return {
				id: input.id,
				subject_id: input.subjectId,
				month: input.month,
				credits: input.credits,
				reason: input.reason ?? null,
				granted_by: input.by,
				created_at: createdAt,
			} as QuotaPackRow;
		},
		deletePack(id: string): boolean {
			return db.prepare("DELETE FROM quota_pack WHERE id = ?").run(id).changes > 0;
		},

		/** 重试幂等探针：同一 (session, client_message_id) 是否已扣过费。 */
		turnExists(sessionId: string, clientMessageId: string): boolean {
			return (
				db
					.prepare("SELECT 1 FROM usage_turns WHERE session_id = ? AND client_message_id = ?")
					.get(sessionId, clientMessageId) !== undefined
			);
		},
		/** 扣 1 个 Turn；返回 false 表示幂等重放（已扣过，不重复计）。 */
		chargeTurn(input: {
			subjectId: string;
			agentSlug: string;
			sessionId: string;
			clientMessageId?: string;
			day: string;
			month: string;
		}): boolean {
			const result = db
				.prepare(
					`INSERT OR IGNORE INTO usage_turns (subject_id, agent_slug, session_id, client_message_id, day, month, created_at)
					 VALUES (?,?,?,?,?,?,?)`,
				)
				.run(
					input.subjectId,
					input.agentSlug,
					input.sessionId,
					input.clientMessageId ?? null,
					input.day,
					input.month,
					new Date().toISOString(),
				);
			return result.changes > 0;
		},
		usedForMonth(subjectId: string, month: string): number {
			const row = db
				.prepare("SELECT COUNT(*) AS n FROM usage_turns WHERE subject_id = ? AND month = ?")
				.get(subjectId, month) as { n: number };
			return row.n;
		},
		turnsByAgentForMonth(subjectId: string, month: string): { agent_slug: string; turns: number }[] {
			return db
				.prepare(
					"SELECT agent_slug, COUNT(*) AS turns FROM usage_turns WHERE subject_id = ? AND month = ? GROUP BY agent_slug ORDER BY turns DESC",
				)
				.all(subjectId, month) as unknown as { agent_slug: string; turns: number }[];
		},
		dailyTurns(subjectId: string, fromDay: string): { day: string; turns: number }[] {
			return db
				.prepare(
					"SELECT day, COUNT(*) AS turns FROM usage_turns WHERE subject_id = ? AND day >= ? GROUP BY day ORDER BY day ASC",
				)
				.all(subjectId, fromDay) as unknown as { day: string; turns: number }[];
		},
		/** 广场「同学们都在用」：近 30 天全局 turn 数（跨 subject）。 */
		turns30dByAgent(fromDay: string): { agent_slug: string; turns: number }[] {
			return db
				.prepare(
					"SELECT agent_slug, COUNT(*) AS turns FROM usage_turns WHERE day >= ? GROUP BY agent_slug ORDER BY turns DESC",
				)
				.all(fromDay) as unknown as { agent_slug: string; turns: number }[];
		},
		subjectUsageForMonth(month: string): { subject_id: string; used: number }[] {
			return db
				.prepare(
					"SELECT subject_id, COUNT(*) AS used FROM usage_turns WHERE month = ? GROUP BY subject_id ORDER BY used DESC",
				)
				.all(month) as unknown as { subject_id: string; used: number }[];
		},

		createRequest(input: { id: string; subjectId: string; requestedCredits: number; reason?: string }) {
			const createdAt = new Date().toISOString();
			db.prepare(
				`INSERT INTO quota_request (id, subject_id, requested_credits, reason, status, created_at)
				 VALUES (?,?,?,?, 'pending', ?)`,
			).run(input.id, input.subjectId, input.requestedCredits, input.reason ?? null, createdAt);
			return this.getRequest(input.id) as QuotaRequestRow;
		},
		getRequest(id: string): QuotaRequestRow | null {
			return (db.prepare("SELECT * FROM quota_request WHERE id = ?").get(id) as QuotaRequestRow | undefined) ?? null;
		},
		pendingRequest(subjectId: string): QuotaRequestRow | null {
			return (
				(db
					.prepare(
						"SELECT * FROM quota_request WHERE subject_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
					)
					.get(subjectId) as QuotaRequestRow | undefined) ?? null
			);
		},
		listRequestsForSubject(subjectId: string): QuotaRequestRow[] {
			return db
				.prepare("SELECT * FROM quota_request WHERE subject_id = ? ORDER BY created_at DESC")
				.all(subjectId) as unknown as QuotaRequestRow[];
		},
		listRequests(status?: "pending" | "approved" | "rejected"): QuotaRequestRow[] {
			const rows = status
				? db.prepare("SELECT * FROM quota_request WHERE status = ? ORDER BY created_at DESC").all(status)
				: db.prepare("SELECT * FROM quota_request ORDER BY created_at DESC").all();
			return rows as unknown as QuotaRequestRow[];
		},
		reviewRequest(input: {
			id: string;
			status: "approved" | "rejected";
			mode?: "override" | "pack";
			grantedCredits?: number;
			note?: string;
			by: string;
		}) {
			db.prepare(
				`UPDATE quota_request SET status = ?, mode = ?, granted_credits = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?
				 WHERE id = ?`,
			).run(
				input.status,
				input.mode ?? null,
				input.grantedCredits ?? null,
				input.note ?? null,
				input.by,
				new Date().toISOString(),
				input.id,
			);
			return this.getRequest(input.id) as QuotaRequestRow;
		},
	};
}
export type QuotaStore = ReturnType<typeof createQuotaStore>;
