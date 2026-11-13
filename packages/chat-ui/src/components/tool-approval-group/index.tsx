import type { ChatToolApproval } from "@openagentpack/kit-sdk/chat";
import type { ToolApprovalDecision } from "@openagentpack/kit-sdk/protocol";
import { useState } from "react";
import { ToolApprovalCard } from "../tool-approval-card/index.tsx";

const PAGER_BUTTON =
	"grid size-6 place-items-center rounded-[var(--kit-radius-sm)] text-[var(--kit-fg-muted)] transition-colors hover:bg-[var(--kit-bg-subtle)] hover:text-[var(--kit-fg)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]";

/**
 * 多个待审批横向切换：一次只显示一张卡（不纵向铺平），用 ‹ 1/2 › 翻页。
 * 当前项被处理后自动跳到剩余的待审批；用户手动切换的选择始终保留。
 */
export function ToolApprovalGroup({
	approvals,
	onDecision,
	onRefresh,
	onStop,
}: {
	approvals: ChatToolApproval[];
	onDecision: (decision: ToolApprovalDecision) => Promise<void>;
	onRefresh: () => Promise<void>;
	onStop?: () => void;
}) {
	const [selected, setSelected] = useState<string | null>(null);
	const keyOf = (approval: ChatToolApproval) => `${approval.batch_id}:${approval.call_id}`;
	const keys = approvals.map(keyOf);
	const current =
		approvals.find((approval) => keyOf(approval) === selected) ??
		approvals.find((approval) => approval.status === "pending") ??
		approvals[0];
	if (!current) return null;
	const index = keys.indexOf(keyOf(current));
	return (
		<div className="min-w-0">
			{approvals.length > 1 ? (
				<div className="flex items-center justify-end gap-1 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
					<button
						type="button"
						aria-label="上一个审批"
						className={PAGER_BUTTON}
						disabled={index <= 0}
						onClick={() => setSelected(keyOf(approvals[index - 1]!))}
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							aria-hidden="true"
							className="size-4"
						>
							<path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
						</svg>
					</button>
					<span className="min-w-10 text-center font-mono tabular-nums">
						{index + 1} / {approvals.length}
					</span>
					<button
						type="button"
						aria-label="下一个审批"
						className={PAGER_BUTTON}
						disabled={index >= approvals.length - 1}
						onClick={() => setSelected(keyOf(approvals[index + 1]!))}
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							aria-hidden="true"
							className="size-4"
						>
							<path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
						</svg>
					</button>
				</div>
			) : null}
			<ToolApprovalCard approval={current} onDecision={onDecision} onRefresh={onRefresh} onStop={onStop} />
		</div>
	);
}
