import { DeleteOutlined } from "@ant-design/icons";
import { Button, Input, Select } from "antd";
import { useId } from "react";

import { EnvironmentNetworkingFields } from "./environment-networking-fields.tsx";
import { ENVIRONMENT_PACKAGE_MANAGERS, type EnvironmentCreateDraft } from "./template-environment-form-draft.ts";
import styles from "./template-forms.module.less";

const PACKAGE_MANAGERS = ENVIRONMENT_PACKAGE_MANAGERS;
const MAX_ROWS = 50;

function RemoveRowButton({ label, onRemove }: { label: string; onRemove: () => void }) {
	return (
		<Button
			type="text"
			size="small"
			aria-label={label}
			title={label}
			icon={<DeleteOutlined />}
			onClick={onRemove}
			className={styles.shrinkZero}
		/>
	);
}

/** 仅编辑环境草稿；保存位置与提交由调用方负责。 */
export function EnvironmentCreateFields({
	value,
	onChange,
}: {
	value: EnvironmentCreateDraft;
	onChange: (next: EnvironmentCreateDraft) => void;
}) {
	const id = useId();
	const updatePackage = (id: string, patch: Partial<EnvironmentCreateDraft["packages"][number]>) =>
		onChange({ ...value, packages: value.packages.map((row) => (row.id === id ? { ...row, ...patch } : row)) });
	const updateMetadata = (id: string, patch: Partial<EnvironmentCreateDraft["metadata"][number]>) =>
		onChange({ ...value, metadata: value.metadata.map((row) => (row.id === id ? { ...row, ...patch } : row)) });
	return (
		<div className={styles.createRoot}>
			<div className={`${styles.fieldStack} ${styles.body13}`}>
				<label htmlFor={`${id}-name`}>
					环境名称{" "}
					<span aria-hidden="true" className={styles.errorColor}>
						*
					</span>
				</label>
				<Input
					id={`${id}-name`}
					aria-label="环境名称"
					required
					maxLength={50}
					value={value.name}
					onChange={(event) => onChange({ ...value, name: event.target.value })}
				/>
			</div>
			<div className={`${styles.fieldStack} ${styles.body13}`}>
				<label htmlFor={`${id}-description`}>描述</label>
				<Input.TextArea
					id={`${id}-description`}
					aria-label="描述"
					rows={3}
					maxLength={200}
					value={value.description}
					onChange={(event) => onChange({ ...value, description: event.target.value })}
				/>
			</div>
			<EnvironmentNetworkingFields value={value} onChange={onChange} />
			<section aria-label="预装包" className={`${styles.shrinkRoot} ${styles.blockStack}`}>
				<div>
					<div className={styles.rowBetweenSm}>
						<h3 className={styles.heading13}>预装包</h3>
						<Button
							type="link"
							size="small"
							aria-label="添加预装包"
							disabled={value.packages.length >= MAX_ROWS}
							className={`${styles.shrinkZero} ${styles.linkButton}`}
							onClick={() => {
								if (value.packages.length >= MAX_ROWS) return;
								onChange({
									...value,
									packages: [...value.packages, { id: crypto.randomUUID(), manager: "apt", value: "" }],
								});
							}}
						>
							<span aria-hidden="true">+</span> 添加
						</Button>
					</div>
					<p id={`${id}-packages-hint`} className={styles.metaText}>
						指定该环境中可用的包及其版本。多个值用空格分隔。
					</p>
				</div>
				<div className={styles.stack2}>
					{value.packages.map((row, index) => (
						<div key={row.id} className={styles.entryRow}>
							<div className={styles.managerCell}>
								<Select
									aria-label="包管理器"
									value={row.manager}
									className={styles.fullControl}
									options={PACKAGE_MANAGERS.map((manager) => ({ value: manager, label: manager }))}
									onChange={(manager) => {
										const found = PACKAGE_MANAGERS.find((option) => option === manager);
										if (found) updatePackage(row.id, { manager: found });
									}}
								/>
							</div>
							<Input
								aria-label="包名称"
								aria-describedby={`${id}-packages-hint`}
								placeholder="package package==1.0.0"
								maxLength={200}
								value={row.value}
								onChange={(event) => updatePackage(row.id, { value: event.target.value })}
								className={styles.flexFill}
							/>
							<RemoveRowButton
								label={`移除预装包 ${index + 1}`}
								onRemove={() => onChange({ ...value, packages: value.packages.filter((item) => item.id !== row.id) })}
							/>
						</div>
					))}
				</div>
			</section>
			<section aria-label="元数据" className={`${styles.metadataSection} ${styles.shrinkRoot}`}>
				<div>
					<div className={styles.rowBetweenSm}>
						<h3 className={styles.heading13}>元数据</h3>
						<Button
							type="link"
							size="small"
							aria-label="添加元数据"
							disabled={value.metadata.length >= MAX_ROWS}
							className={`${styles.shrinkZero} ${styles.linkButton}`}
							onClick={() => {
								if (value.metadata.length >= MAX_ROWS) return;
								onChange({ ...value, metadata: [...value.metadata, { id: crypto.randomUUID(), key: "", value: "" }] });
							}}
						>
							<span aria-hidden="true">+</span> 添加
						</Button>
					</div>
					<p id={`${id}-metadata-hint`} className={styles.metaText}>
						添加自定义键值对以标记和组织该环境。键必须为小写。
					</p>
				</div>
				<div className={styles.stack2}>
					{value.metadata.map((row, index) => {
						const invalid = /[A-Z]/.test(row.key);
						const errorId = `${id}-${row.id}-error`;
						return (
							<div key={row.id} className={`${styles.entryRow} ${styles.shrinkRoot}`}>
								<div className={`${styles.flexFill} ${styles.fieldStack}`}>
									<Input
										aria-label="元数据键"
										aria-invalid={invalid}
										aria-describedby={invalid ? `${id}-metadata-hint ${errorId}` : `${id}-metadata-hint`}
										placeholder="client_key…"
										maxLength={64}
										value={row.key}
										onChange={(event) => updateMetadata(row.id, { key: event.target.value })}
										className={styles.shrinkRoot}
										status={invalid ? "error" : undefined}
									/>
									{invalid ? (
										<p id={errorId} className={styles.errorSmall}>
											键必须为小写字母
										</p>
									) : null}
								</div>
								<Input
									aria-label="元数据值"
									placeholder="值"
									maxLength={200}
									value={row.value}
									onChange={(event) => updateMetadata(row.id, { value: event.target.value })}
									className={styles.flexFill}
								/>
								<RemoveRowButton
									label={`移除元数据 ${index + 1}`}
									onRemove={() => onChange({ ...value, metadata: value.metadata.filter((item) => item.id !== row.id) })}
								/>
							</div>
						);
					})}
				</div>
			</section>
		</div>
	);
}
