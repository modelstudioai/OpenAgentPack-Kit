import type { MemberSessionUsage, MemberUsageSummary } from "@openagentpack/kit-sdk/protocol";

import styles from "./members.module.less";

export const collectionLabels: Record<MemberSessionUsage["collection_status"], string> = {
	pending: "待获取",
	complete: "已采集",
	partial: "部分缺失",
	failed: "采集失败",
	not_found: "远端会话不存在",
};

export const usageMetrics = [
	["input_tokens", "输入 Token"],
	["output_tokens", "输出 Token"],
	["cache_read_input_tokens", "缓存读取 Token"],
	["cache_creation_input_tokens", "缓存写入 Token"],
	["active_seconds", "执行时长（秒）"],
	["duration_seconds", "会话时长（秒）"],
] as const;

export function usageValue(
	summary: Pick<MemberUsageSummary, "metrics" | "session_count"> | undefined,
	key: (typeof usageMetrics)[number][0],
) {
	const metric = summary?.metrics[key];
	if (!metric || metric.value === null) return "待获取";
	const value = metric.value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
	return metric.covered_sessions < (summary?.session_count ?? 0) ? `${value}（部分缺失）` : value;
}

export function UsageMetrics({ summary }: { summary: Pick<MemberUsageSummary, "metrics" | "session_count"> }) {
	return (
		<dl className={styles.metricsGrid}>
			{usageMetrics.map(([key, label]) => (
				<div key={key} className={styles.metricCard} data-testid={`usage-${key}`}>
					<dt className={styles.metricLabel}>{label}</dt>
					<dd className={styles.metricValue}>{usageValue(summary, key)}</dd>
					<dd className={styles.metricHint}>
						覆盖 {summary.metrics[key].covered_sessions} / {summary.session_count} 个会话
					</dd>
				</div>
			))}
		</dl>
	);
}
