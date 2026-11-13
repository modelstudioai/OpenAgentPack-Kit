import { z } from "zod";

/** 成员/模版限额；月与日两个周期独立设置，null 表示不限量，0 表示不允许新增消耗。 */
export const UsageLimitConfigSchema = z.object({
	monthly_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
	monthly_active_seconds: z.number().finite().nonnegative().nullable(),
	daily_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().default(null),
	daily_active_seconds: z.number().finite().nonnegative().nullable().default(null),
});
export type UsageLimitConfig = z.infer<typeof UsageLimitConfigSchema>;

export const UsageLimitPolicySchema = z.object({
	limits: UsageLimitConfigSchema,
	updated_at: z.string().optional(),
	updated_by: z.string().optional(),
});
export type UsageLimitPolicy = z.infer<typeof UsageLimitPolicySchema>;

export const UsageLimitMetricStateSchema = z.object({
	limit: z.number().finite().nonnegative().nullable(),
	used: z.number().finite().nonnegative().nullable(),
	remaining: z.number().finite().nullable(),
	status: z.enum(["ok", "exceeded", "unavailable"]),
});
export type UsageLimitMetricState = z.infer<typeof UsageLimitMetricStateSchema>;

/** 今日（UTC 日键）限额状态；limits 取自同一配置的 daily_* 字段。 */
export const UsageLimitDayStateSchema = z.object({
	day: z.string(),
	reset_at: z.string(),
	tokens: UsageLimitMetricStateSchema,
	active_seconds: UsageLimitMetricStateSchema,
});
export type UsageLimitDayState = z.infer<typeof UsageLimitDayStateSchema>;

/** 功能启用后受理执行的累计增量；按本轮开始的 UTC 月归属，不回填历史。 */
export const MemberUsageLimitViewSchema = z.object({
	member_id: z.string(),
	month: z.string(),
	reset_at: z.string(),
	limits: UsageLimitConfigSchema,
	override: UsageLimitConfigSchema.nullable(),
	tokens: UsageLimitMetricStateSchema,
	active_seconds: UsageLimitMetricStateSchema,
	day_state: UsageLimitDayStateSchema,
	accounting_started_at: z.string(),
	refreshed_at: z.string().optional(),
	/** 近 30 天（含今天，UTC 日键升序，零值补全）逐日增量；与月账同事务双写，归因到采集确认日。 */
	daily: z.array(
		z.object({
			day: z.string(),
			tokens: z.number().int().nonnegative(),
			active_seconds: z.number().finite().nonnegative(),
		}),
	),
});
export type MemberUsageLimitView = z.infer<typeof MemberUsageLimitViewSchema>;

/** 模版限额视图：只统计从该模版上架条目发起的会话；未设置覆盖时不限量。 */
export const TemplateUsageLimitViewSchema = z.object({
	template_id: z.string(),
	month: z.string(),
	reset_at: z.string(),
	limits: UsageLimitConfigSchema,
	override: UsageLimitConfigSchema.nullable(),
	tokens: UsageLimitMetricStateSchema,
	active_seconds: UsageLimitMetricStateSchema,
	day_state: UsageLimitDayStateSchema,
	refreshed_at: z.string().optional(),
});
export type TemplateUsageLimitView = z.infer<typeof TemplateUsageLimitViewSchema>;
