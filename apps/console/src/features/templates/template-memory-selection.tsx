import { EmptyState, ErrorState } from "@openagentpack/kit-chat-ui";
import type { RemoteMemoryStore } from "@openagentpack/kit-sdk/protocol";
import { Input } from "antd";
import { useRemoteMemoryStores } from "../catalog/use-remote-memory-stores.ts";
import styles from "./template-forms.module.less";
import listStyles from "./template-lists.module.less";
import { type TemplateLocalResource, useTemplateLocalResources } from "./template-local-resources.tsx";
import { MAX_TEMPLATE_MEMORIES, type TemplateMemoryDraft } from "./template-memory-draft.ts";
import { templateResourceCandidates } from "./template-resource-candidates.ts";

export type { TemplateMemoryDraft } from "./template-memory-draft.ts";

const MAX_MEMORIES = MAX_TEMPLATE_MEMORIES;

function MemoryList({
	maxMemories,
	rows,
	value,
	remoteIds,
	onToggle,
}: {
	maxMemories: number;
	rows: (RemoteMemoryStore & TemplateLocalResource)[];
	value: TemplateMemoryDraft[];
	remoteIds: Set<string>;
	onToggle: (memory: RemoteMemoryStore & TemplateLocalResource) => void;
}) {
	const selectedIds = new Set(value.map((memory) => memory.memory_store_id));
	return (
		<div className={listStyles.tableWrap}>
			<div aria-hidden="true" className={listStyles.tableHead2}>
				<span>记忆库名称</span>
				<span>记忆库 ID</span>
			</div>
			<ul aria-label="记忆库列表" className={listStyles.rowList}>
				{rows.map((memory) => {
					const id = memory.memory_store_id;
					const name = memory.name || id;
					const selected = selectedIds.has(id);
					const missing = !remoteIds.has(id);
					return (
						<li key={id}>
							<button
								type="button"
								aria-label={`选择记忆库 ${name}（${id}）`}
								aria-pressed={selected}
								disabled={!selected && (missing || value.length >= maxMemories)}
								onClick={() => onToggle(memory)}
								className={`${listStyles.selectRow} ${selected ? listStyles.selectRowSelected : listStyles.selectRowIdle}`}
							>
								<span className={listStyles.nameCell}>
									<span aria-hidden="true" className={listStyles.checkMark}>
										{selected ? "✓" : null}
									</span>
									<span className={listStyles.nameText}>{name}</span>
								</span>
								<span className={listStyles.metaCell}>
									<span className={listStyles.monoBlock}>{memory.local?.id ?? id}</span>
									{memory.local ? <span className="block">待发布</span> : null}
									{missing ? <span className="block">当前列表未找到此记忆库</span> : null}
								</span>
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function MemoryEmptyState({ searching }: { searching: boolean }) {
	return (
		<EmptyState
			title={searching ? "未找到匹配的记忆库" : "暂无可选记忆库"}
			hint={searching ? "请尝试其他名称或 ID。" : "当前服务没有可选记忆库。"}
		/>
	);
}

/** 列表只选择已有引用；每个已选库独立保留权限和说明，不创建空配置行。 */
export function TemplateMemorySelection({
	value,
	onChange,
	search,
	onSearchChange,
	maxMemories = MAX_MEMORIES,
}: {
	value: TemplateMemoryDraft[];
	onChange: (memories: TemplateMemoryDraft[]) => void;
	search: string;
	onSearchChange: (search: string) => void;
	maxMemories?: number;
}) {
	const remote = useRemoteMemoryStores();
	const local = useTemplateLocalResources();
	const query = search.trim().toLowerCase();
	const {
		rows: availableMemories,
		loading,
		ready,
	} = templateResourceCandidates(local.memories, remote, (item) => item.memory_store_id);
	const remoteNames = new Map(availableMemories.map((memory) => [memory.memory_store_id, memory.name]));
	const remoteIds = new Set(remoteNames.keys());
	const candidates = [
		...availableMemories,
		...value
			.filter((memory) => memory.memory_store_id && !remoteIds.has(memory.memory_store_id))
			.map((memory) => ({ ...memory, name: memory.name || memory.memory_store_id })),
	];
	const rows = candidates.filter((memory) => `${memory.name}\n${memory.memory_store_id}`.toLowerCase().includes(query));
	const toggle = (memory: RemoteMemoryStore & TemplateLocalResource) => {
		if (value.some((item) => item.memory_store_id === memory.memory_store_id)) {
			onChange(value.filter((item) => item.memory_store_id !== memory.memory_store_id));
		} else if (remoteIds.has(memory.memory_store_id) && value.length < maxMemories) {
			onChange([
				...value,
				{
					...memory,
					key: crypto.randomUUID(),
					access: "read_write",
					instructions: "",
				},
			]);
		}
	};
	return (
		<section aria-label="记忆库列表配置" className={listStyles.listRoot}>
			<Input
				type="search"
				aria-label="搜索记忆库"
				placeholder="搜索名称或 ID"
				value={search}
				onChange={(event) => onSearchChange(event.target.value)}
				className={listStyles.searchInputSm}
			/>
			{loading ? <EmptyState loading title="正在加载记忆库…" /> : null}
			{remote.error ? <ErrorState message={remote.error} onRetry={() => void remote.refresh()} /> : null}
			{ready && rows.length === 0 ? <MemoryEmptyState searching={query.length > 0} /> : null}
			{ready && rows.length > 0 ? (
				<MemoryList maxMemories={maxMemories} rows={rows} value={value} remoteIds={remoteIds} onToggle={toggle} />
			) : null}
			<p aria-live="polite" className={styles.formNote}>
				已选择 {value.length} / {maxMemories} 个记忆库
				{ready ? <span className={listStyles.noteCount}>（共 {rows.length} 个记忆库）</span> : null}
			</p>
		</section>
	);
}

export function TemplateSelectedMemories({ memories }: { memories: TemplateMemoryDraft[] }) {
	if (!memories.length) return <p className={styles.formNote}>未选择记忆库</p>;
	return (
		<ul aria-label="已选记忆库" className={listStyles.selectedList}>
			{memories.map((memory) => (
				<li key={memory.key} className={listStyles.selectedItem}>
					<p className={styles.nameAny}>{memory.name || (memory.creation ? "待填写记忆库" : memory.memory_store_id)}</p>
					<p className={listStyles.envRowId}>{memory.creation ? "待保存" : memory.memory_store_id}</p>
					<p className={styles.body13}>权限：{memory.access === "read_only" ? "只读" : "读写"}</p>
					{memory.instructions ? <p className={styles.noteAny}>说明：{memory.instructions}</p> : null}
				</li>
			))}
		</ul>
	);
}
