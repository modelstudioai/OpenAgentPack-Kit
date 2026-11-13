import { createHash, randomUUID } from "node:crypto";
import {
	KitError,
	type MemberUsageLimitView,
	SessionStatsSchema,
	SessionUsageSchema,
	type TemplateUsageLimitView,
	type TemplateUsageTrend,
	type ToolApprovalDecision,
	type UsageLimitConfig,
	UsageLimitConfigSchema,
	type UsageLimitMetricState,
} from "@openagentpack/kit-sdk/protocol";
import { GatewaySendRejectedError } from "../gateway/send-error.ts";
import type { GatewaySendInput, GatewaySessionInfo, ProviderGateway } from "../gateway/types.ts";
import type { AuditLog } from "../store/audit.ts";
import type { MemberStore } from "../store/members.ts";
import type { SessionUsageStore } from "../store/session-usage.ts";
import type { SessionIndex } from "../store/sessions.ts";
import type { UsageLimitRequest, UsageLimitSession, UsageLimitStore } from "../store/usage-limits.ts";
import { readSessionApprovalSnapshot } from "./approval-history.ts";
import { createEventBufferRegistry, type EventBufferRegistry } from "./event-buffer.ts";
import { dayKey, dayResetAtFor, daysAgoKey, monthKey, resetAtFor } from "./quota.ts";
import { eventEnded, requestFinished, statusMarker } from "./usage-limit-completion.ts";

interface Collection {
	observations: Map<string, { tokens: boolean; active_seconds: boolean }>;
	details: Map<string, GatewaySessionInfo>;
	deleted: Set<string>;
	/** 跨成员只读补采的未入账增量：不入账，仅参与共享模版限额的准入合计。 */
	preview: Map<string, { tokenDelta: number; secondsDelta: number }>;
}
type Accepted = { event_ids: string[] };
const ended = new Set(["idle", "terminated", "archived", "completed", "failed", "stopped"]);
const uncertain = () =>
	new KitError("conflict", "此前发送结果尚未确认，不会重复发送；请查看会话，必要时确认删除后新建会话", {
		retryable: false,
	});
/** 日维度不得高于月维度：日上限超过月上限时，月闸门在当月内必然先拦截，日维度形同虚设。
 * 日维度未设置（null）时不做该校验——它跟随月度约束，由月闸门兜底。 */
function assertPeriodOrder(config: UsageLimitConfig) {
	if (config.daily_tokens !== null && config.monthly_tokens !== null && config.daily_tokens > config.monthly_tokens)
		throw new KitError("invalid_request", "日 Token 上限不能高于月度 Token 上限");
	if (
		config.daily_active_seconds !== null &&
		config.monthly_active_seconds !== null &&
		config.daily_active_seconds > config.monthly_active_seconds
	)
		throw new KitError("invalid_request", "日执行时长上限不能高于月度执行时长上限");
}
function detailEnded(info?: GatewaySessionInfo) {
	return Boolean(info && ended.has(info.status) && info.stop_reason?.type !== "requires_action");
}
function observationValues(info: GatewaySessionInfo) {
	const usage = SessionUsageSchema.safeParse(info.usage ?? {});
	const stats = SessionStatsSchema.safeParse(info.stats ?? {});
	return {
		...(usage.success ? { input_tokens: usage.data.input_tokens, output_tokens: usage.data.output_tokens } : {}),
		...(stats.success ? { active_seconds: stats.data.active_seconds } : {}),
	};
}

function metric(limit: number | null, used: number, available: boolean): UsageLimitMetricState {
	if (!available) return { limit, used: null, remaining: null, status: "unavailable" };
	return {
		limit,
		used,
		remaining: limit === null ? null : limit - used,
		status: limit !== null && used >= limit ? "exceeded" : "ok",
	};
}

/** 按受理月记录累计增量。首次成功采集只建立基线，不追溯历史，也不声称是 Provider 账单月份。 */
export function createUsageLimitService({
	store,
	members,
	sessionIndex,
	snapshots,
	gateway,
	buffers = createEventBufferRegistry(),
	audit,
	now = () => new Date(),
	timeoutMs = 15_000,
}: {
	store: UsageLimitStore;
	members: MemberStore;
	sessionIndex: SessionIndex;
	snapshots: SessionUsageStore;
	gateway: ProviderGateway;
	buffers?: EventBufferRegistry;
	audit: AuditLog;
	now?: () => Date;
	timeoutMs?: number;
}) {
	const locks = new Map<string, Promise<unknown>>();
	async function locked<T>(memberId: string, work: () => Promise<T>): Promise<T> {
		const previous = locks.get(memberId) ?? Promise.resolve();
		const task = previous.catch(() => {}).then(work);
		locks.set(memberId, task);
		try {
			return await task;
		} finally {
			if (locks.get(memberId) === task) locks.delete(memberId);
		}
	}
	/** 共享模版的准入边界：补采与合计判断按条目串行，锁序恒为成员锁 → 条目锁，不反向获取。 */
	const templateLocks = new Map<string, Promise<unknown>>();
	async function templateLocked<T>(slug: string, work: () => Promise<T>): Promise<T> {
		const previous = templateLocks.get(slug) ?? Promise.resolve();
		const task = previous.catch(() => {}).then(work);
		templateLocks.set(slug, task);
		try {
			return await task;
		} finally {
			if (templateLocks.get(slug) === task) templateLocks.delete(slug);
		}
	}
	async function bounded<T>(promise: Promise<T>): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				promise,
				new Promise<never>((_, reject) => {
					timer = setTimeout(
						() => reject(new KitError("provider_error", "用量查询超时，请稍后重试", { retryable: true })),
						timeoutMs,
					);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
	}
	function requireMember(memberId: string) {
		if (!members.findById(memberId)) throw new KitError("not_found", "成员不存在");
		return store.prepare(memberId, now().toISOString());
	}
	const limitsFor = (memberId: string) => store.override(memberId) ?? store.policy().limits;
	const enabled = (limits: UsageLimitConfig) =>
		limits.monthly_tokens !== null ||
		limits.monthly_active_seconds !== null ||
		limits.daily_tokens !== null ||
		limits.daily_active_seconds !== null;
	async function readDetail(sessionId: string): Promise<GatewaySessionInfo | null> {
		const final = snapshots.get(sessionId);
		if (!final?.deleted_at || !final.finalized_at) return bounded(gateway.getSession(sessionId));
		return {
			session_id: sessionId,
			status: "deleted",
			usage: {
				...(final.input_tokens !== null ? { input_tokens: final.input_tokens } : {}),
				...(final.output_tokens !== null ? { output_tokens: final.output_tokens } : {}),
			},
			stats: { ...(final.active_seconds !== null ? { active_seconds: final.active_seconds } : {}) },
		};
	}
	async function collectSession(sessionId: string, result: Collection) {
		try {
			const info = await readDetail(sessionId);
			if (!info) throw new Error("unavailable");
			const observed = store.observe(sessionId, observationValues(info), now().toISOString());
			result.observations.set(sessionId, observed);
			result.details.set(sessionId, info);
			if (info.status === "deleted") result.deleted.add(sessionId);
		} catch {
			// 不回传 Provider 异常或将旧快照伪装成本次成功；迟到结果不会写入基线。
			result.observations.set(sessionId, { tokens: false, active_seconds: false });
		}
	}
	async function collect(
		memberId: string,
		include: (sessionId: string, month: string | null) => boolean = () => true,
		result: Collection = { observations: new Map(), details: new Map(), deleted: new Set(), preview: new Map() },
	): Promise<Collection> {
		const rows = store
			.sessions(memberId)
			.filter((row) => include(row.session_id, row.admission_month) && !result.observations.has(row.session_id));
		// 自有基线只在成员锁内写入；普通用量列表的后台刷新不会覆盖它。
		for (let offset = 0; offset < rows.length; offset += 4) {
			await Promise.all(rows.slice(offset, offset + 4).map((row) => collectSession(row.session_id, result)));
		}
		return result;
	}
	function collectAdmission(memberId: string, sessionId: string, month: string, result?: Collection) {
		const limited = enabled(limitsFor(memberId));
		const pending = new Set(store.pending(memberId).map((request) => request.session_id));
		// 不限量也采集目标基线，但不等待无关历史。启用限额时核对本月用量及尚未结束的旧轮。
		// 已删除的不确定请求只读取本地封存快照，仍可解除对其他会话的保护。
		return collect(
			memberId,
			(id, admittedMonth) =>
				id === sessionId ||
				(limited && (admittedMonth === month || pending.has(id))) ||
				(pending.has(id) && Boolean(snapshots.get(id)?.deleted_at)),
			result,
		);
	}
	/** 跨成员只读补采：不入账、不写他人基线，未入账增量记入 preview 供共享模版限额合计。 */
	async function previewTemplateSessions(rows: UsageLimitSession[], collected: Collection) {
		const pending = rows.filter((row) => !collected.observations.has(row.session_id));
		for (let offset = 0; offset < pending.length; offset += 4) {
			await Promise.all(
				pending.slice(offset, offset + 4).map(async (row) => {
					try {
						const info = await readDetail(row.session_id);
						if (!info) throw new Error("unavailable");
						const preview = store.previewDelta(row, observationValues(info));
						collected.preview.set(row.session_id, preview);
						collected.observations.set(row.session_id, {
							tokens: preview.tokensKnown,
							active_seconds: preview.secondsKnown,
						});
					} catch {
						// 不回传 Provider 异常，也不把旧账本值伪装成本次读取成功。
						collected.observations.set(row.session_id, { tokens: false, active_seconds: false });
					}
				}),
			);
		}
	}
	function view(
		memberId: string,
		started: string,
		collected: Collection,
		month = monthKey(now()),
		targetSession?: string,
		dailyDays = 30,
	): MemberUsageLimitView {
		const limits = limitsFor(memberId);
		const used = store.totals(memberId, month);
		// 历史月份的不可读会话不会污染本月；复用它发送时仍须确认本次基线。
		const relevant = store
			.sessions(memberId)
			.filter((row) => row.admission_month === month || row.session_id === targetSession);
		const tokensAvailable = relevant.every((row) => collected.observations.get(row.session_id)?.tokens);
		const secondsAvailable = relevant.every((row) => collected.observations.get(row.session_id)?.active_seconds);
		// 每日用量窗口（默认近 30 天，含今天 UTC 日键升序、零值补全）；增量已由 observe 归因到采集确认日。
		const at = now();
		const dailyMap = new Map(store.dailyUsage(memberId, daysAgoKey(at, dailyDays - 1)).map((row) => [row.day, row]));
		const daily = Array.from({ length: dailyDays }, (_, index) => {
			const day = daysAgoKey(at, dailyDays - 1 - index);
			const row = dailyMap.get(day);
			return {
				day,
				tokens: row?.tokens ?? 0,
				active_seconds: row?.active_seconds ?? 0,
			};
		});
		// 日维度状态：今日已用取自逐日账（当日增量由 observe 实时写入），可用性与月维度同源。
		const day = dayKey(at);
		const dayUsed = store.memberDayTotals(memberId, day);
		return {
			member_id: memberId,
			month,
			reset_at: resetAtFor(month),
			limits,
			override: store.override(memberId),
			tokens: metric(limits.monthly_tokens, used.tokens, tokensAvailable && !used.tokens_unknown),
			active_seconds: metric(
				limits.monthly_active_seconds,
				used.active_seconds,
				secondsAvailable && !used.active_seconds_unknown,
			),
			day_state: {
				day,
				reset_at: dayResetAtFor(day),
				tokens: metric(limits.daily_tokens, dayUsed.tokens, tokensAvailable && !used.tokens_unknown),
				active_seconds: metric(
					limits.daily_active_seconds,
					dayUsed.active_seconds,
					secondsAvailable && !used.active_seconds_unknown,
				),
			},
			accounting_started_at: started,
			daily,
			...(tokensAvailable || secondsAvailable ? { refreshed_at: now().toISOString() } : {}),
		};
	}
	/** 单指标限额断言（成员维度）：unavailable 一律拒发；exceeded 拒绝后续发送，本轮已受理的不强制停止。 */
	function assertMemberMetric(
		name: "tokens" | "active_seconds",
		period: "month" | "day",
		periodKey: string,
		state: UsageLimitMetricState,
		resetAt: string,
	) {
		if (state.limit === null) return;
		if (state.status === "unavailable")
			throw new KitError("conflict", "当前用量暂不可确认，请稍后重试；不会发送新消息", {
				retryable: true,
				details: { metric: name, usage_unavailable: true },
			});
		if (state.status === "exceeded") {
			const unit = name === "tokens" ? "Token 用量已达到限额" : "执行时长已达到限额";
			throw new KitError("quota_exceeded", `${periodKey}${period === "month" ? " 月" : ""}${unit}`, {
				details: {
					metric: name,
					period,
					...(period === "month" ? { month: periodKey } : { day: periodKey }),
					limit: state.limit,
					used: state.used,
					remaining: state.remaining,
					reset_at: resetAt,
				},
			});
		}
	}
	function assertAvailable(current: MemberUsageLimitView) {
		assertMemberMetric("tokens", "month", current.month, current.tokens, current.reset_at);
		assertMemberMetric("active_seconds", "month", current.month, current.active_seconds, current.reset_at);
		assertMemberMetric("tokens", "day", current.day_state.day, current.day_state.tokens, current.day_state.reset_at);
		assertMemberMetric(
			"active_seconds",
			"day",
			current.day_state.day,
			current.day_state.active_seconds,
			current.day_state.reset_at,
		);
	}
	/** 模版限额超限错误：月与日的明细键名、重置时间不同。 */
	function templateQuotaError(
		name: string,
		period: "month" | "day",
		periodKey: string,
		limit: number,
		used: number,
	): KitError {
		const unit = name === "tokens" ? "Token 用量已达到限额" : "执行时长已达到限额";
		const details =
			period === "month"
				? {
						metric: name,
						scope: "template",
						period,
						month: periodKey,
						limit,
						used,
						remaining: limit - used,
						reset_at: resetAtFor(periodKey),
					}
				: {
						metric: name,
						scope: "template",
						period,
						day: periodKey,
						limit,
						used,
						remaining: limit - used,
						reset_at: dayResetAtFor(periodKey),
					};
		return new KitError("quota_exceeded", `${periodKey}${period === "month" ? " 月" : ""}该模版${unit}`, { details });
	}
	/** 模版限额仅在管理员设置覆盖时生效；用量不可确认时与成员限额同样拒发。 */
	function assertTemplateMetric(
		name: string,
		period: "month" | "day",
		periodKey: string,
		limit: number | null,
		used: number,
		unknown: boolean,
	) {
		if (limit === null) return;
		if (unknown)
			throw new KitError("conflict", "当前用量暂不可确认，请稍后重试；不会发送新消息", {
				retryable: true,
				details: { metric: name, usage_unavailable: true, scope: "template" },
			});
		if (used >= limit) throw templateQuotaError(name, period, periodKey, limit, used);
	}
	/** 共享模版准入合计：条目月账 + 条目日账 + 全部未入账预览增量（增量按采集确认日归入当日）。 */
	function templateAdmissionTotals(slug: string, month: string, rows: UsageLimitSession[], collected: Collection) {
		const monthTotals = store.agentTotals(slug, month);
		const day = dayKey(now());
		const dayTotals = store.agentDayTotals(slug, day);
		const totals = {
			dayKey: day,
			tokens: monthTotals.tokens,
			seconds: monthTotals.active_seconds,
			dayTokens: dayTotals.tokens,
			daySeconds: dayTotals.active_seconds,
			tokensAvailable: true,
			secondsAvailable: true,
		};
		for (const row of rows) {
			const available = collected.observations.get(row.session_id);
			totals.tokensAvailable = totals.tokensAvailable && (available?.tokens ?? false);
			totals.secondsAvailable = totals.secondsAvailable && (available?.active_seconds ?? false);
			const preview = collected.preview.get(row.session_id);
			if (preview) {
				totals.tokens += preview.tokenDelta;
				totals.seconds += preview.secondsDelta;
				totals.dayTokens += preview.tokenDelta;
				totals.daySeconds += preview.secondsDelta;
			}
		}
		return {
			...totals,
			// 月账未知标记与会话读取失败都会让合计不可信；日账无标记，只受读取失败影响。
			monthTokensUnknown: monthTotals.tokens_unknown !== 0 || !totals.tokensAvailable,
			monthSecondsUnknown: monthTotals.active_seconds_unknown !== 0 || !totals.secondsAvailable,
			dayTokensUnknown: !totals.tokensAvailable,
			daySecondsUnknown: !totals.secondsAvailable,
		};
	}
	/** 条目锁内的准入判断：先只读补采清单里尚未读取的会话，再按账本 + 未入账增量做共享限额检查。 */
	async function admitTemplate(slug: string, month: string, collected: Collection, override: UsageLimitConfig) {
		const rows = store.templateSessions(slug, month);
		await previewTemplateSessions(rows, collected);
		const totals = templateAdmissionTotals(slug, month, rows, collected);
		assertTemplateMetric("tokens", "month", month, override.monthly_tokens, totals.tokens, totals.monthTokensUnknown);
		assertTemplateMetric(
			"active_seconds",
			"month",
			month,
			override.monthly_active_seconds,
			totals.seconds,
			totals.monthSecondsUnknown,
		);
		// 日账无未知标记；本月相关会话读取失败时今日合计可能缺增量，按不可确认拒发。
		assertTemplateMetric(
			"tokens",
			"day",
			totals.dayKey,
			override.daily_tokens,
			totals.dayTokens,
			totals.dayTokensUnknown,
		);
		assertTemplateMetric(
			"active_seconds",
			"day",
			totals.dayKey,
			override.daily_active_seconds,
			totals.daySeconds,
			totals.daySecondsUnknown,
		);
	}
	/** 模版限额准入：其他成员已发生、尚未采集的消耗以只读补采计入合计（不入账，自有基线
	 * 仍只在成员锁内写入）；本次读取失败、字段缺失或计数倒退的会话不得凭旧账本放行。 */
	async function assertTemplateAdmission(agentSlug: string | undefined, month: string, collected: Collection) {
		if (!agentSlug) return;
		const override = store.templateOverrideBySlug(agentSlug);
		if (!override || !enabled(override)) return;
		await templateLocked(agentSlug, () => admitTemplate(agentSlug, month, collected, override));
	}
	function templateView(templateId: string): TemplateUsageLimitView {
		const override = store.templateOverride(templateId);
		const limits = override ?? {
			monthly_tokens: null,
			monthly_active_seconds: null,
			daily_tokens: null,
			daily_active_seconds: null,
		};
		const month = monthKey(now());
		const slug = store.templateSlug(templateId);
		const used = slug
			? store.agentTotals(slug, month)
			: { tokens: 0, active_seconds: 0, tokens_unknown: 0, active_seconds_unknown: 0 };
		const day = dayKey(now());
		const dayUsed = slug ? store.agentDayTotals(slug, day) : { tokens: 0, active_seconds: 0 };
		return {
			template_id: templateId,
			month,
			reset_at: resetAtFor(month),
			limits,
			override,
			tokens: metric(limits.monthly_tokens, used.tokens, Boolean(slug) && !used.tokens_unknown),
			active_seconds: metric(
				limits.monthly_active_seconds,
				used.active_seconds,
				Boolean(slug) && !used.active_seconds_unknown,
			),
			day_state: {
				day,
				reset_at: dayResetAtFor(day),
				tokens: metric(limits.daily_tokens, dayUsed.tokens, Boolean(slug)),
				active_seconds: metric(limits.daily_active_seconds, dayUsed.active_seconds, Boolean(slug)),
			},
			...(slug ? { refreshed_at: now().toISOString() } : {}),
		};
	}
	/** 模版用量逐日趋势：条目逐日账（模版限额账本启用后开始记录），零值补全到今天（UTC 日键）；
	 * templateId 为 null 时聚合全部模版条目。 */
	function templateDailyTrend(templateId: string | null, days: number): TemplateUsageTrend {
		const at = now();
		const from = daysAgoKey(at, days - 1);
		const rows = new Map(store.templateDailyUsage(templateId, from).map((row) => [row.day, row]));
		const data = Array.from({ length: days }, (_, index) => {
			const day = daysAgoKey(at, days - 1 - index);
			const row = rows.get(day);
			return { day, tokens: row?.tokens ?? 0, active_seconds: row?.active_seconds ?? 0 };
		});
		return {
			days,
			from_day: from,
			to_day: dayKey(at),
			since_day: store.templateDailySince(templateId),
			data,
		};
	}
	async function history(sessionId: string) {
		const controller = new AbortController();
		// 其他会话可能没有活跃 pump；一次性读取不得向共享注册表遗留空缓冲。
		const registry = buffers.get(sessionId) ? buffers : createEventBufferRegistry();
		try {
			return await bounded(readSessionApprovalSnapshot(gateway, registry, sessionId, controller.signal));
		} finally {
			controller.abort();
		}
	}
	function replay(previous: UsageLimitRequest | undefined, hash: string): Accepted | undefined {
		if (!previous) return undefined;
		if (previous.request_hash !== hash) throw new KitError("conflict", "请求标识已用于其他内容，请重新发送");
		if (previous.event_ids && ["accepted", "settled"].includes(previous.status))
			return { event_ids: JSON.parse(previous.event_ids) as string[] };
		throw uncertain();
	}
	/** POST 成功只代表受理。必须出现较新的主会话结束状态，才允许下一轮消费。 */
	async function confirmFinished(request: UsageLimitRequest, collected: Collection) {
		if (!detailEnded(collected.details.get(request.session_id)))
			throw new KitError("conflict", "上一轮执行尚未结束，请等待或中断后重试", { retryable: true });
		const snapshot = await history(request.session_id);
		if (!requestFinished(snapshot.events, snapshot.latestStatus, request, buffers.get(request.session_id)))
			throw new KitError("conflict", "上一轮结果尚未确认，请稍后重试", { retryable: true });
		store.settle(request.session_id, request.request_key);
	}
	async function checkPending(memberId: string, collected: Collection, continuationSession?: string) {
		for (const request of store.pending(memberId)) {
			if (collected.deleted.has(request.session_id)) {
				store.settle(request.session_id, request.request_key);
				continue;
			}
			if (request.status !== "accepted") throw uncertain();
			if (request.session_id === continuationSession) continue;
			await confirmFinished(request, collected);
		}
	}
	async function load(memberId: string, dailyDays = 30) {
		const started = requireMember(memberId);
		return view(memberId, started, await collect(memberId), monthKey(now()), undefined, dailyDays);
	}
	async function finishSend(sessionId: string, key: string, send: () => Promise<Accepted>, reject: () => void) {
		try {
			const result = await bounded(send());
			store.accepted(sessionId, key, result.event_ids);
			return result;
		} catch (error) {
			if (error instanceof GatewaySendRejectedError) {
				try {
					reject();
				} catch {
					// 回滚未提交时保留 sending，避免只清除部分受理状态后放行。
					throw uncertain();
				}
				throw error;
			}
			try {
				store.uncertain(sessionId, key);
			} catch {
				/* sending 仍能在重启后保护结果不明。 */
			}
			throw uncertain();
		}
	}
	async function optionalStatusMarker(sessionId: string) {
		// Provider 可返回空 event_ids；保存发送前状态才能区分旧 idle 与本轮结束。
		try {
			return statusMarker((await history(sessionId)).latestStatus, buffers.get(sessionId));
		} catch {
			// 不限量时不因历史读取失败拒绝；空 ID 的受理结果后续保持待确认。
			return null;
		}
	}
	function admissionMonth(sessionId: string, continuation: boolean, at = now()) {
		return (continuation && store.session(sessionId)?.admission_month) || monthKey(at);
	}
	function assertNoUncertain(memberId: string, collected: Collection) {
		if (
			store
				.pending(memberId)
				.some(
					(request) => ["sending", "uncertain"].includes(request.status) && !collected.deleted.has(request.session_id),
				)
		)
			throw uncertain();
	}
	async function execute(
		sessionId: string,
		key: string,
		hash: string,
		beforeSend: (() => void | Promise<void>) | undefined,
		send: () => Promise<Accepted>,
		continuation = false,
	): Promise<Accepted> {
		const local = sessionIndex.get(sessionId);
		if (local?.purpose !== "experience" || !members.findById(local.subject_id)) {
			await beforeSend?.();
			return send();
		}
		return locked(local.subject_id, async () => {
			const existing = replay(store.request(sessionId, key), hash);
			if (existing) return existing;
			const started = requireMember(local.subject_id);
			const collected = await collectAdmission(local.subject_id, sessionId, admissionMonth(sessionId, continuation));
			const current = view(local.subject_id, started, collected, admissionMonth(sessionId, continuation), sessionId);
			let previousStatus: string | null = null;
			let executionChecked = false;
			const checkExecution = async () => {
				// 异步采集期间可能从不限量切为限量；补齐新政策需要的会话后才作准入判断。
				await collectAdmission(local.subject_id, sessionId, admissionMonth(sessionId, continuation), collected);
				assertAvailable(view(local.subject_id, started, collected, admissionMonth(sessionId, continuation), sessionId));
				await checkPending(local.subject_id, collected, continuation ? sessionId : undefined);
				const info = collected.details.get(sessionId);
				const status = (await history(sessionId)).latestStatus;
				previousStatus = statusMarker(status, buffers.get(sessionId));
				if (!continuation && (!detailEnded(info) || (status && !eventEnded(status))))
					throw new KitError("conflict", "会话仍在执行，请等待或中断后重试", { retryable: true });
				executionChecked = true;
			};
			if (enabled(current.limits)) {
				await checkExecution();
			} else {
				previousStatus = await optionalStatusMarker(sessionId);
			}
			// 读取失败不会挡未启用的维度；已有结果不明的请求始终不能自动重发。
			assertNoUncertain(local.subject_id, collected);
			// 全局政策可能在网络采集期间变更；使用真正发送前的有效政策，不缓存旧的不限量配置。
			if (enabled(limitsFor(local.subject_id)) && !executionChecked) await checkExecution();
			// 此同步检查是准入点；之后才记受理账本，不在记账后因政策变更追溯拒绝。
			const admittedAt = now();
			const admittedMonth = admissionMonth(sessionId, continuation, admittedAt);
			assertAvailable(view(local.subject_id, started, collected, admittedMonth, sessionId));
			await assertTemplateAdmission(local.agent_slug, admittedMonth, collected);
			await beforeSend?.();
			const reject = store.begin({
				sessionId,
				memberId: local.subject_id,
				key,
				hash,
				month: monthKey(admittedAt),
				previousStatus,
				now: admittedAt.toISOString(),
				continuation,
				available: collected.observations.get(sessionId) ?? { tokens: false, active_seconds: false },
			});
			return finishSend(sessionId, key, send, reject);
		});
	}
	return {
		policy: store.policy,
		setPolicy(config: UsageLimitConfig, by: string) {
			const parsed = UsageLimitConfigSchema.parse(config);
			assertPeriodOrder(parsed);
			store.setPolicy(parsed, by, now().toISOString());
			audit.append({ subject: by, action: "usage_limits.policy.set", detail: parsed });
			return store.policy();
		},
		member: (memberId: string, options: { dailyDays?: number } = {}) =>
			locked(memberId, () => load(memberId, options.dailyDays)),
		setMember: (memberId: string, config: UsageLimitConfig, by: string) =>
			locked(memberId, async () => {
				requireMember(memberId);
				const parsed = UsageLimitConfigSchema.parse(config);
				assertPeriodOrder(parsed);
				store.setOverride(memberId, parsed, by, now().toISOString());
				audit.append({ subject: by, action: "usage_limits.member.set", target: memberId, detail: parsed });
				return load(memberId);
			}),
		resetMember: (memberId: string, by: string) =>
			locked(memberId, async () => {
				requireMember(memberId);
				store.resetOverride(memberId);
				audit.append({ subject: by, action: "usage_limits.member.reset", target: memberId });
				return load(memberId);
			}),
		template: (templateId: string) => templateView(templateId),
		templateDailyTrend,
		setTemplate: (templateId: string, config: UsageLimitConfig, by: string) => {
			const parsed = UsageLimitConfigSchema.parse(config);
			assertPeriodOrder(parsed);
			store.setTemplateOverride(templateId, parsed, by, now().toISOString());
			audit.append({ subject: by, action: "usage_limits.template.set", target: templateId, detail: parsed });
			return templateView(templateId);
		},
		resetTemplate: (templateId: string, by: string) => {
			store.resetTemplateOverride(templateId);
			audit.append({ subject: by, action: "usage_limits.template.reset", target: templateId });
			return templateView(templateId);
		},
		isMember: (subjectId: string) => Boolean(members.findById(subjectId)),
		runSend(
			sessionId: string,
			input: GatewaySendInput,
			beforeSend: (() => void | Promise<void>) | undefined,
			send: () => Promise<Accepted>,
		) {
			return execute(
				sessionId,
				`message:${input.clientMessageId ?? randomUUID()}`,
				createHash("sha256").update(input.text).digest("hex"),
				beforeSend,
				send,
			);
		},
		runApproval(sessionId: string, decision: ToolApprovalDecision, send: () => Promise<Accepted>) {
			if (decision.result === "deny") return send();
			return execute(
				sessionId,
				`approval:${decision.batch_id}:${decision.call_id}`,
				createHash("sha256").update(JSON.stringify(decision)).digest("hex"),
				undefined,
				send,
				true,
			);
		},
	};
}
export type UsageLimitService = ReturnType<typeof createUsageLimitService>;
