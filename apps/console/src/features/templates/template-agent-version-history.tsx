import { Alert, Button, Spin } from "antd";
import { type ReactNode, useId, useMemo, useState } from "react";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import { AgentVersionConfigurationView } from "./agent-version-configuration-view.tsx";
import styles from "./template-resources.module.less";

/** 只读取展开版本的配置，浏览历史不会修改向导的运行绑定。 */
export function TemplateAgentVersionHistory({
	agentId,
	versions,
	selectedVersion,
	latestVersion,
	status,
	onSelect,
}: {
	agentId: string;
	versions: number[];
	selectedVersion?: number;
	latestVersion?: number;
	status: ReactNode;
	onSelect: (version: number) => void;
}) {
	const [expandedVersion, setExpandedVersion] = useState<number | null | undefined>(selectedVersion);
	const expanded = expandedVersion === undefined ? versions[0] : expandedVersion;
	return (
		<section aria-label="智能体版本列表" className={styles.historyRoot}>
			{status}
			<ol aria-label="智能体版本时间线" className={styles.shrinkRoot}>
				{versions.map((version) => (
					<VersionRow
						key={version}
						agentId={agentId}
						version={version}
						selected={selectedVersion === version}
						latest={latestVersion === version}
						expanded={expanded === version}
						onExpand={() => setExpandedVersion(expanded === version ? null : version)}
						onSelect={() => onSelect(version)}
					/>
				))}
			</ol>
		</section>
	);
}

function VersionRow({
	agentId,
	version,
	selected,
	latest,
	expanded,
	onExpand,
	onSelect,
}: {
	agentId: string;
	version: number;
	selected: boolean;
	latest: boolean;
	expanded: boolean;
	onExpand: () => void;
	onSelect: () => void;
}) {
	const contentId = useId();
	return (
		<li aria-label={`智能体版本 v${version}`} className={styles.timelineRow}>
			<span aria-hidden="true" className={styles.timelineLine} />
			<span
				aria-hidden="true"
				className={selected ? `${styles.timelineDot} ${styles.timelineDotOn}` : styles.timelineDot}
			/>
			<div className={selected ? `${styles.versionCard} ${styles.versionCardSelected}` : styles.versionCard}>
				<button
					type="button"
					aria-label={`查看智能体版本 v${version}`}
					aria-expanded={expanded}
					aria-controls={contentId}
					onClick={onExpand}
					className={styles.versionButton}
				>
					<span className={styles.versionLabel}>v{version}</span>
					{latest ? <VersionTag>最新</VersionTag> : null}
					{selected ? <VersionTag>已选择</VersionTag> : null}
					<span className={styles.versionToggle}>{expanded ? "收起配置" : "查看配置"}</span>
				</button>
				<div id={contentId} hidden={!expanded}>
					{expanded ? (
						<VersionConfiguration
							key={`${agentId}:${version}`}
							agentId={agentId}
							version={version}
							onSelect={onSelect}
						/>
					) : null}
				</div>
			</div>
		</li>
	);
}

function VersionTag({ children }: { children: ReactNode }) {
	return <span className={styles.versionTag}>{children}</span>;
}

function VersionConfiguration({
	agentId,
	version,
	onSelect,
}: {
	agentId: string;
	version: number;
	onSelect: () => void;
}) {
	const client = useMemo(getAdminClient, []);
	const detail = useAdminQuery(`templates:agent-version:${agentId}:${version}`, (signal) =>
		client.remoteAgentVersion(agentId, version, signal),
	);
	const loading = detail.loading || (!detail.data && !detail.error);
	return (
		<div className={styles.versionConfig}>
			{loading ? (
				<div role="status" className={styles.loadingRow}>
					<Spin />
				</div>
			) : detail.error ? (
				<Alert
					type="error"
					showIcon
					message={detail.error}
					action={
						<Button size="small" onClick={() => void detail.refresh()}>
							重试
						</Button>
					}
				/>
			) : detail.data ? (
				<>
					{detail.data.created_at ? (
						<p className={styles.metaAny}>
							创建时间：
							<time dateTime={detail.data.created_at}>
								{new Date(detail.data.created_at).toLocaleString("zh-CN", { hour12: false })}
							</time>
						</p>
					) : null}
					<AgentVersionConfigurationView detail={detail.data} />
				</>
			) : null}
			<div className={styles.rowEnd}>
				<Button type="primary" disabled={loading || Boolean(detail.error) || !detail.data} onClick={onSelect}>
					使用版本 v{version}
				</Button>
			</div>
		</div>
	);
}
