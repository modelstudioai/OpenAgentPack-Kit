import { EmptyState, ErrorState } from "@openagentpack/kit-chat-ui";
import { Button, Input } from "antd";
import { useState } from "react";
import { useRemoteVaults } from "../catalog/use-remote-vaults.ts";
import styles from "./template-forms.module.less";
import listStyles from "./template-lists.module.less";
import { type TemplateVaultSelectionValue, useTemplateLocalResources } from "./template-local-resources.tsx";
import { templateResourceCandidates } from "./template-resource-candidates.ts";
import { TemplateVaultDetailDrawer } from "./template-vault-detail-drawer.tsx";

import { MAX_TEMPLATE_VAULTS, type TemplateVaultDraft, validateTemplateVaults } from "./template-vault-draft.ts";

export { validateTemplateVaults } from "./template-vault-draft.ts";

function VaultRow({
	vault,
	selected,
	missing,
	maxReached,
	onToggle,
}: {
	vault: TemplateVaultSelectionValue;
	selected: boolean;
	missing: boolean;
	maxReached: boolean;
	onToggle: (id: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const id = vault.vault_id;
	return (
		<li className={`${listStyles.selectRow5} ${selected ? listStyles.selectRowSelected : listStyles.selectRowIdle}`}>
			<button
				type="button"
				aria-label={`选择密钥库 ${vault.name || id}（${id}）`}
				aria-pressed={selected}
				disabled={!selected && (missing || maxReached)}
				onClick={() => onToggle(id)}
				className={listStyles.selectRowButton5}
			>
				<span className={listStyles.nameCell}>
					<span aria-hidden="true" className={listStyles.checkMark}>
						{selected ? "✓" : null}
					</span>
					<span className={listStyles.nameText}>{vault.name || id}</span>
				</span>
				<span className={listStyles.metaCell}>
					<span className={listStyles.monoBlock}>{vault.local?.id ?? id}</span>
					{vault.local ? <span className="block">待发布</span> : null}
					{missing ? <span className="block">当前列表未找到此密钥库</span> : null}
				</span>
			</button>
			<div className={listStyles.actionCell}>
				<Button type="link" size="small" className={listStyles.linkFlush} onClick={() => setOpen(true)}>
					查看详情
				</Button>
			</div>
			<TemplateVaultDetailDrawer vault={vault} open={open} onClose={() => setOpen(false)} />
		</li>
	);
}

function VaultList({
	rows,
	selectedIds,
	remoteIds,
	onToggle,
	maxVaults,
}: {
	rows: TemplateVaultSelectionValue[];
	selectedIds: string[];
	remoteIds: Set<string>;
	onToggle: (id: string) => void;
	maxVaults: number;
}) {
	return (
		<div className={listStyles.tableWrap}>
			<div aria-hidden="true" className={listStyles.tableHead5}>
				<span className={listStyles.headCol2}>密钥库名称</span>
				<span className={listStyles.headCol2}>密钥库 ID</span>
				<span>操作</span>
			</div>
			<ul aria-label="密钥库列表" className={listStyles.rowList}>
				{rows.map((vault) => (
					<VaultRow
						key={vault.vault_id}
						vault={vault}
						selected={selectedIds.includes(vault.vault_id)}
						missing={!remoteIds.has(vault.vault_id)}
						maxReached={selectedIds.length >= maxVaults}
						onToggle={onToggle}
					/>
				))}
			</ul>
		</div>
	);
}

function VaultEmptyState({ searching }: { searching: boolean }) {
	return (
		<EmptyState
			title={searching ? "未找到匹配的密钥库" : "暂无可选密钥库"}
			hint={searching ? "请尝试其他名称或 ID。" : "当前服务没有可选密钥库。"}
		/>
	);
}

/** 仅在导入抽屉打开时查询候选，确认前不修改主表单。 */
export function TemplateVaultSelection({
	value,
	onChange,
	search,
	onSearchChange,
	maxVaults = MAX_TEMPLATE_VAULTS,
}: {
	value: TemplateVaultDraft[];
	onChange: (vaults: TemplateVaultDraft[]) => void;
	search: string;
	onSearchChange: (value: string) => void;
	maxVaults?: number;
}) {
	const remote = useRemoteVaults();
	const local = useTemplateLocalResources();
	const query = search.trim().toLowerCase();
	const ids = value.map((vault) => vault.vault_id);
	const {
		rows: availableVaults,
		loading,
		ready,
	} = templateResourceCandidates(local.vaults, remote, (item) => item.vault_id);
	const remoteById = new Map(availableVaults.map((vault) => [vault.vault_id, vault]));
	const remoteIds = new Set(remoteById.keys());
	const candidates = [...availableVaults, ...value.filter((vault) => !remoteIds.has(vault.vault_id))];
	const rows = candidates.filter((vault) => `${vault.name}\n${vault.vault_id}`.toLowerCase().includes(query));
	const error = validateTemplateVaults(value);
	const select = (next: string[]) =>
		onChange(next.flatMap((id) => remoteById.get(id) ?? value.find((vault) => vault.vault_id === id) ?? []));
	const toggle = (id: string) => {
		if (ids.includes(id)) select(ids.filter((selected) => selected !== id));
		else if (remoteIds.has(id) && ids.length < maxVaults) select([...ids, id]);
	};
	return (
		<div className={listStyles.listRoot}>
			<Input
				type="search"
				aria-label="搜索密钥库"
				placeholder="搜索名称或 ID"
				value={search}
				onChange={(event) => onSearchChange(event.target.value)}
			/>
			{loading ? <EmptyState loading title="正在加载密钥库…" /> : null}
			{remote.error ? <ErrorState message={remote.error} onRetry={() => void remote.refresh()} /> : null}
			{ready && !rows.length ? <VaultEmptyState searching={Boolean(query)} /> : null}
			{ready && rows.length ? (
				<VaultList rows={rows} selectedIds={ids} remoteIds={remoteIds} onToggle={toggle} maxVaults={maxVaults} />
			) : null}
			<p aria-live="polite" className={styles.formNote}>
				已选择 {value.length} / {maxVaults} 个密钥库
			</p>
			{error ? (
				<p role="alert" className={styles.errorText}>
					{error}
				</p>
			) : null}
		</div>
	);
}

export function TemplateSelectedVaults({ vaults }: { vaults: TemplateVaultDraft[] }) {
	if (!vaults.length) return <p className={styles.formNote}>未选择密钥库</p>;
	return (
		<ul aria-label="已选密钥库" className={listStyles.selectedList}>
			{vaults.map((vault) => (
				<li key={vault.vault_id} className={listStyles.selectedItemRow}>
					<div className={`${listStyles.shrinkRoot} ${styles.stack2}`}>
						<p className={styles.nameAny}>{vault.name || (vault.creation ? "待填写密钥库" : vault.vault_id)}</p>
						<p className={listStyles.envRowId}>{vault.creation ? "待保存" : vault.vault_id}</p>
					</div>
				</li>
			))}
		</ul>
	);
}
