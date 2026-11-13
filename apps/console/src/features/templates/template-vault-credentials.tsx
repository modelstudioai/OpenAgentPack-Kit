import { Button } from "antd";
import { useState } from "react";
import styles from "./template-forms.module.less";
import { TemplateVaultCredentialDialog, type VaultCredentialDraft } from "./template-vault-credential-dialog.tsx";

export function TemplateVaultCredentials({
	value,
	onChange,
	disabled,
	onEditingChange,
	requireValues = false,
}: {
	value: VaultCredentialDraft[];
	onChange: (value: VaultCredentialDraft[]) => void;
	disabled: boolean;
	onEditingChange: (value: boolean) => void;
	requireValues?: boolean;
}) {
	const [editor, setEditor] = useState<{ initial?: VaultCredentialDraft; opener: HTMLButtonElement } | null>(null);
	function open(opener: HTMLElement, initial?: VaultCredentialDraft) {
		// antd Button 只把 currentTarget 声明为 HTMLElement，实际渲染是 <button>。
		setEditor({ initial, opener: opener as HTMLButtonElement });
		onEditingChange(true);
	}
	return (
		<section aria-label="密钥配置" className={styles.vaultRoot}>
			<div className={styles.vaultHeader}>
				<h3 className={styles.vaultTitle}>密钥{value.length ? `（${value.length}）` : ""}</h3>
				<Button size="small" disabled={disabled || value.length >= 100} onClick={(event) => open(event.currentTarget)}>
					添加密钥
				</Button>
			</div>
			{value.length ? (
				<ul className={styles.credentialList}>
					{value.map((item) => (
						<li key={item.id} className={styles.credentialItem}>
							<div className={styles.credentialHead}>
								<strong className={styles.credentialName}>{item.input.name}</strong>
								<div className={styles.credentialActions}>
									<Button
										type="link"
										size="small"
										aria-label={`编辑密钥 ${item.input.name}`}
										className={styles.linkFlushSm}
										disabled={disabled}
										onClick={(event) => open(event.currentTarget, item)}
									>
										编辑
									</Button>
									<Button
										type="link"
										size="small"
										aria-label={`移除密钥 ${item.input.name}`}
										className={styles.linkFlushSm}
										disabled={disabled}
										onClick={() => onChange(value.filter((entry) => entry.id !== item.id))}
									>
										移除
									</Button>
								</div>
							</div>
							<p className={styles.credentialMeta}>{item.input.secret_name} · ••••••••</p>
							<p className={styles.credentialMeta}>生效域名：{item.input.allowed_hosts.join("、")}</p>
							{requireValues && !item.input.secret_value ? (
								<p className={styles.credentialMeta}>变量值待重新填写</p>
							) : null}
						</li>
					))}
				</ul>
			) : (
				<p className={styles.emptyNote}>暂无密钥，可先创建空密钥库。</p>
			)}
			{editor ? (
				<TemplateVaultCredentialDialog
					initial={editor.initial}
					siblings={value}
					opener={editor.opener}
					onSave={(item) =>
						onChange(editor.initial ? value.map((entry) => (entry.id === item.id ? item : entry)) : [...value, item])
					}
					onClose={() => {
						setEditor(null);
						onEditingChange(false);
					}}
				/>
			) : null}
		</section>
	);
}
