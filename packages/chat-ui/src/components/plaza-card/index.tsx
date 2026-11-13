import { PLAZA_CATEGORY_LABELS, type PlazaEntry } from "@openagentpack/kit-sdk/protocol";
import type { ReactNode } from "react";
import { isIconImageSource } from "../agent-header/index.tsx";

/** stroke 风格小图标（能力徽标、试试问与行动按钮共用）。 */
function MiniIcon({ children, className }: { children: ReactNode; className: string }) {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			{children}
		</svg>
	);
}

/** 能力徽标的展示顺序与文案；仅渲染 capabilities 中为 true 的项。 */
const CAPABILITIES: { key: keyof PlazaEntry["capabilities"]; label: string }[] = [
	{ key: "streaming", label: "流式输出" },
	{ key: "fileUpload", label: "文件上传" },
	{ key: "artifacts", label: "产物" },
	{ key: "threads", label: "多会话" },
	{ key: "reasoning", label: "深度思考" },
];

const CAPABILITY_ICONS: Record<keyof PlazaEntry["capabilities"], ReactNode> = {
	streaming: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />,
	fileUpload: (
		<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
	),
	artifacts: (
		<>
			<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
			<path d="m3.3 7 8.7 5 8.7-5" />
			<path d="M12 22V12" />
		</>
	),
	threads: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
	reasoning: (
		<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
	),
};

/** last_used_at → 「今天 / 昨天 / N 天前使用过」；按本地日历日差计算，`now` 仅供测试注入。 */
export function relativeUsedLabel(iso: string, now = new Date()): string {
	const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
	const days = Math.round((startOf(now) - startOf(new Date(iso))) / 86_400_000);
	if (days <= 0) return "今天使用过";
	if (days === 1) return "昨天使用过";
	return `${days} 天前使用过`;
}

/** 广场 Agent 卡片：图标与名称、分类/精选/我的、描述（开场白回退）、能力徽标、用量统计及主行动按钮。 */
export function PlazaCard({ entry, onOpen }: { entry: PlazaEntry; onOpen: (slug: string) => void }) {
	const description = entry.description ?? entry.opening_remarks;
	const prompt = entry.suggested_prompts[0];
	return (
		<div className="flex min-w-0 flex-col gap-3.5 rounded-[var(--kit-radius)] border border-[var(--kit-border)] bg-[var(--kit-surface)] p-4 hover:-translate-y-0.5 hover:border-[var(--kit-accent)]/40 hover:shadow-[var(--kit-shadow)] focus-within:shadow-[var(--kit-shadow)] motion-safe:transition sm:p-5">
			<div className="flex min-w-0 items-center gap-3">
				<div
					className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[var(--kit-radius-icon)] bg-[linear-gradient(135deg,var(--kit-user-bubble),var(--kit-stat-tint))] text-[length:var(--kit-text-prose-title)]"
					aria-hidden
				>
					{isIconImageSource(entry.icon) ? (
						<img src={entry.icon} alt="" className="h-8 w-8 object-contain" />
					) : (
						(entry.icon ?? "🤖")
					)}
				</div>
				<div className="min-w-0 flex-1">
					<h3 className="truncate text-[length:var(--kit-text-heading)] font-semibold" title={entry.display_name}>
						{entry.display_name}
					</h3>
					<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
						{entry.featured ? (
							<span className="rounded-full bg-[var(--kit-warning)]/15 px-2 py-0.5 text-[length:var(--kit-text-meta)] font-medium text-[var(--kit-warning)]">
								精选
							</span>
						) : null}
						<span className="rounded-full bg-[var(--kit-bg-subtle)] px-2 py-0.5 text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)]">
							{PLAZA_CATEGORY_LABELS[entry.category]}
						</span>
						{entry.stats.mine ? (
							<span className="rounded-full bg-[var(--kit-success)]/15 px-2 py-0.5 text-[length:var(--kit-text-meta)] text-[var(--kit-success)]">
								我的
							</span>
						) : null}
					</div>
				</div>
			</div>
			<p
				className={`line-clamp-2 min-h-[3.25em] text-[length:var(--kit-text-label)] leading-relaxed text-[var(--kit-fg-muted)] [overflow-wrap:anywhere] ${description ? "" : "opacity-65"}`}
				title={description ?? undefined}
			>
				{description ?? "暂无描述"}
			</p>
			{prompt ? (
				<div className="flex min-w-0 items-center gap-1.5 rounded-[var(--kit-radius-sm)] bg-[var(--kit-bg-subtle)] px-2.5 py-1.5 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
					<MiniIcon className="h-3.5 w-3.5 shrink-0 text-[var(--kit-accent)]">
						<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
						<path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
					</MiniIcon>
					<span className="min-w-0 truncate">试试问：「{prompt}」</span>
				</div>
			) : null}
			<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
				{CAPABILITIES.filter((cap) => entry.capabilities[cap.key]).map((cap) => (
					<span
						key={cap.key}
						className="flex min-w-0 items-center gap-1 text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)]"
					>
						<MiniIcon className="h-3.5 w-3.5 shrink-0 text-[var(--kit-accent)]">{CAPABILITY_ICONS[cap.key]}</MiniIcon>
						{cap.label}
					</span>
				))}
			</div>
			<div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-[var(--kit-border-subtle)] pt-3">
				<span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)] [overflow-wrap:anywhere]">
					<span>
						近 30 天 <b className="text-[var(--kit-fg)]">{entry.stats.turns_30d}</b> 次
					</span>
					{entry.stats.last_used_at ? (
						<>
							<span aria-hidden className="opacity-50">
								·
							</span>
							<span>{relativeUsedLabel(entry.stats.last_used_at)}</span>
						</>
					) : null}
				</span>
				<button
					type="button"
					onClick={() => onOpen(entry.slug)}
					className="flex min-h-9 shrink-0 items-center gap-1 rounded-[var(--kit-radius-sm)] bg-[var(--kit-accent)] px-3 py-2 text-[length:var(--kit-text-caption)] font-medium text-[var(--kit-accent-fg)] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] motion-safe:transition motion-safe:active:scale-95"
				>
					开始体验
					<MiniIcon className="h-3.5 w-3.5">
						<path d="M5 12h14" />
						<path d="m12 5 7 7-7 7" />
					</MiniIcon>
				</button>
			</div>
		</div>
	);
}
