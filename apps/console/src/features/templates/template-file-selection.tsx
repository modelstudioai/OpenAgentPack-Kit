import { EmptyState, ErrorState } from "@openagentpack/kit-chat-ui";
import { Input } from "antd";
import { useRemoteFiles } from "../catalog/use-remote-files.ts";
import { MAX_TEMPLATE_FILES, type TemplateFileDraft, withFileMountPaths } from "./template-file-draft.ts";
import styles from "./template-forms.module.less";
import listStyles from "./template-lists.module.less";
import { useTemplateLocalResources } from "./template-local-resources.tsx";
import { templateResourceCandidates } from "./template-resource-candidates.ts";

export type { TemplateFileDraft } from "./template-file-draft.ts";

function selectedFiles(
	ids: string[],
	value: TemplateFileDraft[],
	availableFiles: TemplateFileDraft[],
): TemplateFileDraft[] {
	return withFileMountPaths(
		ids.flatMap((id) => {
			const selected = value.find((file) => file.file_id === id);
			if (selected?.pending) return selected;
			const available = availableFiles.find((file) => file.file_id === id && file.available);
			return available ? { ...selected, ...available } : (selected ?? []);
		}),
	);
}

const MAX_FILES = MAX_TEMPLATE_FILES;

function FileRow({
	file,
	selected,
	missing,
	limitReached,
	onToggle,
}: {
	file: TemplateFileDraft;
	selected: boolean;
	missing: boolean;
	limitReached: boolean;
	onToggle: () => void;
}) {
	const name = file.filename || file.file_id;
	return (
		<li>
			<button
				type="button"
				aria-label={`选择文件 ${name}（${file.file_id}）`}
				aria-pressed={selected}
				disabled={!selected && (missing || !file.available || limitReached)}
				onClick={onToggle}
				className={`${listStyles.selectRow} ${listStyles.selectRow5} ${selected ? listStyles.selectRowSelected : listStyles.selectRowIdle}`}
			>
				<span className={`${listStyles.nameCell} ${listStyles.cellSpan2}`}>
					<span aria-hidden="true" className={listStyles.checkMark}>
						{selected ? "✓" : null}
					</span>
					<span className={listStyles.nameText}>{name}</span>
				</span>
				<span className={`${listStyles.envRowId} ${listStyles.cellSpan2}`}>{file.local?.id ?? file.file_id}</span>
				<span className={styles.metaAny}>
					{file.local ? "待发布" : missing ? "当前列表未找到此文件" : file.available ? "可用" : "暂不可用"}
				</span>
			</button>
		</li>
	);
}

function FileList({
	maxFiles,
	rows,
	value,
	remoteIds,
	onSelect,
	onRemove,
}: {
	maxFiles: number;
	rows: TemplateFileDraft[];
	value: TemplateFileDraft[];
	remoteIds: Set<string>;
	onSelect: (id: string) => void;
	onRemove: (id: string) => void;
}) {
	return (
		<div className={listStyles.tableWrap}>
			<div aria-hidden="true" className={listStyles.tableHead5}>
				<span className={listStyles.headCol2}>文件名称</span>
				<span className={listStyles.headCol2}>文件 ID</span>
				<span>状态</span>
			</div>
			<ul aria-label="文件列表" className={listStyles.rowList}>
				{rows.map((file) => {
					const selected = value.some((item) => item.file_id === file.file_id);
					return (
						<FileRow
							key={file.file_id}
							file={file}
							selected={selected}
							missing={!remoteIds.has(file.file_id)}
							limitReached={value.length >= maxFiles}
							onToggle={() => (selected ? onRemove(file.file_id) : onSelect(file.file_id))}
						/>
					);
				})}
			</ul>
		</div>
	);
}

function FileEmptyState({ searching }: { searching: boolean }) {
	return (
		<EmptyState
			title={searching ? "未找到匹配的文件" : "暂无可选文件"}
			hint={searching ? "请尝试其他名称或 ID。" : "当前服务没有可选文件。"}
		/>
	);
}

/** 本地声明与远端文件共同选择；发布前保留显式本地引用。 */
export function TemplateFileSelection({
	value,
	onChange,
	search,
	onSearchChange,
	maxFiles = MAX_FILES,
}: {
	value: TemplateFileDraft[];
	onChange: (files: TemplateFileDraft[]) => void;
	search: string;
	onSearchChange: (search: string) => void;
	maxFiles?: number;
}) {
	const remote = useRemoteFiles();
	const local = useTemplateLocalResources();
	const query = search.trim().toLowerCase();
	const {
		rows: availableFiles,
		loading,
		ready,
	} = templateResourceCandidates(local.files, remote, (item) => item.file_id);
	const remoteIds = new Set(availableFiles.map((file) => file.file_id));
	const candidates = [...availableFiles, ...value.filter((file) => !remoteIds.has(file.file_id))];
	const rows = candidates.filter((file) => `${file.filename}\n${file.file_id}`.toLowerCase().includes(query));
	const select = (ids: string[]) => onChange(selectedFiles(ids, value, availableFiles));
	const remove = (id: string) => onChange(value.filter((file) => file.file_id !== id));
	return (
		<section aria-label="文件列表配置" className={listStyles.listRoot}>
			<Input
				type="search"
				aria-label="搜索文件"
				placeholder="搜索名称或 ID"
				value={search}
				onChange={(event) => onSearchChange(event.target.value)}
				className={listStyles.searchInputSm}
			/>
			{loading ? <EmptyState loading title="正在加载文件…" /> : null}
			{remote.error ? <ErrorState message={remote.error} onRetry={() => void remote.refresh()} /> : null}
			{ready && rows.length === 0 ? <FileEmptyState searching={query.length > 0} /> : null}
			{ready && rows.length > 0 ? (
				<FileList
					maxFiles={maxFiles}
					rows={rows}
					value={value}
					remoteIds={remoteIds}
					onSelect={(id) => {
						if (value.length < maxFiles) select([...value.map((file) => file.file_id), id]);
					}}
					onRemove={remove}
				/>
			) : null}
			<p aria-live="polite" className={styles.formNote}>
				已选择 {value.length} / {maxFiles} 个文件
				{ready ? <span className={listStyles.noteCount}>（共 {rows.length} 个文件）</span> : null}
			</p>
		</section>
	);
}

export function TemplateSelectedFiles({ files }: { files: TemplateFileDraft[] }) {
	if (!files.length) return <p className={styles.formNote}>未选择文件</p>;
	return (
		<ul aria-label="已选文件" className={listStyles.selectedList}>
			{files.map((file) => (
				<li key={file.file_id} className={listStyles.selectedItemRow}>
					<div className={`${listStyles.shrinkRoot} ${styles.fieldStack}`}>
						<p className={styles.nameAny}>{file.filename || file.file_id}</p>
						<p className={listStyles.envRowId}>{file.pending ? "待保存" : (file.local?.id ?? file.file_id)}</p>
						{file.mount_path ? <p className={styles.metaAny}>挂载路径：{file.mount_path}</p> : null}
					</div>
				</li>
			))}
		</ul>
	);
}
