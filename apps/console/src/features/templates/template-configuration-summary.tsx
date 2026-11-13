import { useIsMobile } from "@openagentpack/kit-sdk/hooks";
import { Button, Drawer } from "antd";
import { type ReactNode, useState } from "react";
import type { AgentFormDetail } from "./template-agent-form-draft.ts";
import { AGENT_CONFIGURATION_FIELDS, agentConfigurationValues } from "./template-configuration-fields.ts";
import type { TemplateFileDraft } from "./template-file-selection.tsx";
import type {
	TemplateEnvironmentSelection,
	TemplateLocalResource,
	TemplateVaultSelectionValue,
} from "./template-local-resources.tsx";
import type { TemplateMemoryDraft } from "./template-memory-selection.tsx";
import styles from "./template-resources.module.less";

interface ConfigurationSummaryProps {
	name: string;
	agentConfiguration?: AgentFormDetail;
	environment: TemplateEnvironmentSelection | null;
	environmentName?: string;
	files: TemplateFileDraft[];
	memories: TemplateMemoryDraft[];
	vaults: TemplateVaultSelectionValue[];
}

function SummaryField({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className={styles.summaryField}>
			<dt className={styles.summaryLabel}>{label}</dt>
			<dd className={styles.summaryValue}>{children}</dd>
		</div>
	);
}

function SummaryValues({ values, empty = "未配置" }: { values: string[]; empty?: string }) {
	const unique = [...new Set(values.filter((value) => value.trim()))];
	return unique.length ? (
		<ul className={styles.valueList}>
			{unique.map((value) => (
				<li key={value}>{value}</li>
			))}
		</ul>
	) : (
		empty
	);
}

function AgentConfigurationFields({ detail }: { detail?: AgentFormDetail }) {
	const values = agentConfigurationValues(detail);
	return (
		<>
			{AGENT_CONFIGURATION_FIELDS.map(({ key, label }) => {
				const value = values[key];
				return (
					<SummaryField key={key} label={label}>
						{Array.isArray(value) ? (
							<SummaryValues values={value} empty={key === "skills" ? "未选择" : "未配置"} />
						) : (
							value
						)}
					</SummaryField>
				);
			})}
		</>
	);
}

function ResourceName({ name, id, local }: { name?: string; id: string } & TemplateLocalResource) {
	return (
		<>
			<p>{name?.trim() || id}</p>
			{name?.trim() && name !== id ? <p className={styles.resourceId}>{local ? `${local.id} · 待发布` : id}</p> : null}
		</>
	);
}

/** 仅展示当前草稿；不查询远端资源，也不参与调试快照或运行时比较。 */
function ConfigurationSummaryContent({
	name,
	agentConfiguration,
	environment,
	environmentName,
	files,
	memories,
	vaults,
}: ConfigurationSummaryProps) {
	const selectedMemories = memories.filter((memory) => memory.memory_store_id.trim());
	return (
		<dl className={styles.summaryRoot}>
			<SummaryField label="智能体名称">{name.trim() || "—"}</SummaryField>
			<AgentConfigurationFields detail={agentConfiguration} />
			<SummaryField label="环境">
				{environmentName !== undefined ? (
					<p>{environmentName.trim() || "待填写环境名称"}</p>
				) : environment ? (
					<ResourceName name={environment.name} id={environment.environment_id} local={environment.local} />
				) : (
					"使用智能体默认环境"
				)}
			</SummaryField>
			<SummaryField label="文件">
				{files.length ? (
					<ul className={styles.resourceList}>
						{files.map((file) => (
							<li key={file.file_id}>
								<ResourceName name={file.filename} id={file.file_id} local={file.local} />
								<p className={styles.resourceMeta}>挂载路径：{file.mount_path || "—"}</p>
							</li>
						))}
					</ul>
				) : (
					"未选择"
				)}
			</SummaryField>
			<SummaryField label="记忆库">
				{selectedMemories.length ? (
					<ul className={styles.resourceList}>
						{selectedMemories.map((memory) => (
							<li key={memory.key}>
								<ResourceName name={memory.name} id={memory.memory_store_id} local={memory.local} />
								<p>权限：{memory.access === "read_only" ? "只读" : "读写"}</p>
								<p className={styles.resourceMeta}>说明：{memory.instructions.trim() || "—"}</p>
							</li>
						))}
					</ul>
				) : (
					"未选择"
				)}
			</SummaryField>
			<SummaryField label="密钥库">
				{vaults.length ? (
					<ul className={styles.resourceList}>
						{vaults.map((vault) => (
							<li key={vault.vault_id}>
								<ResourceName name={vault.name} id={vault.vault_id} local={vault.local} />
							</li>
						))}
					</ul>
				) : (
					"未选择"
				)}
			</SummaryField>
		</dl>
	);
}

function ConfigurationSummaryDrawer(props: ConfigurationSummaryProps) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button onClick={() => setOpen(true)}>查看已选配置</Button>
			<Drawer
				open={open}
				onClose={() => setOpen(false)}
				destroyOnHidden
				width={448}
				title={<div className={styles.drawerTitle}>已选配置预览</div>}
			>
				<ConfigurationSummaryContent {...props} />
			</Drawer>
		</>
	);
}

export function TemplateConfigurationSummary(props: ConfigurationSummaryProps) {
	const narrow = useIsMobile(1280);
	return (
		<div className={styles.summaryAside}>
			{narrow ? (
				<ConfigurationSummaryDrawer {...props} />
			) : (
				<section aria-label="已选配置预览" className={styles.summaryCard}>
					<header className={styles.summaryCardHeader}>
						<h3 className={styles.summaryCardTitle}>已选配置预览</h3>
					</header>
					<div className={styles.summaryCardBody}>
						<ConfigurationSummaryContent {...props} />
					</div>
				</section>
			)}
		</div>
	);
}
