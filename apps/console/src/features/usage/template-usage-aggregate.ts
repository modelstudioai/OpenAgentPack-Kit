import type { TemplateUsageRow } from "@openagentpack/kit-sdk/protocol";

/** 聚合单个指标：value 只汇总非缺失值（全部缺失才为 null，不按 0 计算），覆盖会话数直接求和。 */
function aggregateMetric(
	rows: TemplateUsageRow[],
	key: keyof TemplateUsageRow["metrics"],
): TemplateUsageRow["metrics"]["input_tokens"] {
	const values = rows.map((row) => row.metrics[key]);
	const known = values.filter((metric) => metric.value !== null);
	return {
		value: known.length ? known.reduce((sum, metric) => sum + (metric.value ?? 0), 0) : null,
		covered_sessions: values.reduce((sum, metric) => sum + metric.covered_sessions, 0),
	};
}

/** 「全部」视角的聚合行：数值列跨模版求和，采集时间取最近一次；身份字段仅占位，由聚合卡片单独渲染。 */
export function aggregateTemplateRows(rows: TemplateUsageRow[]): TemplateUsageRow {
	const refreshed = rows
		.map((row) => row.refreshed_at)
		.filter((value): value is string => Boolean(value))
		.sort()
		.at(-1);
	return {
		template_id: "",
		name: "全部模版",
		remote_agent_name: "",
		remote_agent_id: "",
		listing_status: "unlisted",
		session_count: rows.reduce((sum, row) => sum + row.session_count, 0),
		deleted_session_count: rows.reduce((sum, row) => sum + row.deleted_session_count, 0),
		metrics: {
			input_tokens: aggregateMetric(rows, "input_tokens"),
			output_tokens: aggregateMetric(rows, "output_tokens"),
			cache_read_input_tokens: aggregateMetric(rows, "cache_read_input_tokens"),
			cache_creation_input_tokens: aggregateMetric(rows, "cache_creation_input_tokens"),
			active_seconds: aggregateMetric(rows, "active_seconds"),
			duration_seconds: aggregateMetric(rows, "duration_seconds"),
		},
		...(refreshed ? { refreshed_at: refreshed } : {}),
	};
}
