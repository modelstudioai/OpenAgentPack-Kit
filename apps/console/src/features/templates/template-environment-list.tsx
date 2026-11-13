import { EmptyState, ErrorState } from "@openagentpack/kit-chat-ui";
import { Input } from "antd";
import { useState } from "react";
import { useRemoteEnvironments } from "../catalog/use-remote-environments.ts";
import { TemplateEnvironmentDetailDrawer } from "./template-environment-detail-drawer.tsx";
import styles from "./template-lists.module.less";
import { type TemplateEnvironmentSelection, useTemplateLocalResources } from "./template-local-resources.tsx";
import { templateResourceCandidates } from "./template-resource-candidates.ts";

function EnvironmentRow({
	environment,
	selected,
	onSelect,
}: {
	environment: TemplateEnvironmentSelection;
	selected: boolean;
	onSelect: (environment: TemplateEnvironmentSelection) => void;
}) {
	const [open, setOpen] = useState(false);
	const name = environment.name || environment.environment_id;
	return (
		<li className={`${styles.selectRow5} ${selected ? styles.selectRowSelected : styles.selectRowIdle}`}>
			<button
				type="button"
				aria-label={`查看环境详情 ${name}（${environment.environment_id}）`}
				aria-pressed={selected}
				className={styles.envRowButton}
				onClick={() => setOpen(true)}
			>
				<span className={styles.envRowName}>{name}</span>
				<span className={styles.envRowId}>{environment.local?.id ?? environment.environment_id}</span>
				<span className={styles.envRowAction}>查看配置</span>
			</button>
			<TemplateEnvironmentDetailDrawer
				environment={environment}
				open={open}
				onClose={() => setOpen(false)}
				onSelect={() => onSelect(environment)}
			/>
		</li>
	);
}

function EnvironmentEmptyState({ searching }: { searching: boolean }) {
	return (
		<EmptyState
			title={searching ? "未找到匹配的环境" : "暂无可选环境"}
			hint={searching ? "请尝试其他名称或 ID。" : "当前服务没有可选环境。"}
		/>
	);
}

/** 环境仅作为当前模版草稿的单选配置，选择不修改 Provider 资源。 */
export function TemplateEnvironmentList({
	selected,
	onSelect,
	search,
	onSearchChange,
}: {
	selected: TemplateEnvironmentSelection | null;
	onSelect: (environment: TemplateEnvironmentSelection) => void;
	search: string;
	onSearchChange: (search: string) => void;
}) {
	const remote = useRemoteEnvironments();
	const local = useTemplateLocalResources();
	const query = search.trim().toLowerCase();
	const {
		rows: candidates,
		loading,
		ready,
	} = templateResourceCandidates(local.environments, remote, (item) => item.environment_id);
	const rows = candidates.filter((environment) =>
		`${environment.name}\n${environment.environment_id}`.toLowerCase().includes(query),
	);
	const retry = () => {
		// 只重试读取，不能把用户选择静默切回默认环境；提交时复核引用是否仍可用。
		void remote.refresh();
	};
	return (
		<section aria-label="环境列表配置" className={styles.listRoot}>
			<Input
				type="search"
				aria-label="搜索环境"
				placeholder="搜索名称或 ID"
				value={search}
				onChange={(event) => onSearchChange(event.target.value)}
				className={styles.searchInputSm}
			/>
			{loading ? <EmptyState loading title="正在加载环境…" /> : null}
			{remote.error ? <ErrorState message={remote.error} onRetry={retry} /> : null}
			{ready && rows.length === 0 ? <EnvironmentEmptyState searching={query.length > 0} /> : null}
			{ready && rows.length > 0 ? (
				<div className={styles.tableWrap}>
					<div aria-hidden="true" className={styles.tableHead5}>
						<span className={styles.headCol2}>环境名称</span>
						<span className={styles.headCol2}>环境 ID</span>
						<span>操作</span>
					</div>
					<ul aria-label="环境列表" className={styles.rowList}>
						{rows.map((environment) => (
							<EnvironmentRow
								key={environment.environment_id}
								environment={environment}
								selected={selected?.environment_id === environment.environment_id}
								onSelect={onSelect}
							/>
						))}
					</ul>
				</div>
			) : null}
			<p className={styles.selectedNote}>
				{selected ? `已选择：${selected.name || selected.environment_id}` : "使用智能体默认环境"}
				{ready ? <span className={styles.noteCount}>（共 {rows.length} 个环境）</span> : null}
			</p>
		</section>
	);
}
