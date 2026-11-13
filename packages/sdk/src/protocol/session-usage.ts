import { z } from "zod";

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const seconds = z.number().nonnegative().finite();

/** Provider 的会话累计快照；缺省表示未返回，不能视为零。 */
export const SessionUsageSchema = z.object({
	input_tokens: counter.optional(),
	output_tokens: counter.optional(),
	cache_read_input_tokens: counter.optional(),
	cache_creation_input_tokens: counter.optional(),
});
export type SessionUsage = z.infer<typeof SessionUsageSchema>;
export const SessionStatsSchema = z.object({
	active_seconds: seconds.optional(),
	duration_seconds: seconds.optional(),
});
export type SessionStats = z.infer<typeof SessionStatsSchema>;
export const SESSION_USAGE_METRICS = [
	"input_tokens",
	"output_tokens",
	"cache_read_input_tokens",
	"cache_creation_input_tokens",
	"active_seconds",
	"duration_seconds",
] as const;
export type SessionUsageMetric = (typeof SESSION_USAGE_METRICS)[number];
export const UsageMetricSummarySchema = z.object({
	value: z.number().nonnegative().nullable(),
	covered_sessions: z.number().int().nonnegative(),
});
export const MemberUsageSummarySchema = z.object({
	session_count: z.number().int().nonnegative(),
	deleted_session_count: z.number().int().nonnegative(),
	metrics: z.object({
		input_tokens: UsageMetricSummarySchema,
		output_tokens: UsageMetricSummarySchema,
		cache_read_input_tokens: UsageMetricSummarySchema,
		cache_creation_input_tokens: UsageMetricSummarySchema,
		active_seconds: UsageMetricSummarySchema,
		duration_seconds: UsageMetricSummarySchema,
	}),
	/** 始终包含成员全部 Agent，供筛选器使用，包含保留的已删除会话。 */
	agents: z.array(z.string()),
	refreshed_at: z.string().optional(),
	refresh_status: z.enum(["idle", "refreshing", "partial", "failed"]),
	completed_sessions: z.number().int().nonnegative(),
});
export type MemberUsageSummary = z.infer<typeof MemberUsageSummarySchema>;
/** 以模版为主键的用量行：归属该模版绑定智能体的全部体验会话（含其上架条目）。 */
export const TemplateUsageRowSchema = z.object({
	template_id: z.string(),
	name: z.string(),
	/** 模版绑定的智能体展示名。 */
	remote_agent_name: z.string(),
	/** 模版绑定的 Provider 智能体 ID；管理端用它按 agent_id 过滤模型/工具用量明细。 */
	remote_agent_id: z.string(),
	listing_status: z.enum(["listed", "unlisted"]),
	session_count: z.number().int().nonnegative(),
	deleted_session_count: z.number().int().nonnegative(),
	metrics: MemberUsageSummarySchema.shape.metrics,
	refreshed_at: z.string().optional(),
});
export type TemplateUsageRow = z.infer<typeof TemplateUsageRowSchema>;
export const TemplateUsagePageSchema = z.object({ data: z.array(TemplateUsageRowSchema) });
export type TemplateUsagePage = z.infer<typeof TemplateUsagePageSchema>;
export const MemberSessionUsageSchema = z.object({
	session_id: z.string(),
	member_id: z.string(),
	agent_slug: z.string(),
	title: z.string().optional(),
	status: z.string().optional(),
	created_at: z.string(),
	deleted_at: z.string().optional(),
	usage: SessionUsageSchema.optional(),
	stats: SessionStatsSchema.optional(),
	captured_at: z.string().optional(),
	collection_status: z.enum(["pending", "complete", "partial", "failed", "not_found"]),
});
export type MemberSessionUsage = z.infer<typeof MemberSessionUsageSchema>;
export const MemberUsageQuerySchema = z.object({
	agent_slug: z.string().min(1).max(128).optional(),
	refresh: z.literal("1").optional(),
});
export type MemberUsageQuery = z.infer<typeof MemberUsageQuerySchema>;
export const MemberUsageResponseSchema = z.object({ data: MemberUsageSummarySchema });
export const MemberSessionsQuerySchema = z.object({
	agent_slug: z.string().min(1).max(128).optional(),
	cursor: z.string().max(2048).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type MemberSessionsQuery = z.infer<typeof MemberSessionsQuerySchema>;
export const MemberSessionsPageSchema = z.object({
	data: z.array(MemberSessionUsageSchema),
	next_cursor: z.string().optional(),
});
export type MemberSessionsPage = z.infer<typeof MemberSessionsPageSchema>;
/** 模版维度的会话用量明细：行附带成员公开资料，跨成员按该模版上架条目过滤。 */
export const TemplateSessionUsageSchema = MemberSessionUsageSchema.extend({
	member_display_name: z.string(),
	member_username: z.string(),
});
export type TemplateSessionUsage = z.infer<typeof TemplateSessionUsageSchema>;
export const TemplateSessionsPageSchema = z.object({
	data: z.array(TemplateSessionUsageSchema),
	next_cursor: z.string().optional(),
});
export type TemplateSessionsPage = z.infer<typeof TemplateSessionsPageSchema>;

/** 模版逐日趋势点：限额账本条目逐日账的当日增量合计（tokens 为输入+输出 Token 增量）。 */
export const TemplateUsageTrendPointSchema = z.object({
	day: z.string(),
	tokens: counter,
	active_seconds: seconds,
});
export type TemplateUsageTrendPoint = z.infer<typeof TemplateUsageTrendPointSchema>;
/** 模版用量逐日趋势：条目逐日账自模版限额账本启用后开始记录（增量归因采集确认日），不含更早历史；零值补全到今天（UTC 日键）。 */
export const TemplateUsageTrendSchema = z.object({
	days: z.number().int(),
	from_day: z.string(),
	to_day: z.string(),
	/** 逐日账最早记录日（前端标注数据起点）；区间内无记录时为 null。 */
	since_day: z.string().nullable(),
	data: z.array(TemplateUsageTrendPointSchema),
});
export type TemplateUsageTrend = z.infer<typeof TemplateUsageTrendSchema>;

/** ---- Provider 侧用量明细（app-control usage.*），形状对齐 @openagentpack/sdk 公开契约 ---- */

export const UsageTimeRangeSchema = z.object({
	start_time: z.number().int().nonnegative(),
	end_time: z.number().int().nonnegative(),
});
export type UsageTimeRange = z.infer<typeof UsageTimeRangeSchema>;

export const ModelUsageSortBySchema = z.enum(["call_count", "failed_count", "input_tokens", "output_tokens"]);
export type ModelUsageSortBy = z.infer<typeof ModelUsageSortBySchema>;
export const ToolUsageSortBySchema = z.enum(["call_count", "failed_count"]);
export type ToolUsageSortBy = z.infer<typeof ToolUsageSortBySchema>;
export const UsageToolSourceSchema = z.enum(["builtin", "mcp", "custom"]);
export type UsageToolSource = z.infer<typeof UsageToolSourceSchema>;

export const ModelUsageTokenStatsSchema = z.object({
	input_tokens: z.number(),
	output_tokens: z.number(),
	cache_read_tokens: z.number(),
	cache_creation_tokens: z.number(),
	/** 输入 + 输出合计，不重复累加缓存 Token。 */
	total_tokens: z.number(),
	/** 取值 [0,1]；输入总量为 0 时为 0。 */
	cache_hit_ratio: z.number(),
});
export type ModelUsageTokenStats = z.infer<typeof ModelUsageTokenStatsSchema>;

export const ModelUsageItemSchema = z.object({
	workspace_id: z.string(),
	model_name: z.string(),
	call_count: z.number().int().nonnegative(),
	failed_count: z.number().int().nonnegative(),
	tokens: ModelUsageTokenStatsSchema,
});
export type ModelUsageItem = z.infer<typeof ModelUsageItemSchema>;

export const ToolUsageItemSchema = z.object({
	workspace_id: z.string(),
	tool_name: z.string(),
	/** builtin | mcp | custom；未知来源原样保留。 */
	source: z.string(),
	call_count: z.number().int().nonnegative(),
	failed_count: z.number().int().nonnegative(),
});
export type ToolUsageItem = z.infer<typeof ToolUsageItemSchema>;

const UsagePageShape = {
	/** 总行数（分页计数）。 */
	total: z.number().int().nonnegative(),
	/** 总调用次数（标题口径，不随分页变化）。 */
	total_call_count: z.number().int().nonnegative(),
	page_no: z.number().int().min(1),
	page_size: z.number().int().min(1),
	data_updated_at: z.number(),
} as const;

export const ModelUsagePageSchema = z.object({
	items: z.array(ModelUsageItemSchema),
	...UsagePageShape,
});
export type ModelUsagePage = z.infer<typeof ModelUsagePageSchema>;

export const ToolUsagePageSchema = z.object({
	items: z.array(ToolUsageItemSchema),
	...UsagePageShape,
});
export type ToolUsagePage = z.infer<typeof ToolUsagePageSchema>;
