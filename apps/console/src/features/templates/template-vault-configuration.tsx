import { EmptyState, ErrorState } from "@openagentpack/kit-chat-ui";
import { Button, Input } from "antd";
import { type Ref, useId, useState } from "react";
import { formRowClass, formRowLabelClass } from "../../lib/form-row.ts";
import styles from "./template-forms.module.less";
import { TemplateVaultCredentials } from "./template-vault-credentials.tsx";
import { useTemplateVaultDetail } from "./template-vault-detail-drawer.tsx";
import {
	emptyTemplateVault,
	importedTemplateVault,
	MAX_TEMPLATE_VAULTS,
	type TemplateVaultDraft,
	validateTemplateVaults,
	vaultNeedsCreation,
} from "./template-vault-draft.ts";
import { TemplateVaultPicker } from "./template-vault-picker.tsx";
import { useTemplateVaultForm, type VaultFormHandle } from "./use-template-vault-form.ts";

function useVaultFieldsModel(row: TemplateVaultDraft) {
	const detail = useTemplateVaultDetail(row, !row.creation && !row.configuration);
	const current = !row.creation && !row.configuration && detail.data ? importedTemplateVault(row, detail.data) : row;
	return {
		detail,
		current,
		editable: Boolean(current.creation || current.configuration),
		credentials: current.creation?.credentials ?? current.configuration?.credentials ?? [],
		modified: Boolean(current.configuration && vaultNeedsCreation(current)),
	};
}

function VaultFields({
	row,
	index,
	disabled,
	name,
	onChange,
	onRemove,
	onEditingChange,
}: {
	row: TemplateVaultDraft;
	index: number;
	disabled: boolean;
	name?: string;
	onChange: (row: TemplateVaultDraft) => void;
	onRemove: () => void;
	onEditingChange: (editing: boolean) => void;
}) {
	const { detail, current, editable, credentials, modified } = useVaultFieldsModel(row);
	const id = useId();
	return (
		<fieldset disabled={disabled} className={styles.resourceCard}>
			<legend className={styles.legendNote}>密钥库 {index + 1}</legend>
			<div className={formRowClass}>
				<label htmlFor={`${id}-name`} className={formRowLabelClass}>
					名称{" "}
					{editable ? (
						<span aria-hidden="true" className={styles.errorColor}>
							*
						</span>
					) : null}
				</label>
				<div className={styles.shrinkRoot}>
					<Input
						id={`${id}-name`}
						aria-label="密钥库名称"
						value={current.name || (editable ? "" : name || row.vault_id)}
						readOnly={!editable}
						required={editable}
						maxLength={50}
						placeholder="例如：My Vault"
						onChange={(event) => onChange({ ...current, name: event.target.value })}
					/>
				</div>
			</div>
			{editable ? (
				<>
					<TemplateVaultCredentials
						value={credentials}
						onChange={(credentials) =>
							onChange(
								current.configuration
									? { ...current, configuration: { ...current.configuration, credentials } }
									: { ...current, creation: { credentials } },
							)
						}
						disabled={disabled}
						onEditingChange={onEditingChange}
						requireValues={modified}
					/>
					{modified ? (
						<p className={styles.metaText}>
							修改后将创建新密钥库，原密钥库不变。原密钥值无法读取，请为保留的密钥重新填写变量值。
						</p>
					) : null}
					{credentials.some((item) => item.input.secret_value) ? (
						<p className={styles.metaText}>未发布密钥仅临时保留，退出页面会清空；服务重启后需重新添加。</p>
					) : null}
				</>
			) : detail.error ? (
				<ErrorState message={detail.error} onRetry={() => void detail.refresh()} />
			) : (
				<EmptyState loading title="正在加载密钥库配置…" />
			)}
			<div className={styles.drawerFooter}>
				{modified && current.configuration ? (
					<Button
						onClick={() =>
							onChange({ vault_id: row.vault_id, name: current.configuration!.originalName, local: row.local })
						}
					>
						恢复原配置
					</Button>
				) : null}
				<Button aria-label={`移除密钥库 ${index + 1}`} onClick={onRemove}>
					移除
				</Button>
			</div>
		</fieldset>
	);
}

export function TemplateVaultConfiguration({
	value,
	onChange,
	formRef,
	onPendingChange,
}: {
	value: TemplateVaultDraft[];
	onChange: (rows: TemplateVaultDraft[]) => void;
	formRef: Ref<VaultFormHandle>;
	onPendingChange?: (pending: boolean) => void;
}) {
	const [initialRow] = useState(emptyTemplateVault);
	const [editing, setEditing] = useState(false);
	const model = useTemplateVaultForm(value, onChange, formRef, editing, onPendingChange);
	const rows = value.length ? value : [initialRow];
	const disabled = model.busy || model.identity.data?.role !== "admin";
	const error = [validateTemplateVaults(value), model.error].find(
		(message) => message && message !== "请输入密钥库名称",
	);
	return (
		<section aria-label="密钥库" className={styles.configRoot}>
			<header className={styles.configHeader}>
				<h3 className={styles.sectionTitle}>密钥库</h3>
				<p className={styles.mutedOnly}>可选，最多配置 {MAX_TEMPLATE_VAULTS} 个密钥库。</p>
			</header>
			<div className={styles.configBody}>
				<div className={styles.rowStart}>
					<TemplateVaultPicker value={value} onChange={onChange} />
					<Button disabled={model.busy || !value.length} onClick={() => onChange([])}>
						清空
					</Button>
				</div>
				{model.identity.error ? (
					<ErrorState message={model.identity.error} onRetry={() => void model.identity.refresh()} />
				) : null}
				{model.names.error ? (
					<ErrorState message={model.names.error} onRetry={() => void model.names.refresh()} />
				) : null}
				{rows.map((row, index) => (
					<VaultFields
						key={row.vault_id}
						row={row}
						index={index}
						disabled={disabled}
						name={model.names.data?.find((item) => item.vault_id === row.vault_id)?.name}
						onChange={(next) => onChange(rows.map((item) => (item.vault_id === row.vault_id ? next : item)))}
						onRemove={() => onChange(value.filter((item) => item.vault_id !== row.vault_id))}
						onEditingChange={setEditing}
					/>
				))}
				<Button
					disabled={disabled || rows.length >= MAX_TEMPLATE_VAULTS}
					onClick={() => onChange(value.length ? [...value, emptyTemplateVault()] : [initialRow])}
				>
					添加密钥库
				</Button>
				{error ? <ErrorState message={error} /> : null}
			</div>
		</section>
	);
}
