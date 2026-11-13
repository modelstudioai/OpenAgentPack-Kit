import type { MessagePart } from "@openagentpack/kit-sdk/messages";
import { useEffect, useState } from "react";
import { ReasoningBlock } from "../reasoning-block/index.tsx";
import { ProcessDots } from "../step/index.tsx";
import { ToolCallCard } from "../tool-call-card/index.tsx";

type ProcessPart = Extract<MessagePart, { type: "reasoning" }> | Extract<MessagePart, { type: "tool" }>;

export type { ProcessPart };

export function isProcessPart(part: MessagePart): part is ProcessPart {
	return part.type === "reasoning" || part.type === "tool";
}

function formatDuration(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	if (total < 60) return `${total}s`;
	const minutes = Math.floor(total / 60);
	if (minutes < 60) return `${minutes}m${total % 60}s`;
	return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

/** 运行中每秒重算；完成后用结束时间戳定格。缺时间戳（旧数据/手构消息）不显示时长。 */
function useElapsed(start?: string, running = false, end?: string): string | null {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!running || !start) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [running, start]);
	if (!start) return null;
	const from = Date.parse(start);
	if (Number.isNaN(from)) return null;
	const to = running ? now : end ? Date.parse(end) : Number.NaN;
	if (Number.isNaN(to)) return null;
	return formatDuration(to - from);
}

/**
 * 回合执行容器：把消息内连续的思考/工具分片折成一组，一次折叠收起全部执行痕迹。
 * 头部显示运行状态与耗时；步骤沿左侧竖线排成时间线。正文（text 分片）不属于容器。
 */
export function ExecutionGroup({
	parts,
	createdAt,
	messageStreaming = false,
	ended = false,
	className = "",
}: {
	parts: ProcessPart[];
	createdAt?: string;
	/** 所属消息仍在流式输出：最后一组保持展开等待后续步骤，已结束的组照常收起。 */
	messageStreaming?: boolean;
	/** 本组之后已出现正文等分片，说明该轮执行已结束，流式期间也收起。 */
	ended?: boolean;
	/** 追加到容器根节点（details）的工具类。 */
	className?: string;
}) {
	const running = parts.some(
		(part) =>
			(part.type === "tool" && part.status === "running") || (part.type === "reasoning" && part.status === "streaming"),
	);
	const failed = parts.some(
		(part) =>
			(part.type === "tool" && part.status === "error") || (part.type === "reasoning" && part.status === "failed"),
	);
	const start = parts.find((part) => part.startedAt)?.startedAt ?? createdAt;
	const end = parts.reduce<number>((latest, part) => {
		if (part.type !== "tool" || !part.endedAt) return latest;
		const time = Date.parse(part.endedAt);
		return Number.isNaN(time) ? latest : Math.max(latest, time);
	}, 0);
	const elapsed = useElapsed(start, running, end > 0 ? new Date(end).toISOString() : undefined);
	const label = running ? "正在执行" : failed ? "执行出错" : "已执行";
	// 运行中展开；消息流式期间仅最后一组保持展开（等待后续步骤，步骤间隙不抖动），
	// 被正文终结的组与消息完成后的所有组收起。属性值不变时保留用户手动展开/收起。
	const open = running || (messageStreaming && !ended);
	return (
		<details
			open={open}
			aria-label="执行过程"
			className={`kit-collapse group/exec my-2 min-w-0 text-[length:var(--kit-text-label)] animate-[var(--kit-animate-in)] ${className}`}
		>
			<summary className="flex min-w-0 cursor-pointer list-none items-center gap-2.5 rounded-[var(--kit-radius-sm)] px-2 py-1.5 text-[var(--kit-fg-muted)] transition-colors select-none hover:bg-[var(--kit-bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] [&::-webkit-details-marker]:hidden">
				<span
					aria-hidden="true"
					className={`grid size-6 shrink-0 place-items-center rounded-[var(--kit-radius-icon-sm)] transition-colors ${running ? "bg-[var(--kit-accent)]/10 text-[var(--kit-accent)]" : failed ? "bg-[var(--kit-danger)]/10 text-[var(--kit-danger)]" : "bg-[var(--kit-bg-subtle)] text-[var(--kit-fg-muted)]"}`}
				>
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						aria-hidden="true"
						className="size-4 transition-transform group-open/exec:rotate-90"
					>
						<path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
					</svg>
				</span>
				<span className="inline-flex shrink-0 items-center gap-1 text-[var(--kit-fg)]">
					{running ? <span className="kit-shimmer-text">{label}</span> : label}
					{running ? <ProcessDots /> : null}
				</span>
				{elapsed ? (
					<span
						className={`shrink-0 font-mono text-[length:var(--kit-text-caption)] tabular-nums ${running ? "kit-shimmer-text" : "text-[var(--kit-fg-muted)]"}`}
					>
						· {elapsed}
					</span>
				) : null}
				<span className="ml-auto shrink-0 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
					{parts.length} 步
				</span>
			</summary>
			{/* 竖线对准头部折叠按钮的中心（px-2 + size-6 的一半 = 20px） */}
			<div className="my-1 ml-5 border-l border-[var(--kit-border)] pl-3">
				{parts.map((part, index) =>
					part.type === "reasoning" ? (
						<ReasoningBlock key={part.id ?? `reasoning:${index}`} text={part.text} status={part.status} />
					) : (
						<ToolCallCard key={part.id ?? `tool:${part.toolId}:${index}`} part={part} />
					),
				)}
			</div>
		</details>
	);
}
