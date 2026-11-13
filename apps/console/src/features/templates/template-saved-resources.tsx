import { EmptyState, ErrorState } from "@openagentpack/kit-chat-ui";
import type { TemplateVersionView } from "@openagentpack/kit-sdk/protocol";
import { useMemo } from "react";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import { AgentVersionConfigurationView } from "./agent-version-configuration-view.tsx";
import { EnvironmentDetailView } from "./environment-detail-view.tsx";
import { TemplateMemoryEntryList } from "./template-memory-entry-list.tsx";
import styles from "./template-resources.module.less";
import { useTemplateAgentDetail } from "./use-template-agent-detail.ts";
import { useTemplateEnvironmentDetail } from "./use-template-environment-detail.ts";

function SavedResourceIdentity({ id, name }: { id: string; name?: string }) {
	return (
		<div className={styles.identity}>
			<p>{name || id}</p>
			{name && name !== id ? <p className={styles.identityId}>{id}</p> : null}
		</div>
	);
}

export function SavedAgentConfiguration({ template }: { template: TemplateVersionView }) {
	const version = template.agent_version ?? template.remote_agent_version;
	const detail = useTemplateAgentDetail(
		{ agent_id: template.remote_agent_id, name: template.remote_agent_name },
		version,
		template.version,
	);
	return (
		<div className={styles.stack4}>
			<AgentVersionConfigurationView
				detail={detail.data}
				versionLabel={version === undefined ? "未记录" : `v${version}`}
				nameContent={<SavedResourceIdentity id={template.remote_agent_id} name={template.remote_agent_name} />}
				placeholder={
					detail.error ? "基础配置暂不可用" : detail.loading || !detail.data ? "正在加载基础配置…" : undefined
				}
			/>
			{template.agent_version === undefined ? (
				<p className={styles.versionNote}>未固定智能体运行版本，此处按记录版本展示；无版本记录时展示当前配置。</p>
			) : null}
			{detail.error ? <ErrorState message={detail.error} onRetry={() => void detail.refresh()} /> : null}
		</div>
	);
}

export function SavedEnvironmentConfiguration({ id, name }: { id: string; name?: string }) {
	const detail = useTemplateEnvironmentDetail({ environment_id: id, name: name || id });
	if (detail.error)
		return (
			<div className={styles.stack3}>
				<SavedResourceIdentity id={id} name={name} />
				<ErrorState message={detail.error} onRetry={() => void detail.refresh()} />
			</div>
		);
	if (detail.loading || !detail.data)
		return (
			<div className={styles.stack3}>
				<SavedResourceIdentity id={id} name={name} />
				<EmptyState loading title="正在加载环境配置…" />
			</div>
		);
	return <EnvironmentDetailView detail={detail.data} />;
}

export function SavedMemoryConfiguration({ memory }: { memory: TemplateVersionView["memory_stores"][number] }) {
	const client = useMemo(getAdminClient, []);
	const detail = useAdminQuery(`templates:saved-memory:${memory.memory_store_id}`, (signal) =>
		client.remoteMemoryStoreConfiguration(memory.memory_store_id, signal),
	);
	return (
		<div className={styles.memoryRoot}>
			<SavedResourceIdentity id={memory.memory_store_id} name={detail.data?.name} />
			<dl className={styles.stack3}>
				{detail.data ? (
					<div>
						<dt className={styles.termLabel}>描述</dt>
						<dd className={styles.termValuePre}>{detail.data.description || "未配置"}</dd>
					</div>
				) : null}
				<div>
					<dt className={styles.termLabel}>权限</dt>
					<dd className={styles.termValue}>{memory.access === "read_only" ? "只读" : "读写"}</dd>
				</div>
				<div>
					<dt className={styles.termLabel}>说明</dt>
					<dd className={styles.termValuePre}>{memory.instructions || "未配置"}</dd>
				</div>
			</dl>
			{detail.error ? (
				<ErrorState message={detail.error} onRetry={() => void detail.refresh()} />
			) : detail.loading || !detail.data ? (
				<EmptyState loading title="正在读取记忆条目…" />
			) : (
				<section aria-label="记忆条目" className={styles.stack3}>
					<h4 className={styles.entriesTitle}>记忆条目（{detail.data.entries.length}）</h4>
					<TemplateMemoryEntryList value={detail.data.entries.map((entry) => ({ ...entry, id: entry.key }))} />
				</section>
			)}
			{detail.data?.copy_restricted_fields?.length ? (
				<p className={styles.versionNote}>部分内容已隐藏：{detail.data.copy_restricted_fields.join("、")}</p>
			) : null}
		</div>
	);
}
