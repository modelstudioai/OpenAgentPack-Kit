import { PLAZA_CATEGORY_LABELS, type TemplateView } from "@openagentpack/kit-sdk/protocol";
import type { ReactNode } from "react";
import styles from "./template-resources.module.less";
import {
	SavedAgentConfiguration,
	SavedEnvironmentConfiguration,
	SavedMemoryConfiguration,
} from "./template-saved-resources.tsx";
import { TemplateVaultDetail } from "./template-vault-detail-drawer.tsx";

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section aria-label={title} className={styles.detailSection}>
			<h3 className={styles.detailSectionTitle}>{title}</h3>
			{children}
		</section>
	);
}

export function SavedConfiguration({ template }: { template: Omit<TemplateView, "listing" | "updated_at"> }) {
	return (
		<div className={styles.savedRoot}>
			<DetailSection title="展示配置">
				<dl className={styles.presentationList}>
					<div>
						<dt className={styles.termLabel}>模版名称</dt>
						<dd className={styles.termValue}>{template.name}</dd>
					</div>
					<div>
						<dt className={styles.termLabel}>分类</dt>
						<dd className={styles.termValue}>{PLAZA_CATEGORY_LABELS[template.category]}</dd>
					</div>
					<div>
						<dt className={styles.termLabel}>描述</dt>
						<dd className={styles.termValuePre}>{template.description || "未配置"}</dd>
					</div>
					<div>
						<dt className={styles.termLabel}>开场白</dt>
						<dd className={styles.termValuePre}>{template.opening_remarks || "未配置"}</dd>
					</div>
					<div>
						<dt className={styles.termLabel}>示例问题</dt>
						<dd className={styles.termValue}>
							{template.suggested_prompts.length ? (
								<ol className={styles.promptList}>
									{template.suggested_prompts.map((prompt, index) => (
										<li key={`${index}:${prompt}`}>{prompt}</li>
									))}
								</ol>
							) : (
								"未配置"
							)}
						</dd>
					</div>
				</dl>
			</DetailSection>
			<DetailSection title="基础配置">
				<SavedAgentConfiguration template={template} />
			</DetailSection>
			<p className={styles.sectionNote}>
				以下资源按本版本保存的引用展示当前远端配置，记忆条目与密钥元数据不作为历史快照保存。
			</p>
			<DetailSection title="环境">
				{template.remote_environment_id ? (
					<SavedEnvironmentConfiguration id={template.remote_environment_id} name={template.remote_environment_name} />
				) : (
					<p className={styles.mutedNote}>使用默认环境</p>
				)}
			</DetailSection>
			<DetailSection title="文件">
				{template.files.length ? (
					<ul className={styles.savedFileList}>
						{template.files.map((file) => (
							<li key={file.file_id} className={styles.savedFileItem}>
								<p className={styles.fileName}>{file.filename || file.file_id}</p>
								<p className={styles.fileId}>{file.file_id}</p>
								{file.mount_path ? <p>挂载路径：{file.mount_path}</p> : null}
								{file.size !== undefined ? <p>大小：{file.size.toLocaleString("zh-CN")} 字节</p> : null}
							</li>
						))}
					</ul>
				) : (
					<p className={styles.mutedNote}>未选择文件</p>
				)}
			</DetailSection>
			<DetailSection title="记忆库">
				{template.memory_stores.length ? (
					<ul className={styles.savedMemoryList}>
						{template.memory_stores.map((memory) => (
							<li key={memory.memory_store_id} className={styles.memoryItem}>
								<SavedMemoryConfiguration memory={memory} />
							</li>
						))}
					</ul>
				) : (
					<p className={styles.mutedNote}>未选择记忆库</p>
				)}
			</DetailSection>
			<DetailSection title="密钥库">
				{template.vault_ids.length ? (
					<ul className={styles.vaultList}>
						{template.vault_ids.map((id) => (
							<li key={id}>
								<TemplateVaultDetail vault={{ vault_id: id, name: id }} />
							</li>
						))}
					</ul>
				) : (
					<p className={styles.mutedNote}>未选择密钥库</p>
				)}
			</DetailSection>
		</div>
	);
}
