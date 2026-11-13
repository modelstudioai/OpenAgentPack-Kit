import type { DatabaseSync } from "node:sqlite";
import { KitError, type UsageLimitConfig, type UsageLimitPolicy } from "@openagentpack/kit-sdk/protocol";

export interface UsageLimitSession {
	session_id: string;
	member_id: string;
	input_tokens: number | null;
	output_tokens: number | null;
	active_seconds: number | null;
	admission_month: string | null;
	captured_at: string | null;
}
export interface UsageLimitRequest {
	session_id: string;
	request_key: string;
	member_id: string;
	request_hash: string;
	status: "sending" | "accepted" | "uncertain" | "settled";
	event_ids: string | null;
	previous_status: string | null;
	created_at: string;
}
export interface UsageObservation {
	input_tokens?: number;
	output_tokens?: number;
	active_seconds?: number;
}

function counterChange(previous: number | null, current: number | undefined) {
	if (current === undefined || (previous !== null && current < previous))
		return { known: false, value: previous, delta: 0 };
	return { known: true, value: current, delta: previous === null ? 0 : current - previous };
}
function observation(row: UsageLimitSession, values: UsageObservation) {
	const input = counterChange(row.input_tokens, values.input_tokens);
	const output = counterChange(row.output_tokens, values.output_tokens);
	const seconds = counterChange(row.active_seconds, values.active_seconds);
	const tokensKnown = input.known && output.known;
	const tokenBaseline = row.input_tokens !== null && row.output_tokens !== null;
	return {
		tokensKnown,
		secondsKnown: seconds.known,
		input: tokensKnown ? input.value : row.input_tokens,
		output: tokensKnown ? output.value : row.output_tokens,
		seconds: seconds.value,
		tokenDelta: tokensKnown && tokenBaseline ? input.delta + output.delta : 0,
		secondsDelta: seconds.delta,
	};
}

/** 只保存数值、月份、请求摘要与事件 ID；没有消息正文。基线与月增量在同一事务提交。 */
export function createUsageLimitStore(db: DatabaseSync) {
	const transaction = <T>(work: () => T): T => {
		db.exec("BEGIN IMMEDIATE");
		try {
			const result = work();
			db.exec("COMMIT");
			return result;
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
	};
	function session(id: string) {
		return db.prepare("SELECT * FROM kit_usage_limit_sessions WHERE session_id = ?").get(id) as
			| UsageLimitSession
			| undefined;
	}
	function totals(memberId: string, month: string) {
		return (
			(db
				.prepare(
					"SELECT tokens, active_seconds, tokens_unknown, active_seconds_unknown FROM kit_usage_limit_months WHERE member_id = ? AND month = ?",
				)
				.get(memberId, month) as
				| { tokens: number; active_seconds: number; tokens_unknown: number; active_seconds_unknown: number }
				| undefined) ?? { tokens: 0, active_seconds: 0, tokens_unknown: 0, active_seconds_unknown: 0 }
		);
	}
	/** 会话的记账条目：优先用量账本行（保留已删除会话），退回会话索引。 */
	function agentSlugOf(sessionId: string): string | null {
		return (
			(
				db.prepare("SELECT agent_slug FROM kit_session_usage WHERE session_id = ?").get(sessionId) as
					| { agent_slug: string | null }
					| undefined
			)?.agent_slug ??
			(
				db.prepare("SELECT agent_slug FROM kit_sessions WHERE session_id = ?").get(sessionId) as
					| { agent_slug: string | null }
					| undefined
			)?.agent_slug ??
			null
		);
	}
	function agentTotals(slug: string, month: string) {
		return (
			(db
				.prepare(
					"SELECT tokens, active_seconds, tokens_unknown, active_seconds_unknown FROM kit_usage_limit_agent_months WHERE agent_slug = ? AND month = ?",
				)
				.get(slug, month) as
				| { tokens: number; active_seconds: number; tokens_unknown: number; active_seconds_unknown: number }
				| undefined) ?? { tokens: 0, active_seconds: 0, tokens_unknown: 0, active_seconds_unknown: 0 }
		);
	}
	function addAgentMonthly(slug: string, month: string, tokenDelta: number, secondsDelta: number) {
		if (!Number.isSafeInteger(agentTotals(slug, month).tokens + tokenDelta))
			throw new KitError("conflict", "用量数值超出可统计范围", { retryable: true });
		db.prepare(`INSERT INTO kit_usage_limit_agent_months (agent_slug, month, tokens, active_seconds) VALUES (?, ?, ?, ?)
		ON CONFLICT(agent_slug, month) DO UPDATE SET tokens = excluded.tokens, active_seconds = excluded.active_seconds`).run(
			slug,
			month,
			agentTotals(slug, month).tokens + tokenDelta,
			agentTotals(slug, month).active_seconds + secondsDelta,
		);
	}
	/** 条目日账：与成员逐日账（020）同构；日账无未知标记，跨月丢失维度由月账闸门兜底。 */
	function agentDayTotals(slug: string, day: string) {
		return (
			(db
				.prepare("SELECT tokens, active_seconds FROM kit_usage_limit_agent_days WHERE agent_slug = ? AND day = ?")
				.get(slug, day) as { tokens: number; active_seconds: number } | undefined) ?? { tokens: 0, active_seconds: 0 }
		);
	}
	function addAgentDaily(slug: string, day: string, tokenDelta: number, secondsDelta: number) {
		if (tokenDelta === 0 && secondsDelta === 0) return;
		const previous = agentDayTotals(slug, day);
		if (!Number.isSafeInteger(previous.tokens + tokenDelta) || !Number.isFinite(previous.active_seconds + secondsDelta))
			throw new KitError("conflict", "用量数值超出可统计范围", { retryable: true });
		db.prepare(`INSERT INTO kit_usage_limit_agent_days (agent_slug, day, tokens, active_seconds) VALUES (?, ?, ?, ?)
		ON CONFLICT(agent_slug, day) DO UPDATE SET tokens = excluded.tokens, active_seconds = excluded.active_seconds`).run(
			slug,
			day,
			previous.tokens + tokenDelta,
			previous.active_seconds + secondsDelta,
		);
	}
	function markAgentUnknown(slug: string, month: string, tokens: boolean, seconds: boolean) {
		db.prepare(`INSERT INTO kit_usage_limit_agent_months (agent_slug, month, tokens_unknown, active_seconds_unknown) VALUES (?, ?, ?, ?)
		ON CONFLICT(agent_slug, month) DO UPDATE SET tokens_unknown = MAX(tokens_unknown, excluded.tokens_unknown),
		active_seconds_unknown = MAX(active_seconds_unknown, excluded.active_seconds_unknown)`).run(
			slug,
			month,
			Number(tokens),
			Number(seconds),
		);
	}
	function addMonthly(row: UsageLimitSession, tokenDelta: number, secondsDelta: number) {
		if (!row.admission_month) return;
		const previous = totals(row.member_id, row.admission_month);
		if (!Number.isSafeInteger(previous.tokens + tokenDelta) || !Number.isFinite(previous.active_seconds + secondsDelta))
			throw new KitError("conflict", "用量数值超出可统计范围", { retryable: true });
		db.prepare(`INSERT INTO kit_usage_limit_months (member_id, month, tokens, active_seconds) VALUES (?, ?, ?, ?)
		ON CONFLICT(member_id, month) DO UPDATE SET tokens = excluded.tokens, active_seconds = excluded.active_seconds`).run(
			row.member_id,
			row.admission_month,
			previous.tokens + tokenDelta,
			previous.active_seconds + secondsDelta,
		);
	}
	function markUnknown(memberId: string, month: string, tokens: boolean, seconds: boolean) {
		db.prepare(`INSERT INTO kit_usage_limit_months (member_id, month, tokens_unknown, active_seconds_unknown) VALUES (?, ?, ?, ?)
		ON CONFLICT(member_id, month) DO UPDATE SET tokens_unknown = MAX(tokens_unknown, excluded.tokens_unknown),
		active_seconds_unknown = MAX(active_seconds_unknown, excluded.active_seconds_unknown)`).run(
			memberId,
			month,
			Number(tokens),
			Number(seconds),
		);
	}
	function memberDayTotals(memberId: string, day: string) {
		return (
			(db
				.prepare("SELECT tokens, active_seconds FROM kit_usage_limit_days WHERE member_id = ? AND day = ?")
				.get(memberId, day) as { tokens: number; active_seconds: number } | undefined) ?? {
				tokens: 0,
				active_seconds: 0,
			}
		);
	}
	/** 逐日增量账与月账同事务双写；day 是采集确认日的 UTC 日键，零增量不落行。 */
	function addMemberDaily(memberId: string, day: string, tokenDelta: number, secondsDelta: number) {
		if (tokenDelta === 0 && secondsDelta === 0) return;
		const previous = memberDayTotals(memberId, day);
		if (!Number.isSafeInteger(previous.tokens + tokenDelta) || !Number.isFinite(previous.active_seconds + secondsDelta))
			throw new KitError("conflict", "用量数值超出可统计范围", { retryable: true });
		db.prepare(`INSERT INTO kit_usage_limit_days (member_id, day, tokens, active_seconds) VALUES (?, ?, ?, ?)
		ON CONFLICT(member_id, day) DO UPDATE SET tokens = excluded.tokens, active_seconds = excluded.active_seconds`).run(
			memberId,
			day,
			previous.tokens + tokenDelta,
			previous.active_seconds + secondsDelta,
		);
	}
	function resetBaseline(row: UsageLimitSession, month: string, lostTokens: boolean, lostSeconds: boolean) {
		db.prepare(
			`UPDATE kit_usage_limit_sessions SET admission_month = ?, input_tokens = ?, output_tokens = ?, active_seconds = ? WHERE session_id = ?`,
		).run(
			month,
			lostTokens ? null : row.input_tokens,
			lostTokens ? null : row.output_tokens,
			lostSeconds ? null : row.active_seconds,
			row.session_id,
		);
		markUnknown(
			row.member_id,
			month,
			lostTokens || row.input_tokens === null || row.output_tokens === null,
			lostSeconds || row.active_seconds === null,
		);
	}
	function prepareAgentAdmission(
		slug: string,
		row: UsageLimitSession,
		month: string,
		crossing: boolean,
		lostTokens: boolean,
		lostSeconds: boolean,
	) {
		if (crossing && row.admission_month) markAgentUnknown(slug, row.admission_month, lostTokens, lostSeconds);
		markAgentUnknown(
			slug,
			month,
			lostTokens || row.input_tokens === null || row.output_tokens === null,
			lostSeconds || row.active_seconds === null,
		);
	}
	function prepareAdmission(
		row: UsageLimitSession,
		month: string,
		available: { tokens: boolean; active_seconds: boolean },
	) {
		// 跨月前未读到该维度时无法分割迟到累计，旧、新两月均未知，后续首次值只重建基线。
		const crossing = row.admission_month !== month;
		const lostTokens = crossing && !available.tokens;
		const lostSeconds = crossing && !available.active_seconds;
		if (crossing && row.admission_month) markUnknown(row.member_id, row.admission_month, lostTokens, lostSeconds);
		resetBaseline(row, month, lostTokens, lostSeconds);
		// 条目月账与成员账同月同规则：跨月丢失维度标记未知，基线缺失亦然。
		const slug = agentSlugOf(row.session_id);
		if (slug) prepareAgentAdmission(slug, row, month, crossing, lostTokens, lostSeconds);
	}
	/** begin 的条目月账快照：prepareAdmission 前后各固定一份。回滚用它识别「本次 begin 引入的未知标记」，
	 * 数值列不参与（begin 不写数值，覆盖反而会抹掉其他成员的入账）。 */
	function beginAgentMonths(
		slug: string | null,
		month: string,
		row: UsageLimitSession,
		available: { tokens: boolean; active_seconds: boolean },
	) {
		if (slug === null) return [];
		const entry = slug;
		const months = [...new Set([month, row.admission_month])].filter((value): value is string => value !== null);
		const before = months.map((value) => agentTotals(entry, value));
		prepareAdmission(row, month, available);
		return months.map((value, index) => ({
			month: value,
			before: before[index]!,
			after: agentTotals(entry, value),
		}));
	}
	/** 仅明确未受理时恢复本次 begin 改动；不撤销此前采集的增量，恢复快照在 begin 事务内固定。 */
	function restoreMemberMonth(memberId: string, month: string, totalsRow: ReturnType<typeof totals>) {
		db.prepare(`INSERT INTO kit_usage_limit_months
				(member_id, month, tokens, active_seconds, tokens_unknown, active_seconds_unknown) VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT(member_id, month) DO UPDATE SET tokens = excluded.tokens, active_seconds = excluded.active_seconds,
				tokens_unknown = excluded.tokens_unknown, active_seconds_unknown = excluded.active_seconds_unknown`).run(
			memberId,
			month,
			totalsRow.tokens,
			totalsRow.active_seconds,
			totalsRow.tokens_unknown,
			totalsRow.active_seconds_unknown,
		);
	}
	/** 共享条目月账不能整行快照覆盖：begin 之后其他成员可能已入账。数值列不动，仅当未知标记
	 * 仍停留在本次 begin 提升后的值时回退；期间别人的保守提升（MAX 语义）一律保留。 */
	function restoreAgentUnknown(
		slug: string,
		month: string,
		before: ReturnType<typeof agentTotals>,
		after: ReturnType<typeof agentTotals>,
	) {
		db.prepare(`UPDATE kit_usage_limit_agent_months SET
			tokens_unknown = CASE WHEN tokens_unknown = ? THEN ? ELSE tokens_unknown END,
			active_seconds_unknown = CASE WHEN active_seconds_unknown = ? THEN ? ELSE active_seconds_unknown END
			WHERE agent_slug = ? AND month = ?`).run(
			after.tokens_unknown,
			before.tokens_unknown,
			after.active_seconds_unknown,
			before.active_seconds_unknown,
			slug,
			month,
		);
	}
	function revertCommitted(
		input: { sessionId: string; key: string },
		row: UsageLimitSession,
		previousMonths: { month: string; totals: ReturnType<typeof totals> }[],
		slug: string | null,
		previousAgentMonths: {
			month: string;
			before: ReturnType<typeof agentTotals>;
			after: ReturnType<typeof agentTotals>;
		}[],
	) {
		const removed = db
			.prepare("DELETE FROM kit_usage_limit_requests WHERE session_id = ? AND request_key = ? AND status = 'sending'")
			.run(input.sessionId, input.key);
		if (removed.changes !== 1) throw new KitError("conflict", "发送记录状态已变化");
		db.prepare(
			"UPDATE kit_usage_limit_sessions SET admission_month = ?, input_tokens = ?, output_tokens = ?, active_seconds = ? WHERE session_id = ?",
		).run(row.admission_month, row.input_tokens, row.output_tokens, row.active_seconds, row.session_id);
		for (const previous of previousMonths) restoreMemberMonth(row.member_id, previous.month, previous.totals);
		if (!slug) return;
		for (const previous of previousAgentMonths)
			restoreAgentUnknown(slug, previous.month, previous.before, previous.after);
	}
	function revertBegin(
		input: { sessionId: string; key: string },
		row: UsageLimitSession,
		previousMonths: { month: string; totals: ReturnType<typeof totals> }[],
		slug: string | null,
		previousAgentMonths: {
			month: string;
			before: ReturnType<typeof agentTotals>;
			after: ReturnType<typeof agentTotals>;
		}[],
	) {
		// 闭包不落库；进程在 POST 后退出时，持久 sending 继续保护未知结果。
		return () => transaction(() => revertCommitted(input, row, previousMonths, slug, previousAgentMonths));
	}
	/** 一次采集观测的全部记账：月账、条目月账、成员与条目逐日账（同事务），再由调用方推进会话基线。 */
	function applyObservation(row: UsageLimitSession, next: ReturnType<typeof observation>, now: string) {
		const slug = agentSlugOf(row.session_id);
		addMonthly(row, next.tokenDelta, next.secondsDelta);
		// 模版月账与成员账同月同增量；会话条目缺失（不可归属）时不写模版账。
		if (slug && row.admission_month) addAgentMonthly(slug, row.admission_month, next.tokenDelta, next.secondsDelta);
		// 逐日账与成员月账同规则（无受理月不计），归因到采集确认日；条目日账同步双写。
		if (row.admission_month) addMemberDaily(row.member_id, now.slice(0, 10), next.tokenDelta, next.secondsDelta);
		if (slug && row.admission_month) addAgentDaily(slug, now.slice(0, 10), next.tokenDelta, next.secondsDelta);
	}
	return {
		policy(): UsageLimitPolicy {
			const row = db.prepare("SELECT * FROM kit_usage_limit_policy WHERE id = 1").get() as UsageLimitConfig & {
				updated_at: string | null;
				updated_by: string | null;
			};
			return {
				limits: {
					monthly_tokens: row.monthly_tokens,
					monthly_active_seconds: row.monthly_active_seconds,
					daily_tokens: row.daily_tokens,
					daily_active_seconds: row.daily_active_seconds,
				},
				...(row.updated_at ? { updated_at: row.updated_at } : {}),
				...(row.updated_by ? { updated_by: row.updated_by } : {}),
			};
		},
		setPolicy(config: UsageLimitConfig, by: string, now: string) {
			db.prepare(
				"UPDATE kit_usage_limit_policy SET monthly_tokens = ?, monthly_active_seconds = ?, daily_tokens = ?, daily_active_seconds = ?, updated_at = ?, updated_by = ? WHERE id = 1",
			).run(
				config.monthly_tokens,
				config.monthly_active_seconds,
				config.daily_tokens,
				config.daily_active_seconds,
				now,
				by,
			);
		},
		override(memberId: string): UsageLimitConfig | null {
			return (
				(db
					.prepare(
						"SELECT monthly_tokens, monthly_active_seconds, daily_tokens, daily_active_seconds FROM kit_usage_limit_overrides WHERE member_id = ?",
					)
					.get(memberId) as UsageLimitConfig | undefined) ?? null
			);
		},
		setOverride(memberId: string, config: UsageLimitConfig, by: string, now: string) {
			db.prepare(`INSERT INTO kit_usage_limit_overrides
				(member_id, monthly_tokens, monthly_active_seconds, daily_tokens, daily_active_seconds, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(member_id) DO UPDATE SET monthly_tokens = excluded.monthly_tokens,
			monthly_active_seconds = excluded.monthly_active_seconds, daily_tokens = excluded.daily_tokens,
			daily_active_seconds = excluded.daily_active_seconds, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).run(
				memberId,
				config.monthly_tokens,
				config.monthly_active_seconds,
				config.daily_tokens,
				config.daily_active_seconds,
				now,
				by,
			);
		},
		resetOverride(memberId: string) {
			db.prepare("DELETE FROM kit_usage_limit_overrides WHERE member_id = ?").run(memberId);
		},
		templateOverride(templateId: string): UsageLimitConfig | null {
			return (
				(db
					.prepare(
						"SELECT monthly_tokens, monthly_active_seconds, daily_tokens, daily_active_seconds FROM kit_usage_limit_templates WHERE template_id = ?",
					)
					.get(templateId) as UsageLimitConfig | undefined) ?? null
			);
		},
		/** 发送准入按会话条目反查模版覆盖；未上架或未设置的条目返回 null（不限量）。 */
		templateOverrideBySlug(slug: string): UsageLimitConfig | null {
			return (
				(db
					.prepare(`SELECT o.monthly_tokens, o.monthly_active_seconds, o.daily_tokens, o.daily_active_seconds FROM kit_usage_limit_templates o
				JOIN kit_template_listings l ON l.template_id = o.template_id
				JOIN catalog_agents c ON c.id = l.catalog_id WHERE c.slug = ?`)
					.get(slug) as UsageLimitConfig | undefined) ?? null
			);
		},
		setTemplateOverride(templateId: string, config: UsageLimitConfig, by: string, now: string) {
			db.prepare(`INSERT INTO kit_usage_limit_templates
				(template_id, monthly_tokens, monthly_active_seconds, daily_tokens, daily_active_seconds, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(template_id) DO UPDATE SET monthly_tokens = excluded.monthly_tokens,
			monthly_active_seconds = excluded.monthly_active_seconds, daily_tokens = excluded.daily_tokens,
			daily_active_seconds = excluded.daily_active_seconds, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).run(
				templateId,
				config.monthly_tokens,
				config.monthly_active_seconds,
				config.daily_tokens,
				config.daily_active_seconds,
				now,
				by,
			);
		},
		resetTemplateOverride(templateId: string) {
			db.prepare("DELETE FROM kit_usage_limit_templates WHERE template_id = ?").run(templateId);
		},
		templateSlug(templateId: string): string | null {
			return (
				(
					db
						.prepare(
							"SELECT c.slug AS slug FROM kit_template_listings l JOIN catalog_agents c ON c.id = l.catalog_id WHERE l.template_id = ?",
						)
						.get(templateId) as { slug: string } | undefined
				)?.slug ?? null
			);
		},
		/** 模版条目逐日账趋势：与 summaryByTemplate 同一 join 口径（模版上架条目），自 fromDay 起逐日合计；
		 * templateId 为 null 时聚合全部模版条目，同一条目被多模版引用时会随各模版重复计入（与「全部=各模版求和」一致）。 */
		templateDailyUsage(
			templateId: string | null,
			fromDay: string,
		): { day: string; tokens: number; active_seconds: number }[] {
			return db
				.prepare(`SELECT d.day AS day, SUM(d.tokens) AS tokens, SUM(d.active_seconds) AS active_seconds
			FROM kit_usage_limit_agent_days d
			JOIN kit_template_listings l ON ${templateId ? "l.template_id = ?" : "1 = 1"}
			JOIN catalog_agents c ON c.id = l.catalog_id
			WHERE d.agent_slug = c.slug AND d.day >= ?
			GROUP BY d.day ORDER BY d.day ASC`)
				.all(...(templateId ? [templateId] : []), fromDay) as unknown as {
				day: string;
				tokens: number;
				active_seconds: number;
			}[];
		},
		/** 逐日账最早记录日（前端标注数据起点）；无记录为 null。 */
		templateDailySince(templateId: string | null): string | null {
			return (
				(
					db
						.prepare(`SELECT MIN(d.day) AS since FROM kit_usage_limit_agent_days d
			JOIN kit_template_listings l ON ${templateId ? "l.template_id = ?" : "1 = 1"}
			JOIN catalog_agents c ON c.id = l.catalog_id
			WHERE d.agent_slug = c.slug`)
						.get(...(templateId ? [templateId] : [])) as { since: string | null } | undefined
				)?.since ?? null
			);
		},
		prepare(memberId: string, now: string) {
			db.prepare("INSERT OR IGNORE INTO kit_usage_limit_members VALUES (?, ?)").run(memberId, now);
			db.prepare(`INSERT OR IGNORE INTO kit_usage_limit_sessions (session_id, member_id)
			SELECT session_id, subject_id FROM kit_sessions WHERE subject_id = ? AND purpose = 'experience'`).run(memberId);
			return (
				db.prepare("SELECT accounting_started_at FROM kit_usage_limit_members WHERE member_id = ?").get(memberId) as {
					accounting_started_at: string;
				}
			).accounting_started_at;
		},
		sessions(memberId: string) {
			return db
				.prepare("SELECT * FROM kit_usage_limit_sessions WHERE member_id = ? ORDER BY session_id")
				.all(memberId) as unknown as UsageLimitSession[];
		},
		session,
		totals,
		agentTotals,
		memberDayTotals,
		agentDayTotals,
		/** 模版准入的跨成员只读清单：该条目当月入账的全部会话（含其他成员，归属反查与 agentSlugOf 同口径）。 */
		templateSessions(slug: string, month: string) {
			return db
				.prepare(`SELECT s.* FROM kit_usage_limit_sessions s
				WHERE s.admission_month = ? AND (s.session_id IN (SELECT session_id FROM kit_session_usage WHERE agent_slug = ?)
					OR s.session_id IN (SELECT session_id FROM kit_sessions WHERE agent_slug = ? AND purpose = 'experience'))
				ORDER BY s.session_id`)
				.all(month, slug, slug) as unknown as UsageLimitSession[];
		},
		/** 模版准入补采的只读预览：按会话基线计算未入账增量与维度可用性，不写任何账本。 */
		previewDelta(row: UsageLimitSession, values: UsageObservation) {
			const next = observation(row, values);
			return {
				tokensKnown: next.tokensKnown,
				secondsKnown: next.secondsKnown,
				tokenDelta: next.tokenDelta,
				secondsDelta: next.secondsDelta,
			};
		},
		dailyUsage(memberId: string, fromDay: string): { day: string; tokens: number; active_seconds: number }[] {
			return db
				.prepare(
					"SELECT day, tokens, active_seconds FROM kit_usage_limit_days WHERE member_id = ? AND day >= ? ORDER BY day ASC",
				)
				.all(memberId, fromDay) as unknown as { day: string; tokens: number; active_seconds: number }[];
		},
		observe(sessionId: string, values: UsageObservation, now: string) {
			return transaction(() => {
				const row = session(sessionId);
				if (!row) throw new KitError("not_found", "会话用量基线不存在");
				const next = observation(row, values);
				applyObservation(row, next, now);
				db.prepare(
					`UPDATE kit_usage_limit_sessions SET input_tokens = ?, output_tokens = ?, active_seconds = ?, captured_at = ? WHERE session_id = ?`,
				).run(
					next.input,
					next.output,
					next.seconds,
					next.tokensKnown && next.secondsKnown ? now : row.captured_at,
					sessionId,
				);
				return { tokens: next.tokensKnown, active_seconds: next.secondsKnown };
			});
		},
		request(sessionId: string, key: string) {
			return db
				.prepare("SELECT * FROM kit_usage_limit_requests WHERE session_id = ? AND request_key = ?")
				.get(sessionId, key) as UsageLimitRequest | undefined;
		},
		pending(memberId: string) {
			return db
				.prepare(
					"SELECT * FROM kit_usage_limit_requests WHERE member_id = ? AND status <> 'settled' ORDER BY created_at",
				)
				.all(memberId) as unknown as UsageLimitRequest[];
		},
		begin(input: {
			sessionId: string;
			memberId: string;
			key: string;
			hash: string;
			month: string;
			previousStatus: string | null;
			now: string;
			continuation?: boolean;
			available: { tokens: boolean; active_seconds: boolean };
		}) {
			return transaction(() => {
				db.prepare(`INSERT INTO kit_usage_limit_requests
				(session_id, request_key, member_id, request_hash, status, previous_status, created_at) VALUES (?, ?, ?, ?, 'sending', ?, ?)`).run(
					input.sessionId,
					input.key,
					input.memberId,
					input.hash,
					input.previousStatus,
					input.now,
				);
				const row = session(input.sessionId);
				if (!row) throw new KitError("not_found", "会话用量基线不存在");
				const month = input.continuation ? (row.admission_month ?? input.month) : input.month;
				const previousMonths = [...new Set([month, row.admission_month])]
					.filter((value): value is string => value !== null)
					.map((value) => ({ month: value, totals: totals(row.member_id, value) }));
				// 条目月账是跨成员共享账本：begin 前后各固定一份快照，回滚只回退未知标记（restoreAgentUnknown）。
				const slug = agentSlugOf(input.sessionId);
				const previousAgentMonths = beginAgentMonths(slug, month, row, input.available);
				// 成员锁覆盖 POST；仅明确未受理时恢复本次 begin 改动，不撤销此前采集的增量。
				// 闭包不落库；进程在 POST 后退出时，持久 sending 继续保护未知结果。
				return revertBegin(input, row, previousMonths, slug, previousAgentMonths);
			});
		},
		accepted(sessionId: string, key: string, eventIds: string[]) {
			db.prepare(
				"UPDATE kit_usage_limit_requests SET status = 'accepted', event_ids = ? WHERE session_id = ? AND request_key = ?",
			).run(JSON.stringify(eventIds), sessionId, key);
		},
		uncertain(sessionId: string, key: string) {
			db.prepare(
				"UPDATE kit_usage_limit_requests SET status = 'uncertain' WHERE session_id = ? AND request_key = ?",
			).run(sessionId, key);
		},
		settle(sessionId: string, key: string) {
			db.prepare("UPDATE kit_usage_limit_requests SET status = 'settled' WHERE session_id = ? AND request_key = ?").run(
				sessionId,
				key,
			);
		},
	};
}
export type UsageLimitStore = ReturnType<typeof createUsageLimitStore>;
