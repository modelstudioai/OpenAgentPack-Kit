import { EmptyState, ErrorState } from "@openagentpack/kit-chat-ui";
import { Button, Input, Select } from "antd";
import { type Ref, useId, useMemo, useState } from "react";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import { formRowClass, formRowIndent, formRowLabelClass } from "../../lib/form-row.ts";
import styles from "./template-forms.module.less";
import {
	emptyTemplateMemory,
	importedTemplateMemory,
	MAX_TEMPLATE_MEMORIES,
	memoryNeedsCreation,
	type TemplateMemoryDraft,
	validateTemplateMemories,
} from "./template-memory-draft.ts";
import { TemplateMemoryEntries } from "./template-memory-entries.tsx";
import { TemplateMemoryPicker } from "./template-memory-picker.tsx";
import { type MemoryFormHandle, useTemplateMemoryForm } from "./use-template-memory-form.ts";

function useMemoryFieldsModel(row: TemplateMemoryDraft) {
	const client = useMemo(getAdminClient, []);
	const detail = useAdminQuery(
		`templates:memory-configuration:${row.memory_store_id}`,
		(signal) =>
			row.local
				? client.draftResources.memoryStoreConfiguration(row.local.projectName, row.local.id, signal)
				: client.remoteMemoryStoreConfiguration(row.memory_store_id, signal),
		{ enabled: !row.creation && !row.configuration && !row.referenceOnly },
	);
	const current =
		!row.creation && !row.configuration && !row.referenceOnly && detail.data
			? importedTemplateMemory(row, detail.data)
			: row;
	return {
		detail,
		current,
		configuration: current.creation ?? current.configuration,
		modified: Boolean(current.configuration && memoryNeedsCreation(current)),
		restricted: current.configuration?.restricted ?? [],
	};
}

function MemoryFields({
	row,
	index,
	disabled,
	onChange,
	onRemove,
	onEditingChange,
}: {
	row: TemplateMemoryDraft;
	index: number;
	disabled: boolean;
	onChange: (row: TemplateMemoryDraft) => void;
	onRemove: () => void;
	onEditingChange: (editing: boolean) => void;
}) {
	const model = useMemoryFieldsModel(row);
	const { current, configuration, modified, restricted } = model;
	const id = useId();
	function updateConfiguration(patch: Partial<NonNullable<TemplateMemoryDraft["creation"]>>) {
		onChange(
			current.configuration
				? { ...current, configuration: { ...current.configuration, ...patch } }
				: { ...current, creation: { description: "", ...current.creation, ...patch } },
		);
	}
	return (
		<fieldset disabled={disabled} className={styles.resourceCard}>
			<legend className={styles.legendNote}>记忆库 {index + 1}</legend>
			<fieldset disabled={restricted.length > 0} className={styles.configFields}>
				<div className={formRowClass}>
					<label htmlFor={`${id}-name`} className={formRowLabelClass}>
						名称{" "}
						<span aria-hidden="true" className={styles.errorColor}>
							*
						</span>
					</label>
					<div className={styles.shrinkRoot}>
						<Input
							id={`${id}-name`}
							aria-label="记忆库名称"
							value={current.name ?? ""}
							readOnly={!configuration}
							required
							maxLength={64}
							placeholder="请输入记忆库名称"
							onChange={(event) => onChange({ ...current, name: event.target.value })}
						/>
					</div>
				</div>
				{configuration ? (
					<>
						<div className={formRowClass}>
							<label htmlFor={`${id}-description`} className={formRowLabelClass}>
								描述
							</label>
							<div className={styles.shrinkRoot}>
								<Input.TextArea
									id={`${id}-description`}
									aria-label="描述"
									rows={3}
									value={configuration.description}
									onChange={(event) => updateConfiguration({ description: event.target.value })}
								/>
							</div>
						</div>
						<TemplateMemoryEntries
							value={configuration.entries ?? []}
							onChange={(entries) => updateConfiguration({ entries })}
							disabled={disabled || restricted.length > 0}
							onEditingChange={onEditingChange}
						/>
					</>
				) : row.referenceOnly ? (
					<div className={`${styles.referenceNote} ${formRowIndent}`}>
						<p>仅复用原记忆库，名称、描述和条目保持原配置。</p>
						<Button onClick={() => onChange({ ...row, referenceOnly: undefined })}>读取配置以编辑</Button>
					</div>
				) : model.detail.error ? (
					<ErrorState message={model.detail.error} onRetry={() => void model.detail.refresh()} />
				) : (
					<EmptyState loading title="正在读取记忆条目…" />
				)}
			</fieldset>
			{restricted.length ? (
				<p role="status" className={styles.mutedOnly}>
					以下内容无法完整复制，可复用原库或清空后重新填写：{restricted.join("、")}
				</p>
			) : null}
			{modified ? <p className={styles.mutedOnly}>修改后将创建新记忆库，原记忆库和条目保持不变。</p> : null}
			<div className={formRowClass}>
				<label htmlFor={`${id}-access`} className={formRowLabelClass}>
					权限
				</label>
				<div className={styles.shrinkRoot}>
					<Select
						id={`${id}-access`}
						aria-label="权限"
						className={styles.fullControl}
						value={row.access}
						onChange={(access) => onChange({ ...current, access: access === "read_only" ? "read_only" : "read_write" })}
						options={[
							{ value: "read_only", label: "只读" },
							{ value: "read_write", label: "读写" },
						]}
					/>
				</div>
			</div>
			<div className={formRowClass}>
				<label htmlFor={`${id}-instructions`} className={formRowLabelClass}>
					说明
				</label>
				<div className={styles.shrinkRoot}>
					<Input.TextArea
						id={`${id}-instructions`}
						aria-label="说明"
						rows={3}
						maxLength={4090}
						placeholder="描述该记忆的用途或使用场景"
						value={row.instructions}
						onChange={(event) => onChange({ ...current, instructions: event.target.value })}
					/>
				</div>
			</div>
			<div className={styles.drawerFooter}>
				{modified && current.configuration ? (
					<Button
						onClick={() => onChange({ ...row, name: current.configuration!.originalName, configuration: undefined })}
					>
						恢复原配置
					</Button>
				) : null}
				<Button aria-label={`移除记忆 ${index + 1}`} onClick={onRemove}>
					移除
				</Button>
			</div>
		</fieldset>
	);
}

export function TemplateMemoryConfiguration({
	value,
	onChange,
	formRef,
	onPendingChange,
}: {
	value: TemplateMemoryDraft[];
	onChange: (rows: TemplateMemoryDraft[]) => void;
	formRef: Ref<MemoryFormHandle>;
	onPendingChange?: (pending: boolean) => void;
}) {
	const [initialRow] = useState(emptyTemplateMemory);
	const [editing, setEditing] = useState(false);
	const [importing, setImporting] = useState(false);
	const model = useTemplateMemoryForm(value, onChange, formRef, editing || importing, onPendingChange);
	const rows = value.length ? value : [initialRow];
	const disabled = model.busy || model.identity.data?.role !== "admin";
	const error = [validateTemplateMemories(value), model.error].find(
		(message) => message && message !== "请输入记忆库名称",
	);
	return (
		<section aria-label="记忆库" className={styles.configRoot}>
			<header className={styles.configHeader}>
				<h3 className={styles.sectionTitle}>记忆库</h3>
				<p className={styles.mutedOnly}>
					可选，最多配置 {MAX_TEMPLATE_MEMORIES} 个记忆库，每个库可独立设置权限和说明。
				</p>
			</header>
			<div className={styles.configBody}>
				<div className={styles.rowStart}>
					<TemplateMemoryPicker value={value} onChange={onChange} onPendingChange={setImporting} />
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
					<MemoryFields
						key={row.key}
						row={row}
						index={index}
						disabled={disabled}
						onChange={(next) => onChange(rows.map((item) => (item.key === row.key ? next : item)))}
						onRemove={() => onChange(value.filter((item) => item.key !== row.key))}
						onEditingChange={setEditing}
					/>
				))}
				<Button
					disabled={disabled || rows.length >= MAX_TEMPLATE_MEMORIES}
					onClick={() => onChange(value.length ? [...value, emptyTemplateMemory()] : [initialRow])}
				>
					添加记忆库
				</Button>
				{error ? <ErrorState message={error} /> : null}
			</div>
		</section>
	);
}
