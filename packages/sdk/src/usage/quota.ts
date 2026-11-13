import { KitError, type MemberUsageLimitView } from "../protocol/index.ts";
import type { KitClient } from "../providers/kit/client.ts";
import { createObservable, createQuery } from "../state.ts";

/** 服务端发送受理边界返回的额度不足信息；新成员额度使用明确的指标与单位。 */
export interface QuotaExceededDetails {
	month: string;
	limit: number;
	used: number;
	remaining: number;
	reset_at: string;
	metric?: "tokens" | "active_seconds";
	/** 月度错误缺省；日度限额错误为 "day"（details 用 day 键携带日键）。 */
	period?: "month" | "day";
	day?: string;
}

/** 非配额错误或无效 details 回落到普通错误文案，不根据 message 猜测计量方式。 */
export function readQuotaExceeded(error: unknown): QuotaExceededDetails | null {
	if (!(error instanceof KitError) || error.code !== "quota_exceeded") return null;
	const details = error.details as Partial<QuotaExceededDetails> | null | undefined;
	if (!details || typeof details.used !== "number" || typeof details.limit !== "number") return null;
	if (!Number.isFinite(details.used) || !Number.isFinite(details.limit)) return null;
	if (typeof details.reset_at !== "string") return null;
	if (details.metric !== undefined && details.metric !== "tokens" && details.metric !== "active_seconds") return null;
	return {
		month: typeof details.month === "string" ? details.month : "",
		limit: details.limit,
		used: details.used,
		remaining: typeof details.remaining === "number" && Number.isFinite(details.remaining) ? details.remaining : 0,
		reset_at: details.reset_at,
		...(details.metric ? { metric: details.metric } : {}),
		...(details.period ? { period: details.period } : {}),
		...(typeof details.day === "string" ? { day: details.day } : {}),
	};
}

/** 解除发送禁用前，所有启用的指标（月度与日度）都必须由服务端确认可用。 */
export function usageLimitsAllowSending(view: MemberUsageLimitView): boolean {
	return (
		(view.limits.monthly_tokens === null || view.tokens.status === "ok") &&
		(view.limits.monthly_active_seconds === null || view.active_seconds.status === "ok") &&
		(view.limits.daily_tokens === null || view.day_state.tokens.status === "ok") &&
		(view.limits.daily_active_seconds === null || view.day_state.active_seconds.status === "ok")
	);
}

/** Recovery only trusts a fresh server result; failure/unknown state never unlocks sending. */
export function createQuotaRecovery(client: KitClient) {
	const query = createQuery((signal) => client.usageLimits({}, signal));
	const store = createObservable({ loading: false, error: null as string | null, notice: null as string | null });
	const unsubscribe = query.subscribe(() => {
		const state = query.getSnapshot();
		store.set({ ...store.getSnapshot(), loading: state.loading, error: state.error });
	});
	return {
		...store,
		async recheck() {
			store.set({ ...store.getSnapshot(), notice: null });
			const view = await query.refresh();
			if (view && usageLimitsAllowSending(view)) return true;
			if (view !== undefined)
				store.set({ ...store.getSnapshot(), notice: "额度仍不足，或用量尚未确认，请联系管理员或稍后重试。" });
			return false;
		},
		dispose() {
			unsubscribe();
			query.dispose();
		},
	};
}
