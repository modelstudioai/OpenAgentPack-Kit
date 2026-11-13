import { Alert, Button, Drawer } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import { TemplateAgentVersionHistory } from "./template-agent-version-history.tsx";
import styles from "./template-forms.module.less";

const triggerLabels = { inline: "切换", button: "切换版本" } as const;

/** 列表行内入口或详情按钮展开版本选择；查看候选不改变 Agent 或已有运行绑定。 */
export function TemplateAgentVersionPicker({
	agentId,
	agentName,
	value,
	variant = "inline",
	onDefaultVersion,
	onChange,
}: {
	agentId: string;
	agentName: string;
	value?: number;
	variant?: "inline" | "button";
	onDefaultVersion: (version: number) => void;
	onChange: (version: number) => void;
}) {
	const client = useMemo(getAdminClient, []);
	const [requested, setRequested] = useState(false);
	const [open, setOpen] = useState(false);
	const versions = useAdminQuery(
		`templates:agent-versions:${agentId}`,
		(signal) => client.remoteAgentVersions(agentId, signal),
		{ enabled: requested || value === undefined },
	);
	const choices = [...new Set((versions.data ?? []).map((item) => item.version))]
		.filter((version) => Number.isInteger(version) && version > 0)
		.sort((a, b) => b - a);
	const latestVersion = choices[0];
	useEffect(() => {
		if (value === undefined && latestVersion !== undefined) onDefaultVersion(latestVersion);
	}, [value, latestVersion, onDefaultVersion]);
	// 回填、分页重挂或查询失败期间保留具体版本，不能退回未绑定版本的运行方式。
	if (value !== undefined && !choices.includes(value)) choices.unshift(value);
	const status = (
		<>
			{value === undefined && versions.data?.length === 0 ? (
				<p role="status" className={styles.statusText}>
					暂无可选版本
				</p>
			) : null}
			{versions.loading ? (
				<p role="status" className={styles.statusText}>
					正在加载版本…
				</p>
			) : null}
			{versions.error ? (
				<Alert
					type="error"
					showIcon
					message={versions.error}
					action={
						<Button size="small" onClick={() => void versions.refresh()}>
							重试
						</Button>
					}
				/>
			) : null}
		</>
	);
	return (
		<div className={styles.pickerRoot}>
			<div className={styles.pickerRow}>
				{variant === "inline" ? (
					<span className={styles.versionChip}>{value === undefined ? "未选择" : `v${value}`}</span>
				) : null}
				<Button
					type={variant === "inline" ? "link" : "default"}
					size="small"
					className={styles.triggerButton}
					aria-label={`切换版本 ${agentName}（${agentId}）`}
					onClick={() => {
						setOpen(true);
						setRequested(true);
					}}
				>
					{triggerLabels[variant]}
				</Button>
				<Drawer
					open={open}
					onClose={() => setOpen(false)}
					width={672}
					title={
						<div className={styles.drawerHead}>
							<div className={styles.drawerTitle}>选择版本</div>
							<p className={styles.drawerAgent}>
								{agentName}（{agentId}）
							</p>
						</div>
					}
				>
					{open ? (
						<TemplateAgentVersionHistory
							agentId={agentId}
							versions={choices}
							selectedVersion={value}
							latestVersion={latestVersion}
							status={status}
							onSelect={(version) => {
								onChange(version);
								setOpen(false);
							}}
						/>
					) : null}
				</Drawer>
			</div>
			{!open && value === undefined ? status : null}
		</div>
	);
}
