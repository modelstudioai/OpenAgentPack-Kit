"use client";

import { ToolApprovalCard, ToolApprovalGroup } from "@openagentpack/kit-chat-ui";
import type { ChatToolApproval } from "@openagentpack/kit-sdk/chat";
import { useState } from "react";
import { CONTROL_CLASS, TOOLBAR_CLASS } from "./general-demo.tsx";

const REQUEST: ChatToolApproval = {
	batch_id: "demo-batch",
	call_id: "demo-call",
	request_event_id: "demo-request",
	name: "write_file",
	tool_type: "builtin",
	arguments: { path: "/mnt/session/report.md", content: "# 调研结果\n请核对文件写入范围。" },
	actionable: true,
	status: "pending",
};

const GROUP_REQUESTS: ChatToolApproval[] = [
	REQUEST,
	{
		batch_id: "demo-batch",
		call_id: "demo-call-2",
		request_event_id: "demo-request-2",
		name: "bash",
		tool_type: "builtin",
		arguments: { command: "ls -la /mnt/session" },
		actionable: true,
		status: "pending",
	},
	{
		batch_id: "demo-batch",
		call_id: "demo-call-3",
		request_event_id: "demo-request-3",
		name: "web_search",
		tool_type: "builtin",
		arguments: { query: "kit chat-ui 组件库" },
		actionable: true,
		status: "pending",
	},
];

/** 允许与拒绝一步直提：完整参数已可见，提交中按钮进入 busy，成功后卡片只显示状态。 */
export function ToolApprovalDemo() {
	const [approval, setApproval] = useState(REQUEST);
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className={TOOLBAR_CLASS}>
				<button type="button" className={CONTROL_CLASS} onClick={() => setApproval(REQUEST)}>
					重置示例
				</button>
				<span role="status" className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
					当前状态：{approval.status}
				</span>
			</div>
			<ToolApprovalCard
				approval={approval}
				onDecision={async ({ result }) => {
					await new Promise((resolve) => setTimeout(resolve, 400));
					setApproval((current) => ({ ...current, status: "submitted", result }));
				}}
				onRefresh={async () => setApproval(REQUEST)}
			/>
		</div>
	);
}

type RecoveryCase = "error" | "uncertain" | "stale" | "readonly";

const RECOVERY_CASES = [
	["error", "提交失败"],
	["uncertain", "提交结果不明"],
	["stale", "审批已失效"],
	["readonly", "仅供查看"],
] as const;

/** 异常与恢复：提交失败显示错误行；uncertain/stale 提供刷新入口；非 actionable 卡保留停止执行。 */
export function ToolApprovalRecoveryDemo() {
	const [approvalCase, setApprovalCase] = useState<RecoveryCase>("uncertain");
	const [approval, setApproval] = useState<ChatToolApproval>({ ...REQUEST, status: "uncertain" });
	const [note, setNote] = useState("提交结果不明：请先刷新确认，连接恢复不会自动重发。");
	const switchCase = (next: RecoveryCase) => {
		setApprovalCase(next);
		setNote(
			next === "error"
				? "允许或拒绝会提交失败，卡片显示错误行并保持可重试。"
				: next === "readonly"
					? "信息不完整或类型不受支持：仅供查看，保留停止执行。"
					: "刷新重新查询审批结果与有效待办。",
		);
		if (next === "uncertain") setApproval({ ...REQUEST, status: "uncertain" });
		else if (next === "stale") setApproval({ ...REQUEST, status: "stale" });
		else if (next === "readonly") setApproval({ ...REQUEST, actionable: false });
		else setApproval(REQUEST);
	};
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					场景
					<select
						aria-label="异常场景"
						className={CONTROL_CLASS}
						value={approvalCase}
						onChange={(event) => switchCase(event.target.value as RecoveryCase)}
					>
						{RECOVERY_CASES.map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</label>
			</div>
			<ToolApprovalCard
				approval={approval}
				onDecision={
					approvalCase === "error"
						? async () => {
								await new Promise((resolve) => setTimeout(resolve, 400));
								throw new Error("审批请求超时，请重试");
							}
						: async ({ result }) => setApproval((current) => ({ ...current, status: "submitted", result }))
				}
				onRefresh={async () => {
					setApproval(REQUEST);
					setApprovalCase("error");
					setNote("已刷新，恢复为待审批。");
				}}
				onStop={() => setNote("已中断执行（演示，不连接服务）。")}
			/>
			<p role="status" className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
				{note}
			</p>
		</div>
	);
}

/** 多项待审批一次显示一张卡：‹ 1/3 › 翻页，处理完自动跳到剩余待审批。 */
export function ToolApprovalGroupDemo() {
	const [approvals, setApprovals] = useState(GROUP_REQUESTS);
	const pendingCount = approvals.filter((approval) => approval.status === "pending").length;
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className={TOOLBAR_CLASS}>
				<button type="button" className={CONTROL_CLASS} onClick={() => setApprovals(GROUP_REQUESTS)}>
					重置示例
				</button>
				<span role="status" className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
					剩余待审批：{pendingCount}
				</span>
			</div>
			<ToolApprovalGroup
				approvals={approvals}
				onDecision={async ({ batch_id, call_id, result }) => {
					await new Promise((resolve) => setTimeout(resolve, 400));
					setApprovals((current) =>
						current.map((approval) =>
							approval.batch_id === batch_id && approval.call_id === call_id
								? { ...approval, status: "submitted", result }
								: approval,
						),
					);
				}}
				onRefresh={async () => setApprovals(GROUP_REQUESTS)}
			/>
		</div>
	);
}
