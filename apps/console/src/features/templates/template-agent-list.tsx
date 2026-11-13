import type { PresetPackAgentResources } from "@openagentpack/kit-sdk/protocol";
import { Alert, Button, Empty, Input, Spin } from "antd";
import { useState } from "react";
import { type RemoteAgent, useRemoteAgents } from "../catalog/use-remote-agents.ts";
import { TemplateAgentDetailDrawer } from "./template-agent-detail-drawer.tsx";
import { TemplateAgentVersionPicker } from "./template-agent-version-picker.tsx";
import styles from "./template-lists.module.less";
import { type TemplateAgentSelection, useTemplateLocalResources } from "./template-local-resources.tsx";
import { templateResourceCandidates } from "./template-resource-candidates.ts";

/** version 是列表元数据，选择时将默认版本或手选版本写入 agent_version 运行绑定。 */
export type { TemplateAgentSelection } from "./template-local-resources.tsx";

const PAGE_SIZE = 10;

function mergeAgentVersion(local: TemplateAgentSelection, remote: TemplateAgentSelection): TemplateAgentSelection {
	const versions = [local.version, remote.version].filter(
		(version): version is number => version !== undefined && Number.isInteger(version) && version > 0,
	);
	// 发布前读取的远端列表不能把刚发布的候选版本降回旧值；已选具体版本仍由草稿优先。
	return { ...remote, version: versions.length ? Math.max(...versions) : undefined };
}

/** 行：md 起 5 列网格；选中主色浅底 / 未选中 hover 浅灰（原为 cva，拆为组合类）。 */
function rowClass(selected: boolean) {
	return selected ? `${styles.selectRow5} ${styles.selectRowPrimary}` : `${styles.selectRow5} ${styles.selectRowIdle}`;
}

function TemplateAgentRow({
	agent,
	selected,
	version,
	onSelect,
	onDefaultVersion,
	onVersionChange,
}: {
	agent: TemplateAgentSelection;
	selected: boolean;
	version?: number;
	onSelect: (version?: number, resources?: PresetPackAgentResources) => void;
	onDefaultVersion: (version: number) => void;
	onVersionChange: (version: number) => void;
}) {
	const name = agent.name || agent.agent_id;
	return (
		<li className={rowClass(selected)}>
			<TemplateAgentDetailDrawer agent={agent} version={version} selected={selected} onSelect={onSelect} />
			<div className={styles.actionCell}>
				{agent.local ? (
					<span className={styles.metaText}>待发布</span>
				) : (
					<TemplateAgentVersionPicker
						agentId={agent.agent_id}
						agentName={name}
						value={version}
						onDefaultVersion={onDefaultVersion}
						onChange={onVersionChange}
					/>
				)}
			</div>
		</li>
	);
}

/** Provider 全量列表复用既有查询合同；搜索与分页仅改变当前展示，不截断候选集合。 */
export function useTemplateAgentListState(selected: TemplateAgentSelection | null) {
	return {
		search: useState(""),
		page: useState(1),
		versionDrafts: useState<Record<string, number | undefined>>(() =>
			selected ? { [selected.agent_id]: selected.agent_version } : {},
		),
	};
}

export function TemplateAgentList({
	selected,
	state,
	onSelect,
	onVersionChange,
}: {
	selected: TemplateAgentSelection | null;
	state: ReturnType<typeof useTemplateAgentListState>;
	onSelect: (agent: TemplateAgentSelection, resources?: PresetPackAgentResources) => void;
	onVersionChange: (agent: TemplateAgentSelection) => void;
}) {
	const remote = useRemoteAgents();
	const local = useTemplateLocalResources();
	const [search, setSearch] = state.search;
	const [page, setPage] = state.page;
	const [versionDrafts, setVersionDrafts] = state.versionDrafts;
	const versionFor = (agent: RemoteAgent) => {
		const chosen =
			(selected?.agent_id === agent.agent_id ? selected.agent_version : undefined) ?? versionDrafts[agent.agent_id];
		return (
			chosen ??
			(agent.version !== undefined && Number.isInteger(agent.version) && agent.version > 0 ? agent.version : undefined)
		);
	};
	const selectAgent = (
		agent: TemplateAgentSelection,
		version = versionFor(agent),
		resources?: PresetPackAgentResources,
	) => {
		if (agent.local) {
			onSelect(agent);
			return;
		}
		if (version === undefined) return;
		setVersionDrafts((current) => ({ ...current, [agent.agent_id]: version }));
		onSelect({ ...agent, agent_version: version }, resources);
	};
	const changeVersion = (agent: RemoteAgent, version: number) => {
		setVersionDrafts((current) => ({ ...current, [agent.agent_id]: version }));
		if (selected?.agent_id === agent.agent_id) onVersionChange({ ...selected, agent_version: version });
	};
	const query = search.trim().toLowerCase();
	const {
		rows: candidates,
		loading,
		ready,
	} = templateResourceCandidates(local.agents, remote, (item) => item.agent_id, mergeAgentVersion);
	const filtered = candidates.filter((agent) => `${agent.name}\n${agent.agent_id}`.toLowerCase().includes(query));
	const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const currentPage = Math.min(page, pageCount);
	const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
	return (
		<section aria-label="智能体列表" className={styles.tableWrap}>
			<header className={styles.listToolbar2}>
				<div className={styles.searchBox}>
					<Input
						type="search"
						aria-label="搜索智能体"
						placeholder="搜索名称或 ID"
						value={search}
						onChange={(event) => {
							setSearch(event.target.value);
							setPage(1);
						}}
						className={`${styles.shrinkRoot} ${styles.searchInputSm}`}
					/>
				</div>
			</header>
			{loading ? (
				<div role="status" className={styles.loadingRow}>
					<Spin />
				</div>
			) : null}
			{remote.error ? (
				<div className={styles.padBox}>
					<Alert
						type="error"
						showIcon
						message={remote.error}
						action={
							<Button size="small" onClick={() => void remote.refresh()}>
								重试
							</Button>
						}
					/>
				</div>
			) : null}
			{ready && rows.length === 0 ? (
				<Empty
					description={
						<span className={styles.mutedOnly}>
							{query ? "未找到匹配的智能体" : "暂无可选智能体"}
							<br />
							<span className={styles.textXs}>{query ? "请尝试其他名称或 ID。" : "当前服务没有可选智能体。"}</span>
						</span>
					}
				/>
			) : null}
			{ready && rows.length > 0 ? (
				<>
					<div aria-hidden="true" className={styles.tableHead5}>
						<span className={styles.headCol2}>名称</span>
						<span className={styles.headCol2}>ID</span>
						<span>版本</span>
					</div>
					<ul aria-label="智能体列表" className={styles.rowList}>
						{rows.map((agent) => (
							<TemplateAgentRow
								key={agent.agent_id}
								agent={agent}
								selected={selected?.agent_id === agent.agent_id}
								version={versionFor(agent)}
								onSelect={(version, resources) => selectAgent(agent, version, resources)}
								onDefaultVersion={(version) => {
									// 补齐候选只用于后续显式选择，不能把旧模版的浮动绑定静默固定。
									setVersionDrafts((current) => ({ ...current, [agent.agent_id]: version }));
								}}
								onVersionChange={(version) => changeVersion(agent, version)}
							/>
						))}
					</ul>
				</>
			) : null}
			{ready ? (
				<footer className={styles.listFooter}>
					<span>
						共 {filtered.length} 个智能体 · 每页 {PAGE_SIZE} 条
					</span>
					<nav aria-label="智能体列表分页" className={styles.listPager}>
						<Button size="small" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
							上一页
						</Button>
						<span aria-live="polite">
							第 {currentPage} / {pageCount} 页
						</span>
						<Button size="small" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>
							下一页
						</Button>
					</nav>
				</footer>
			) : null}
		</section>
	);
}
