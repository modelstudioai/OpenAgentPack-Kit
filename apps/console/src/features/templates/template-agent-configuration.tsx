import type { PresetPackAgentResources } from "@openagentpack/kit-sdk/protocol";
import { Alert, Button, Drawer } from "antd";
import { type Ref, useEffect, useRef, useState } from "react";
import { type AgentFormHandle, type AgentFormState, TemplateAgentForm } from "./template-agent-form.tsx";
import { TemplateAgentList, useTemplateAgentListState } from "./template-agent-list.tsx";
import { TemplateAgentVersionPicker } from "./template-agent-version-picker.tsx";
import styles from "./template-forms.module.less";
import type { TemplateAgentSelection } from "./template-local-resources.tsx";
import { useTemplateAgentDetail } from "./use-template-agent-detail.ts";

interface Props {
	revision: number;
	selected: TemplateAgentSelection | null;
	onSelect: (agent: TemplateAgentSelection, resources?: PresetPackAgentResources) => void;
	onVersionChange: (agent: TemplateAgentSelection) => void;
	onPendingChange?: (pending: boolean) => void;
	onStateChange: (state: AgentFormState) => void;
	formRef: Ref<AgentFormHandle>;
	onClear: () => void;
}

function AgentPicker({ selected, onSelect, onVersionChange }: Props) {
	const [open, setOpen] = useState(false);
	const pendingSelection = useRef<{ agent: TemplateAgentSelection; resources?: PresetPackAgentResources } | null>(null);
	const state = useTemplateAgentListState(selected);
	return (
		<>
			<Button className={styles.pickerButton} onClick={() => setOpen(true)}>
				导入现有配置
			</Button>
			<Drawer
				open={open}
				onClose={() => setOpen(false)}
				afterOpenChange={(visible) => {
					if (visible || !pendingSelection.current) return;
					const { agent, resources } = pendingSelection.current;
					pendingSelection.current = null;
					onSelect(agent, resources);
				}}
				destroyOnHidden
				width={768}
				title={<div className={styles.drawerTitle}>选择配置</div>}
			>
				<TemplateAgentList
					state={state}
					selected={selected}
					onVersionChange={onVersionChange}
					onSelect={(agent, resources) => {
						pendingSelection.current = { agent, resources };
						setOpen(false);
					}}
				/>
			</Drawer>
		</>
	);
}

function VersionField({
	selected,
	version,
	onChange,
}: {
	selected: TemplateAgentSelection | null;
	version?: number;
	onChange: (agent: TemplateAgentSelection) => void;
}) {
	if (!selected || selected.local) return <p className={styles.placeholder}>--</p>;
	return (
		<div className={styles.versionRow}>
			<p className={styles.placeholder}>
				{selected.agent_version === undefined ? "跟随最新版本" : `v${selected.agent_version}`}
				{selected.agent_version === undefined && version !== undefined ? `（当前 v${version}）` : null}
			</p>
			<TemplateAgentVersionPicker
				key={selected.agent_id}
				agentId={selected.agent_id}
				agentName={selected.name || selected.agent_id}
				value={selected.agent_version ?? version}
				variant="button"
				onDefaultVersion={() => {}}
				onChange={(value) => onChange({ ...selected, agent_version: value })}
			/>
		</div>
	);
}

/** 选择已有版本填入可编辑表单；编辑后另存新 Agent，本地声明按原 ID 更新。 */
export function TemplateAgentConfiguration(props: Props) {
	const { selected, onVersionChange, onStateChange } = props;
	const detail = useTemplateAgentDetail(selected, selected?.agent_version, props.revision);
	const ready = !selected || Boolean(!detail.loading && !detail.error && detail.data);
	useEffect(() => {
		if (!ready) onStateChange({ dirty: false, valid: false });
	}, [ready, onStateChange]);
	return (
		<section aria-label="基础配置" className={styles.configRoot}>
			<h3 className={styles.configHeading}>基础配置</h3>
			<div className={styles.configBody}>
				<div className={styles.rowStart}>
					<AgentPicker {...props} />
					<Button onClick={props.onClear}>清空</Button>
				</div>
				{detail.error ? (
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
				) : null}
				{ready ? (
					<TemplateAgentForm
						key={`${selected?.agent_id}:${selected?.agent_version}:${props.revision}`}
						selected={selected}
						detail={selected ? detail.data : undefined}
						ref={props.formRef}
						onPendingChange={props.onPendingChange}
						onStateChange={onStateChange}
						version={<VersionField selected={selected} version={detail.data?.version} onChange={onVersionChange} />}
					/>
				) : (
					<>
						<p role="status">{detail.error ? "配置加载失败" : "正在加载配置…"}</p>
						<VersionField selected={selected} onChange={onVersionChange} />
					</>
				)}
			</div>
		</section>
	);
}
