import type { PresetPackAgentResources } from "@openagentpack/kit-sdk/protocol";
import { Alert, Button, Drawer, Spin } from "antd";
import { useState } from "react";
import { usePresetPackResources } from "../preset-packs/preset-pack-session-resources.tsx";
import { AgentVersionConfigurationView } from "./agent-version-configuration-view.tsx";
import { TemplateAgentVersionPicker } from "./template-agent-version-picker.tsx";
import type { TemplateAgentSelection } from "./template-local-resources.tsx";
import styles from "./template-pages.module.less";
import { useTemplateAgentDetail } from "./use-template-agent-detail.ts";

function useAgentResourcePreview(agent: TemplateAgentSelection) {
	const query = usePresetPackResources(agent.agent_id, { enabled: !agent.local });
	return {
		...query,
		checking: !agent.local && (query.loading || (!query.data && !query.error)),
		confirmedResources: query.error ? undefined : query.data,
	};
}

function AgentDetailPreview({
	detail,
	ready,
	versionLabel,
}: {
	detail: ReturnType<typeof useTemplateAgentDetail>;
	ready: boolean;
	versionLabel: string;
}) {
	if (detail.error)
		return (
			<Alert
				type="error"
				showIcon
				message={detail.error}
				action={
					<Button size="small" onClick={() => void detail.refresh()}>
						重试
					</Button>
				}
			/>
		);
	if (!ready)
		return (
			<div role="status" className={styles.loadingRow}>
				<Spin />
			</div>
		);
	return detail.data ? <AgentVersionConfigurationView detail={detail.data} versionLabel={versionLabel} /> : null;
}

function AgentDetailContent({
	agent,
	version: initialVersion,
	onClose,
	onConfirm,
}: {
	agent: TemplateAgentSelection;
	version?: number;
	onClose: () => void;
	onConfirm: (version?: number, resources?: PresetPackAgentResources) => void;
}) {
	const [version, setVersion] = useState(initialVersion);
	const detail = useTemplateAgentDetail(agent, version);
	const resources = useAgentResourcePreview(agent);
	const ready = !detail.loading && !detail.error && Boolean(detail.data);
	const createdAt = ready ? detail.data?.created_at : undefined;
	const versionLabel = agent.local ? "待发布" : `v${version}`;
	return (
		<Drawer
			open
			onClose={onClose}
			width={672}
			title={
				<div className={styles.drawerHead}>
					<div className={styles.drawerTitle}>智能体详情</div>
					<p className={createdAt ? styles.drawerMeta : styles.srOnly}>
						{createdAt ? (
							<>
								创建时间：
								<time dateTime={createdAt}>{new Date(createdAt).toLocaleString("zh-CN", { hour12: false })}</time>
							</>
						) : (
							"查看配置后确认选择此智能体。"
						)}
					</p>
				</div>
			}
			extra={
				!agent.local ? (
					<TemplateAgentVersionPicker
						agentId={agent.agent_id}
						agentName={agent.name || agent.agent_id}
						value={version}
						variant="button"
						onDefaultVersion={setVersion}
						onChange={setVersion}
					/>
				) : undefined
			}
			footer={
				<div className={styles.rowEnd}>
					<Button
						type="primary"
						disabled={!ready || resources.checking}
						loading={resources.checking}
						onClick={() => onConfirm(version, resources.confirmedResources)}
					>
						确认选择
					</Button>
				</div>
			}
		>
			<div className={styles.drawerBody}>
				{resources.checking ? <p role="status">正在检测关联的运行时资源…</p> : null}
				{resources.error ? (
					<Alert
						type="warning"
						showIcon
						title="运行时资源检测失败"
						description={resources.error}
						action={<Button onClick={() => void resources.refresh()}>重试</Button>}
					/>
				) : null}
				<AgentDetailPreview detail={detail} ready={ready} versionLabel={versionLabel} />
			</div>
		</Drawer>
	);
}

/** 打开当前候选版本配置，只有确认后才改变 Agent 选择。 */
export function TemplateAgentDetailDrawer({
	agent,
	version,
	selected,
	onSelect,
}: {
	agent: TemplateAgentSelection;
	version?: number;
	selected: boolean;
	onSelect: (version?: number, resources?: PresetPackAgentResources) => void;
}) {
	const [open, setOpen] = useState(false);
	const name = agent.name || agent.agent_id;
	return (
		<>
			<button
				type="button"
				aria-label={`选择智能体 ${name}（${agent.agent_id}）`}
				aria-pressed={selected}
				disabled={!agent.local && version === undefined}
				onClick={() => setOpen(true)}
				className={styles.pickButton}
			>
				<span className={styles.pickName}>{name}</span>
				<span className={styles.pickId}>{agent.local?.id ?? agent.agent_id}</span>
			</button>
			{open ? (
				<AgentDetailContent
					key={`${agent.agent_id}:${version}`}
					agent={agent}
					version={version}
					onClose={() => setOpen(false)}
					onConfirm={(selectedVersion, resources) => {
						onSelect(selectedVersion, resources);
						setOpen(false);
					}}
				/>
			) : null}
		</>
	);
}
