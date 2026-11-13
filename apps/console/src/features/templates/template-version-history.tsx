import { EmptyState, ErrorState } from "@openagentpack/kit-chat-ui";
import { PLAZA_CATEGORY_LABELS, type TemplateVersionSummary } from "@openagentpack/kit-sdk/protocol";
import { type ReactNode, useId, useMemo, useState } from "react";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import { ghostButtonClass } from "../../lib/styles.ts";
import styles from "./template-resources.module.less";

const PAGE_SIZE = 20;

function useTemplateVersions(templateId: string) {
	const client = useMemo(getAdminClient, []);
	const [cursors, setCursors] = useState([""]);
	const cursor = cursors.at(-1) || undefined;
	const versions = useAdminQuery(`templates:versions:${templateId}:${cursor ?? ""}`, (signal) =>
		client.templates.versions(templateId, { limit: PAGE_SIZE, page_token: cursor }, signal),
	);
	const loading = versions.loading || (!versions.data && !versions.error);
	const rows = !loading && !versions.error ? (versions.data?.data ?? []) : [];
	const nextCursor = !versions.error ? versions.data?.next_page_token : undefined;
	return { versions, cursors, setCursors, loading, rows, nextCursor };
}

export function TemplateVersionHistory({
	templateId,
	selectedVersion,
	onSelect,
}: {
	templateId: string;
	selectedVersion?: number;
	onSelect: (version: number) => void;
}) {
	const { versions, cursors, setCursors, loading, rows, nextCursor } = useTemplateVersions(templateId);
	return (
		<section aria-label="模版版本列表" className={styles.historyRoot}>
			<h3 className={styles.listHeading}>版本列表</h3>
			{loading ? <EmptyState loading title="正在加载版本列表…" /> : null}
			{versions.error ? <ErrorState message={versions.error} onRetry={() => void versions.refresh()} /> : null}
			{!loading && !versions.error && rows.length === 0 ? <EmptyState title="暂无版本记录" /> : null}
			{rows.length ? (
				<ol aria-label="模版版本时间线" className={styles.shrinkRoot}>
					{rows.map((version) => (
						<VersionRow
							key={version.version}
							version={version}
							current={version.version === versions.data?.current_version}
							selected={version.version === selectedVersion}
							onSelect={() => onSelect(version.version)}
						/>
					))}
				</ol>
			) : null}
			{cursors.length > 1 || nextCursor ? (
				<nav aria-label="模版版本分页" className={styles.pagerEnd}>
					<button
						type="button"
						className={ghostButtonClass}
						disabled={loading || cursors.length === 1}
						onClick={() => setCursors((current) => current.slice(0, -1))}
					>
						上一页
					</button>
					<span>第 {cursors.length} 页</span>
					<button
						type="button"
						className={ghostButtonClass}
						disabled={loading || !nextCursor}
						onClick={() => {
							if (nextCursor) setCursors((current) => [...current, nextCursor]);
						}}
					>
						下一页
					</button>
				</nav>
			) : null}
		</section>
	);
}

function VersionRow({
	version,
	current,
	selected,
	onSelect,
}: {
	version: TemplateVersionSummary;
	current: boolean;
	selected: boolean;
	onSelect: () => void;
}) {
	const summaryId = useId();
	return (
		<li className={styles.timelineRow}>
			<span aria-hidden="true" className={`${styles.timelineLine} ${styles.timelineLineKit}`} />
			<span
				aria-hidden="true"
				className={
					selected
						? `${styles.timelineDot} ${styles.timelineDotKitOn}`
						: `${styles.timelineDot} ${styles.timelineDotKit}`
				}
			/>
			<button
				type="button"
				aria-label={`查看模版版本 v${version.version}`}
				aria-describedby={summaryId}
				aria-pressed={selected}
				className={selected ? `${styles.versionRowCard} ${styles.versionRowSelected}` : styles.versionRowCard}
				onClick={onSelect}
			>
				<span className={styles.headRow}>
					<span className={styles.versionLabel}>v{version.version}</span>
					{current ? <span className={styles.currentBadge}>当前版本</span> : null}
				</span>
				<span className={styles.blockNameAny}>{version.name}</span>
				<span className={styles.blockCaptionAny}>
					保存时间：
					<VersionTime value={version.created_at} />
				</span>
				<span id={summaryId} className={styles.summaryBlock}>
					<VersionConfigurationSummary version={version} />
				</span>
			</button>
		</li>
	);
}

function SummaryPoint({ children }: { children: ReactNode }) {
	return (
		<span className={styles.summaryPoint}>
			<span aria-hidden="true" className={styles.shrinkZero}>
				•
			</span>
			<span className={`${styles.shrinkRoot} ${styles.wrapAnywhere}`}>{children}</span>
		</span>
	);
}

function VersionConfigurationSummary({ version }: { version: TemplateVersionSummary }) {
	const agentVersion =
		version.agent_version !== undefined
			? `版本：v${version.agent_version}`
			: version.remote_agent_version !== undefined
				? `版本：v${version.remote_agent_version}`
				: "版本：未记录";
	return (
		<>
			<span className={styles.summaryGroup}>
				<span className={styles.blockMedium}>智能体</span>
				<SummaryPoint>
					{version.remote_agent_name || version.remote_agent_id}（{agentVersion}）
				</SummaryPoint>
			</span>
			<span className={styles.summaryGroup}>
				<span className={styles.blockMedium}>运行时配置</span>
				<SummaryPoint>
					环境：
					{version.remote_environment_id
						? version.remote_environment_name || version.remote_environment_id
						: "使用智能体默认环境"}
				</SummaryPoint>
				<SummaryPoint>
					文件：{version.files.map((file) => file.filename || file.file_id).join("、") || "未选择"}
				</SummaryPoint>
				<SummaryPoint>
					记忆库：
					{version.memory_stores
						.map((memory) => `${memory.memory_store_id}（${memory.access === "read_only" ? "只读" : "读写"}）`)
						.join("、") || "未选择"}
				</SummaryPoint>
				<SummaryPoint>密钥库：{version.vault_ids.join("、") || "未选择"}</SummaryPoint>
			</span>
			<span className={styles.summaryGroup}>
				<span className={styles.blockMedium}>展示配置</span>
				<SummaryPoint>分类：{PLAZA_CATEGORY_LABELS[version.category]}</SummaryPoint>
			</span>
		</>
	);
}

function VersionTime({ value }: { value: string }) {
	return <time dateTime={value}>{new Date(value).toLocaleString("zh-CN", { hour12: false })}</time>;
}
