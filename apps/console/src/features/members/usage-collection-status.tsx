import type { MemberUsageSummary } from "@openagentpack/kit-sdk/protocol";

import styles from "./members.module.less";

export function UsageCollectionStatus({ summary }: { summary?: MemberUsageSummary }) {
	const labels = {
		idle: summary?.session_count ? "已采集" : "暂无会话",
		refreshing: "采集中…",
		partial: "部分统计，可能含旧数据",
		failed: "采集失败",
	};
	return (
		<div className={styles.statusRoot}>
			<span role="status" aria-label="用量采集状态">
				{summary ? labels[summary.refresh_status] : "待获取"}
			</span>{" "}
			<span className={styles.statusTime}>
				{summary?.refreshed_at ? (
					<>
						最近成功采集：
						<time dateTime={summary.refreshed_at}>
							{new Date(summary.refreshed_at).toLocaleString("zh-CN", { hour12: false })}
						</time>
					</>
				) : (
					"尚未成功采集"
				)}
			</span>
		</div>
	);
}
