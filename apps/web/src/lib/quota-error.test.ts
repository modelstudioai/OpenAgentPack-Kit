import { KitError, type MemberUsageLimitView } from "@openagentpack/kit-sdk/protocol";
import { describe, expect, it } from "vitest";
import { readQuotaExceeded, usageLimitsAllowSending } from "./quota-error.ts";

const details = { month: "2026-10", used: 120, limit: 100, remaining: -20, reset_at: "2026-11-01T00:00:00Z" };
const view = (): MemberUsageLimitView => ({
	member_id: "member-a",
	month: "2026-10",
	reset_at: details.reset_at,
	limits: { monthly_tokens: 100, monthly_active_seconds: 60, daily_tokens: null, daily_active_seconds: null },
	override: null,
	tokens: { limit: 100, used: 10, remaining: 90, status: "ok" },
	active_seconds: { limit: 60, used: 5, remaining: 55, status: "ok" },
	day_state: {
		day: "2026-10-26",
		reset_at: "2026-10-27T00:00:00Z",
		tokens: { limit: null, used: 10, remaining: null, status: "ok" },
		active_seconds: { limit: null, used: 1, remaining: null, status: "ok" },
	},
	accounting_started_at: "2026-10-26T00:00:00Z",
	daily: [],
});

describe("发送限额错误与恢复", () => {
	it("保留 Token 与秒数单位，并兼容没有 metric 的 Credits 错误", () => {
		for (const metric of [undefined, "tokens", "active_seconds"] as const) {
			const error = new KitError("quota_exceeded", "额度不足", { details: { ...details, metric } });
			expect(readQuotaExceeded(error)).toEqual({ ...details, ...(metric ? { metric } : {}) });
		}
	});

	it("未知单位与无效数值不会被解释为可恢复额度不足", () => {
		for (const patch of [{ metric: "other" }, { used: Number.NaN }, { limit: Infinity }, { reset_at: null }]) {
			expect(
				readQuotaExceeded(new KitError("quota_exceeded", "失败", { details: { ...details, ...patch } })),
			).toBeNull();
		}
		expect(readQuotaExceeded(new KitError("provider_error", "采集失败", { details }))).toBeNull();
	});

	it("日度限额错误透传 period，日维度超限或不可确认时禁止发送", () => {
		const dayDetails = {
			day: "2026-10-26",
			period: "day" as const,
			used: 120,
			limit: 100,
			remaining: -20,
			reset_at: "2026-10-27T00:00:00Z",
			metric: "tokens" as const,
		};
		const error = new KitError("quota_exceeded", "额度不足", { details: dayDetails });
		// month 字段为月度错误的兼容键；日度错误无 month，banner 只使用 reset_at 展示。
		expect(readQuotaExceeded(error)).toEqual({ ...dayDetails, month: "" });
		const blocked = view();
		blocked.limits.daily_tokens = 100;
		blocked.day_state.tokens = { limit: 100, used: 120, remaining: -20, status: "exceeded" };
		expect(usageLimitsAllowSending(blocked)).toBe(false);
		blocked.day_state.tokens = { limit: 100, used: null, remaining: null, status: "unavailable" };
		expect(usageLimitsAllowSending(blocked)).toBe(false);
		blocked.day_state.tokens = { limit: 100, used: 10, remaining: 90, status: "ok" };
		expect(usageLimitsAllowSending(blocked)).toBe(true);
	});

	it("所有启用指标都恢复后才允许发送，不因另一个指标采集失败而误解禁", () => {
		const current = view();
		expect(usageLimitsAllowSending(current)).toBe(true);
		for (const metric of ["tokens", "active_seconds"] as const) {
			for (const status of ["exceeded", "unavailable"] as const) {
				const blocked = view();
				blocked[metric].status = status;
				expect(usageLimitsAllowSending(blocked)).toBe(false);
			}
		}
		current.tokens = { limit: null, used: null, remaining: null, status: "unavailable" };
		current.limits.monthly_tokens = null;
		expect(usageLimitsAllowSending(current)).toBe(true);
		current.limits.monthly_active_seconds = 0;
		current.active_seconds = { limit: 0, used: 0, remaining: 0, status: "exceeded" };
		expect(usageLimitsAllowSending(current)).toBe(false);
	});
});
