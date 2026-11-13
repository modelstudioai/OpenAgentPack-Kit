import { EmptyState, ErrorState } from "@openagentpack/kit-chat-ui";
import { Checkbox, Form, Input, Switch } from "antd";
import { useId, useState } from "react";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { adminApi } from "../../lib/api.ts";
import type { AgentFormDraft } from "./template-agent-form-draft.ts";
import styles from "./template-forms.module.less";

type Member = AgentFormDraft["subAgents"][number];
const keyOf = (member: Member) =>
	typeof member === "string" ? `local:${member}` : "agent_id" in member ? `remote:${member.agent_id}` : "self";
const idOf = (member: Member) =>
	typeof member === "string" ? member : "agent_id" in member ? member.agent_id : "当前智能体自己";
const self: Member = { type: "self" };

/** 只读既有 Agent 目录；开关与多选仅修改当前表单，不初始化项目或发布资源。 */
export function TemplateAgentMultiagentFields({
	draft,
	disabled,
	currentAgentId,
	onEnabledChange,
	onMembersChange,
}: {
	draft: AgentFormDraft;
	disabled: boolean;
	currentAgentId?: string;
	onEnabledChange: (value: boolean) => void;
	onMembersChange: (value: Member[]) => void;
}) {
	const [search, setSearch] = useState("");
	const id = useId();
	const remote = useAdminQuery("catalog:remote-agents", (signal) => adminApi.remoteAgents(signal), {
		enabled: draft.multiAgentEnabled,
	});
	const ready = !remote.loading && !remote.error && remote.data !== undefined;
	const candidates = ready ? (remote.data ?? []) : [];
	const selected = new Set(draft.subAgents.map(keyOf));
	const available = candidates.filter((agent) => agent.agent_id !== currentAgentId && !agent.is_coordinator);
	const rows = [
		self,
		...draft.subAgents.filter((member) => keyOf(member) !== "self"),
		...available.map((agent) => ({ agent_id: agent.agent_id })).filter((member) => !selected.has(keyOf(member))),
	];
	const query = search.trim().toLowerCase();
	const nameOf = (member: Member) =>
		typeof member === "string"
			? member
			: "agent_id" in member
				? (candidates.find((agent) => agent.agent_id === member.agent_id)?.name ?? member.agent_id)
				: "Self";
	const filtered = rows.filter((member) => `${nameOf(member)} ${idOf(member)}`.toLowerCase().includes(query));
	return (
		<section aria-label="Multi-Agent 模式">
			<Form.Item label="Multi-Agent 模式">
				<div className={styles.content}>
					<Switch
						aria-label="Multi-Agent 模式"
						aria-controls={id}
						checked={draft.multiAgentEnabled}
						disabled={disabled}
						onChange={onEnabledChange}
					/>
					<p className={styles.description}>开启后，该智能体将作为协调 Agent，调度选中的子 Agent 协作并汇总结果。</p>
					<div id={id} className={styles.collapse} data-open={draft.multiAgentEnabled}>
						<div className={styles.collapseInner} inert={draft.multiAgentEnabled ? undefined : true}>
							<div className={styles.agentPanel}>
								<div className={styles.agentHeader}>
									<h5 className={styles.agentPanelTitle}>选择子 Agent</h5>
									<p aria-live="polite" className={styles.agentPanelCount}>
										已选择 {draft.subAgents.length} / 20 个
									</p>
								</div>
								<Input
									type="search"
									aria-label="搜索子 Agent"
									placeholder="搜索智能体名称或 ID"
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									disabled={disabled}
								/>
								{remote.loading ? <EmptyState loading title="正在加载子 Agent…" /> : null}
								{remote.error ? <ErrorState message={remote.error} onRetry={() => void remote.refresh()} /> : null}
								<ul aria-label="子 Agent 列表" className={styles.memberList}>
									{filtered.map((member) => {
										const key = keyOf(member);
										const checked = selected.has(key);
										return (
											<li key={key}>
												<Checkbox
													checked={checked}
													disabled={disabled || (!checked && draft.subAgents.length >= 20)}
													onChange={() =>
														onMembersChange(
															checked
																? draft.subAgents.filter((entry) => keyOf(entry) !== key)
																: [...draft.subAgents, member],
														)
													}
													className={styles.memberItem}
												>
													<span className={styles.memberInfo}>
														<span className={styles.memberName}>{nameOf(member)}</span>
														<span className={styles.memberId}>
															{idOf(member)}
															{typeof member === "string" ? " · 项目 Agent" : ""}
														</span>
													</span>
												</Checkbox>
											</li>
										);
									})}
								</ul>
								{ready && !filtered.length ? (
									<p className={styles.emptyText}>{query ? "未找到匹配的子 Agent" : "暂无可选的子 Agent"}</p>
								) : null}
								{!draft.subAgents.length ? (
									<p role="alert" className={styles.errorText}>
										请至少选择一个子 Agent，最多选择 20 个。
									</p>
								) : null}
							</div>
						</div>
					</div>
				</div>
			</Form.Item>
		</section>
	);
}
