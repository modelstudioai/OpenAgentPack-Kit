import type { ChatToolApproval } from "@openagentpack/kit-sdk/chat";
import type { ToolApprovalDecision } from "@openagentpack/kit-sdk/protocol";
import { useState } from "react";

export interface ToolApprovalCardProps {
	approval: ChatToolApproval;
	onDecision: (decision: ToolApprovalDecision) => Promise<void>;
	onRefresh: () => Promise<void>;
	onStop?: () => void;
}

const BUTTON =
	"rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] px-3 py-1.5 text-[length:var(--kit-text-label)] disabled:cursor-not-allowed disabled:opacity-50";
const ACCENT_BUTTON =
	"rounded-[var(--kit-radius-sm)] bg-[var(--kit-accent)] px-3 py-1.5 font-semibold text-[length:var(--kit-text-label)] text-[var(--kit-accent-fg)] disabled:cursor-not-allowed disabled:opacity-70";
const QUIET_BUTTON =
	"rounded-[var(--kit-radius-sm)] px-2 py-1 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)] transition-colors hover:text-[var(--kit-fg)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]";

function serialize(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2) ?? "未提供参数";
	} catch {
		return "参数无法显示";
	}
}

/** 参数摘要：首个字符串参数的 key: value；多数场景无需展开即可判断。 */
function paramSummary(args: unknown): string | undefined {
	const truncate = (text: string) => {
		const compact = text.replace(/\s+/g, " ").trim();
		return compact.length > 40 ? `${compact.slice(0, 40)}…` : compact;
	};
	if (!args || typeof args !== "object" || Array.isArray(args))
		return typeof args === "string" && args.trim() ? truncate(args) : undefined;
	for (const [key, value] of Object.entries(args)) {
		if (typeof value === "string" && value.length > 0) return `${key}: ${truncate(value)}`;
	}
	return undefined;
}

const LABELS: Record<ChatToolApproval["status"], string> = {
	pending: "等待审批",
	submitting: "正在提交…",
	submitted: "已提交，等待执行状态",
	uncertain: "提交结果不明，请先刷新确认",
	stale: "审批已失效或已处理",
};

/** 主操作只保留允许和拒绝，均为一步直提；不可恢复状态（submitting/submitted）不出任何按钮。 */
function CardActions({
	approval,
	actionable,
	busy,
	onAllow,
	onDeny,
	onRefresh,
	onStop,
}: {
	approval: ChatToolApproval;
	actionable: boolean;
	busy: boolean;
	onAllow: () => void;
	onDeny: () => void;
	onRefresh: () => Promise<void>;
	onStop?: () => void;
}) {
	if (actionable) {
		return (
			<div className="mt-3 flex items-center justify-end gap-2">
				<button type="button" className={BUTTON} onClick={onDeny} disabled={busy}>
					拒绝
				</button>
				<button type="button" className={ACCENT_BUTTON} onClick={onAllow} disabled={busy}>
					{busy ? "正在提交…" : "允许"}
				</button>
			</div>
		);
	}
	return (
		<div className="mt-3 flex items-center justify-end gap-2">
			{!approval.actionable && onStop ? (
				<button type="button" className={QUIET_BUTTON} onClick={onStop}>
					停止执行
				</button>
			) : null}
			{approval.status === "uncertain" || approval.status === "stale" ? (
				<button type="button" className={QUIET_BUTTON} onClick={() => void onRefresh()} disabled={busy}>
					{busy ? "正在刷新…" : "刷新审批状态"}
				</button>
			) : null}
		</div>
	);
}

/** 参数摘要与「查看参数」同行：摘要占左侧，右侧切换展开完整 JSON 原文（等宽、不按 HTML 执行）。 */
function ParameterPreview({ summary, parameters }: { summary?: string; parameters: string }) {
	return (
		<details className="kit-collapse group mt-3 min-w-0 rounded-[var(--kit-radius-sm)] bg-[var(--kit-bg-subtle)]">
			<summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 select-none [&::-webkit-details-marker]:hidden">
				<span className="min-w-0 flex-1 truncate font-mono text-[length:var(--kit-text-caption)] text-[var(--kit-fg)]">
					{summary}
				</span>
				<span className="flex shrink-0 items-center gap-1 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)] transition-colors group-hover:text-[var(--kit-fg)]">
					查看参数
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						aria-hidden="true"
						className="size-3.5 transition-transform group-open:rotate-90"
					>
						<path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
					</svg>
				</span>
			</summary>
			<pre className="group-open:animate-[var(--kit-animate-expand)] border-t border-[var(--kit-border)] px-3 py-2 whitespace-pre-wrap font-mono text-[length:var(--kit-text-caption)] [overflow-wrap:anywhere]">
				{parameters}
			</pre>
		</details>
	);
}

/**
 * HITL 审批卡：冻结参数卡上完整可查，允许与拒绝都是一步直提，不弹确认窗；
 * 提交后由服务端按 Provider 最新状态再次校验。只展示调用方提供的审批状态，不自动重发；
 * 结果不明或过期时用安静的恢复入口刷新。
 */
export function ToolApprovalCard({ approval, onDecision, onRefresh, onStop }: ToolApprovalCardProps) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const parameters = serialize(approval.arguments);
	const actionable = approval.actionable && approval.status === "pending";
	const summary = paramSummary(approval.arguments);
	const decide = async (result: "allow" | "deny") => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await onDecision({ batch_id: approval.batch_id, call_id: approval.call_id, result });
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "审批提交失败，请刷新状态");
		} finally {
			setBusy(false);
		}
	};
	const refresh = async () => {
		setBusy(true);
		setError(null);
		try {
			await onRefresh();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "刷新失败，请重试");
		} finally {
			setBusy(false);
		}
	};
	return (
		<section
			aria-label={`工具审批 ${approval.name}`}
			className="my-2 min-w-0 rounded-[var(--kit-radius)] border border-[var(--kit-border)] bg-[var(--kit-surface)] p-4 text-[length:var(--kit-text-label)] animate-[var(--kit-animate-in)]"
		>
			<div className="flex min-w-0 items-center gap-2">
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					aria-hidden="true"
					className="size-4 shrink-0 text-[var(--kit-warning-fg)]"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z M12 9v4 M12 17h.01"
					/>
				</svg>
				<p className="min-w-0 flex-1 font-semibold text-[var(--kit-fg)] [overflow-wrap:anywhere]">
					Agent 请求执行工具 {approval.name || "未知工具"}
				</p>
				<span className="shrink-0 rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] px-1.5 py-0.5 font-mono text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
					{approval.tool_type || "未知类型"}
				</span>
				<span
					role="status"
					className="ml-auto shrink-0 text-[length:var(--kit-text-caption)] font-normal text-[var(--kit-fg-muted)]"
				>
					{LABELS[approval.status]}
				</span>
			</div>
			<ParameterPreview summary={summary} parameters={parameters} />
			{!approval.actionable ? (
				<p className="mt-2 text-[length:var(--kit-text-label)] text-[var(--kit-fg-muted)]">
					审批请求信息不完整或类型不受支持，仅供查看。请刷新状态或停止执行。
				</p>
			) : null}
			<CardActions
				approval={approval}
				actionable={actionable}
				busy={busy}
				onAllow={() => void decide("allow")}
				onDeny={() => void decide("deny")}
				onRefresh={refresh}
				onStop={onStop}
			/>
			{error ? (
				<p role="alert" className="mt-2 text-[length:var(--kit-text-label)] text-[var(--kit-danger)]">
					{error}
				</p>
			) : null}
		</section>
	);
}
