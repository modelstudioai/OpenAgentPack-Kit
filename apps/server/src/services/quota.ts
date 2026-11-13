import { randomUUID } from "node:crypto";
import {
	KitError,
	PLAZA_CATEGORY_LABELS,
	type PlazaCategory,
	type PlazaView,
	type QuotaOverrideView,
	type QuotaPackView,
	type QuotaPolicyView,
	type QuotaRequestView,
	type QuotaUsageRow,
	type QuotaView,
} from "@openagentpack/kit-sdk/protocol";
import type { AuditLog } from "../store/audit.ts";
import type { CatalogStore } from "../store/catalog.ts";
import type { QuotaStore } from "../store/quota.ts";
import type { SessionIndex } from "../store/sessions.ts";

/** UTC 月键 `YYYY-MM`：配额周期与加油包有效期都以它为准（跨时区部署口径一致）。 */
export function monthKey(now: Date): string {
	return now.toISOString().slice(0, 7);
}
/** UTC 日键 `YYYY-MM-DD`（用量热力图与账本分区）。 */
export function dayKey(now: Date): string {
	return now.toISOString().slice(0, 10);
}
/** 次月 1 日 UTC 的 ISO 串（前端展示「重置时间」）。 */
export function resetAtFor(month: string): string {
	const [year, mon] = month.split("-").map(Number) as [number, number];
	return new Date(Date.UTC(year, mon, 1)).toISOString();
}
/** 次日 0 点 UTC 的 ISO 串（日限额重置时间）。 */
export function dayResetAtFor(day: string): string {
	const [year, mon, date] = day.split("-").map(Number) as [number, number, number];
	return new Date(Date.UTC(year, mon - 1, date + 1)).toISOString();
}
export function daysAgoKey(now: Date, days: number): string {
	return dayKey(new Date(now.getTime() - days * 86_400_000));
}

export interface QuotaServiceDeps {
	store: QuotaStore;
	catalog: CatalogStore;
	sessionIndex: SessionIndex;
	audit: AuditLog;
	/** `KIT_QUOTA_DEFAULT_MONTHLY`：仅在政策行从未被人工改过时生效（避免覆盖管理员意图）。 */
	defaultMonthly?: number;
}

export interface QuotaState {
	month: string;
	reset_at: string;
	unlimited: boolean;
	base_limit: number;
	override_limit: number | null;
	packs: QuotaPackView[];
	limit: number;
	used: number;
	remaining: number;
}

function packView(row: {
	id: string;
	subject_id: string;
	month: string;
	credits: number;
	reason: string | null;
	granted_by: string;
	created_at: string;
}): QuotaPackView {
	return {
		id: row.id,
		month: row.month,
		credits: row.credits,
		...(row.reason ? { reason: row.reason } : {}),
		granted_by: row.granted_by,
		created_at: row.created_at,
	};
}

function requestView(row: {
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
}): QuotaRequestView {
	return {
		id: row.id,
		subject_id: row.subject_id,
		requested_credits: row.requested_credits,
		...(row.reason ? { reason: row.reason } : {}),
		status: row.status,
		mode: row.mode,
		granted_credits: row.granted_credits,
		...(row.review_note ? { review_note: row.review_note } : {}),
		...(row.reviewed_by ? { reviewed_by: row.reviewed_by } : {}),
		created_at: row.created_at,
		...(row.reviewed_at ? { reviewed_at: row.reviewed_at } : {}),
	};
}

/**
 * Credits 用量服务：限额解析（override > policy，packs 叠加）、send 受理点扣费、
 * 广场视图、员工申请与管理端审批闭环。
 * 红线：扣费只发生在「服务端接受发消息请求」这一个点；前端永远不自算余额。
 */
/** 审批入参闸门：通过必须二选一生效方式；驳回必须给理由（员工端可见）。 */
function assertReviewInput(input: { action: "approve" | "reject"; mode?: "override" | "pack"; note?: string }) {
	if (input.action === "approve" && !input.mode) {
		throw new KitError(
			"invalid_request",
			"通过申请必须二选一生效方式：mode=override（长期上限）或 mode=pack（当月加油包）",
		);
	}
	if (input.action === "reject" && !input.note?.trim()) {
		throw new KitError("invalid_request", "驳回必须填写理由（note），员工端会看到");
	}
}

export function createQuotaService(deps: QuotaServiceDeps) {
	const { store, catalog, sessionIndex, audit } = deps;

	if (deps.defaultMonthly != null) {
		const policy = store.getPolicy();
		if (policy.updated_at == null && policy.monthly_credits !== deps.defaultMonthly) {
			store.setPolicy(deps.defaultMonthly, "config");
		}
	}

	function stateFor(subjectId: string, now = new Date()): QuotaState {
		const month = monthKey(now);
		const policy = store.getPolicy();
		const override = store.getOverride(subjectId);
		const limit = override?.monthly_credits ?? policy.monthly_credits;
		const packs = store.listPacks(subjectId, month).map(packView);
		const packTotal = packs.reduce((sum, p) => sum + p.credits, 0);
		const used = store.usedForMonth(subjectId, month);
		const unlimited = limit === -1;
		return {
			month,
			reset_at: resetAtFor(month),
			unlimited,
			base_limit: policy.monthly_credits,
			override_limit: override?.monthly_credits ?? null,
			packs,
			limit,
			used,
			remaining: unlimited ? -1 : limit + packTotal - used,
		};
	}

	/** 审批通过的副作用：override=覆盖长期上限；pack=当月加油包（月底失效）。 */
	function applyApproval(
		current: { id: string; subject_id: string },
		mode: "override" | "pack",
		granted: number,
		by: string,
	) {
		if (mode === "override") {
			store.setOverride({
				subjectId: current.subject_id,
				monthlyCredits: granted,
				reason: `批准申请 ${current.id}`,
				by,
			});
			return;
		}
		store.addPack({
			id: `qp_${randomUUID().slice(0, 8)}`,
			subjectId: current.subject_id,
			month: monthKey(new Date()),
			credits: granted,
			reason: `批准申请 ${current.id}`,
			by,
		});
	}

	function finalizeReview(
		id: string,
		input: { action: "approve" | "reject"; mode?: "override" | "pack"; note?: string },
		granted: number,
		by: string,
	): QuotaRequestView {
		const row = store.reviewRequest({
			id,
			status: input.action === "approve" ? "approved" : "rejected",
			...(input.action === "approve" ? { mode: input.mode, grantedCredits: granted } : {}),
			...(input.note ? { note: input.note } : {}),
			by,
		});
		audit.append({
			subject: by,
			action: `quota.request.${input.action}`,
			target: id,
			detail: {
				...(input.mode ? { mode: input.mode } : {}),
				granted_credits: input.action === "approve" ? granted : null,
			},
		});
		return requestView(row);
	}

	return {
		stateFor,

		/**
		 * send 受理点扣费：先挡超限（403 `quota_exceeded`，不写账本），再幂等插账本。
		 * 带 `client_message_id` 的重放（同 turn 重试）不重复扣、也不因已耗尽而误拒。
		 */
		chargeTurn(input: {
			subjectId: string;
			agentSlug: string;
			sessionId: string;
			clientMessageId?: string;
			enforceLimit?: boolean;
		}) {
			const now = new Date();
			if (input.clientMessageId && store.turnExists(input.sessionId, input.clientMessageId)) return;
			const state = stateFor(input.subjectId, now);
			if (input.enforceLimit !== false && !state.unlimited && state.remaining < 1) {
				throw new KitError(
					"quota_exceeded",
					`本月 Credits 已用完（${state.used}/${state.limit}），可到「我的用量」申请提额，或等待 ${state.reset_at.slice(0, 10)} 重置`,
					{
						details: {
							month: state.month,
							limit: state.limit,
							used: state.used,
							remaining: state.remaining,
							reset_at: state.reset_at,
						},
					},
				);
			}
			store.chargeTurn({
				subjectId: input.subjectId,
				agentSlug: input.agentSlug,
				sessionId: input.sessionId,
				...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
				day: dayKey(now),
				month: state.month,
			});
		},

		plazaView(subjectId: string, query: { category?: PlazaCategory; q?: string } = {}): PlazaView {
			const now = new Date();
			const listed = catalog.listed();
			const mineSessions = sessionIndex.listForSubject(subjectId, { limit: 1000 });
			const mine = new Map<string, string>();
			for (const s of mineSessions) {
				const at = s.last_event_at ?? s.created_at;
				const prev = mine.get(s.agent_slug);
				if (!prev || at > prev) mine.set(s.agent_slug, at);
			}
			const turns30 = new Map(store.turns30dByAgent(daysAgoKey(now, 29)).map((r) => [r.agent_slug, r.turns]));

			const entries = listed.map((agent) => ({
				...agent,
				// AgentSummary 契约里 capabilities 必填；目录视图里是可选（历史行兜底全开）
				capabilities: agent.capabilities ?? {
					streaming: true,
					fileUpload: true,
					artifacts: true,
					threads: true,
					reasoning: true,
				},
				stats: {
					mine: mine.has(agent.slug),
					turns_30d: turns30.get(agent.slug) ?? 0,
					...(mine.get(agent.slug) ? { last_used_at: mine.get(agent.slug) } : {}),
				},
			}));

			const categories = (Object.keys(PLAZA_CATEGORY_LABELS) as PlazaCategory[]).map((id) => ({
				id,
				name: PLAZA_CATEGORY_LABELS[id],
				count: listed.filter((a) => a.category === id).length,
			}));

			const keyword = query.q?.trim().toLowerCase();
			const agents = entries.filter((entry) => {
				if (query.category && entry.category !== query.category) return false;
				if (!keyword) return true;
				return [entry.slug, entry.display_name, entry.description ?? ""].some((field) =>
					field.toLowerCase().includes(keyword as string),
				);
			});

			const featured = listed.filter((a) => a.featured).map((a) => a.slug);
			const withUsage = entries.filter((e) => e.stats.turns_30d > 0);
			const popularSource = withUsage.length > 0 ? withUsage : entries;
			const popular = [...popularSource]
				.sort((a, b) => b.stats.turns_30d - a.stats.turns_30d || a.ordering - b.ordering)
				.slice(0, 5)
				.map((e) => e.slug);

			return { agents, featured, popular, categories };
		},

		quotaView(subjectId: string, days = 30): QuotaView {
			const now = new Date();
			const state = stateFor(subjectId, now);
			const fromDay = daysAgoKey(now, days - 1);
			const dailyMap = new Map(store.dailyTurns(subjectId, fromDay).map((r) => [r.day, r.turns]));
			const daily: { day: string; turns: number }[] = [];
			for (let i = days - 1; i >= 0; i--) {
				const day = daysAgoKey(now, i);
				daily.push({ day, turns: dailyMap.get(day) ?? 0 });
			}
			return {
				month: state.month,
				reset_at: state.reset_at,
				unlimited: state.unlimited,
				base_limit: state.base_limit,
				override_limit: state.override_limit,
				packs: state.packs,
				limit: state.limit,
				used: state.used,
				remaining: state.remaining,
				per_agent: store.turnsByAgentForMonth(subjectId, state.month),
				daily,
				pending_request: store.pendingRequest(subjectId) ? requestView(store.pendingRequest(subjectId)!) : null,
			};
		},

		createRequest(subjectId: string, input: { requestedCredits: number; reason?: string }): QuotaRequestView {
			if (store.pendingRequest(subjectId)) {
				throw new KitError("request_pending", "已有一条待审批的提额申请，请等审批完成后再提交");
			}
			const row = store.createRequest({
				id: `qr_${randomUUID().slice(0, 8)}`,
				subjectId,
				requestedCredits: input.requestedCredits,
				...(input.reason ? { reason: input.reason } : {}),
			});
			audit.append({
				subject: `user:${subjectId}`,
				action: "quota.request.create",
				target: row.id,
				detail: { requested_credits: input.requestedCredits },
			});
			return requestView(row);
		},
		myRequests(subjectId: string): QuotaRequestView[] {
			return store.listRequestsForSubject(subjectId).map(requestView);
		},

		/** ---- 管理端 ---- */
		policy(): QuotaPolicyView {
			const row = store.getPolicy();
			return {
				monthly_credits: row.monthly_credits,
				...(row.updated_at ? { updated_at: row.updated_at } : {}),
				...(row.updated_by ? { updated_by: row.updated_by } : {}),
			};
		},
		putPolicy(monthlyCredits: number, by: string): QuotaPolicyView {
			const row = store.setPolicy(monthlyCredits, by);
			audit.append({ subject: by, action: "quota.policy.put", detail: { monthly_credits: monthlyCredits } });
			return {
				monthly_credits: row.monthly_credits,
				...(row.updated_at ? { updated_at: row.updated_at } : {}),
				...(row.updated_by ? { updated_by: row.updated_by } : {}),
			};
		},
		overrides(): QuotaOverrideView[] {
			const month = monthKey(new Date());
			return store.listOverrides().map((row) => {
				const packs = store.listPacks(row.subject_id, month).map(packView);
				const packTotal = packs.reduce((sum, p) => sum + p.credits, 0);
				const used = store.usedForMonth(row.subject_id, month);
				return {
					subject_id: row.subject_id,
					monthly_credits: row.monthly_credits,
					...(row.reason ? { reason: row.reason } : {}),
					updated_by: row.updated_by,
					updated_at: row.updated_at,
					used,
					packs,
					remaining: row.monthly_credits === -1 ? -1 : row.monthly_credits + packTotal - used,
				};
			});
		},
		putOverride(input: { subjectId: string; monthlyCredits: number; reason?: string }, by: string): QuotaOverrideView {
			const row = store.setOverride({
				subjectId: input.subjectId,
				monthlyCredits: input.monthlyCredits,
				...(input.reason ? { reason: input.reason } : {}),
				by,
			});
			audit.append({
				subject: by,
				action: "quota.override.put",
				target: input.subjectId,
				detail: { monthly_credits: input.monthlyCredits },
			});
			return (
				this.overrides().find((o) => o.subject_id === input.subjectId) ?? {
					subject_id: row.subject_id,
					monthly_credits: row.monthly_credits,
					...(row.reason ? { reason: row.reason } : {}),
					updated_by: row.updated_by,
					updated_at: row.updated_at,
					used: 0,
					packs: [],
					remaining: row.monthly_credits,
				}
			);
		},
		deleteOverride(subjectId: string, by: string): boolean {
			const removed = store.deleteOverride(subjectId);
			if (removed) audit.append({ subject: by, action: "quota.override.delete", target: subjectId });
			return removed;
		},
		createPack(input: { subjectId: string; credits: number; reason?: string }, by: string): QuotaPackView {
			const row = store.addPack({
				id: `qp_${randomUUID().slice(0, 8)}`,
				subjectId: input.subjectId,
				month: monthKey(new Date()),
				credits: input.credits,
				...(input.reason ? { reason: input.reason } : {}),
				by,
			});
			audit.append({
				subject: by,
				action: "quota.pack.create",
				target: input.subjectId,
				detail: { credits: input.credits, month: row.month },
			});
			return packView(row);
		},
		deletePack(id: string, by: string): boolean {
			const removed = store.deletePack(id);
			if (removed) audit.append({ subject: by, action: "quota.pack.delete", target: id });
			return removed;
		},
		requests(status?: "pending" | "approved" | "rejected"): QuotaRequestView[] {
			return store.listRequests(status).map(requestView);
		},
		review(
			id: string,
			input: { action: "approve" | "reject"; mode?: "override" | "pack"; grantedCredits?: number; note?: string },
			by: string,
		): QuotaRequestView {
			const current = store.getRequest(id);
			if (!current) throw new KitError("not_found", "申请不存在");
			if (current.status !== "pending") throw new KitError("conflict", "该申请已审批过，不能重复处理");
			assertReviewInput(input);
			const granted = input.grantedCredits ?? current.requested_credits;
			if (input.action === "approve") applyApproval(current, input.mode as "override" | "pack", granted, by);
			return finalizeReview(id, input, granted, by);
		},
		usage(month?: string): QuotaUsageRow[] {
			const key = month ?? monthKey(new Date());
			const policy = store.getPolicy();
			return store.subjectUsageForMonth(key).map((row) => {
				const override = store.getOverride(row.subject_id);
				const limit = override?.monthly_credits ?? policy.monthly_credits;
				const packTotal = store.listPacks(row.subject_id, key).reduce((sum, p) => sum + p.credits, 0);
				return {
					subject_id: row.subject_id,
					used: row.used,
					limit,
					remaining: limit === -1 ? -1 : limit + packTotal - row.used,
				};
			});
		},
	};
}
export type QuotaService = ReturnType<typeof createQuotaService>;
