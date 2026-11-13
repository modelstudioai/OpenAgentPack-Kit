import type { ReactNode } from "react";

/** 空闲状态点（无生命周期的静态步骤）。 */
const DOT = "size-2 shrink-0 rounded-full";

function dotTone(state: "idle" | "done" | "failed"): string {
	switch (state) {
		case "done":
			return "bg-[var(--kit-success)]";
		case "failed":
			return "bg-[var(--kit-danger)]";
		default:
			return "bg-[var(--kit-border)]";
	}
}

/** 运行指示环：仅允许动态效果时旋转，减少动态效果偏好下保持静止。 */
export function ProcessSpinner({ className = "" }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`motion-safe:animate-spin ${className}`}>
			<circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.2" />
			<path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
		</svg>
	);
}

/** 运行中文案后的动态省略号；每颗点错峰呼吸，减少动态效果偏好下为静态省略号。 */
export function ProcessDots() {
	return (
		<span aria-hidden="true" className="inline-flex tracking-[0.1em]">
			{[0, 160, 320].map((delay) => (
				<span key={delay} className="motion-safe:animate-pulse" style={{ animationDelay: `${delay}ms` }}>
					.
				</span>
			))}
		</span>
	);
}

/** 步骤状态图标：运行中指示环、完成对勾、失败叉，都缩进在时间线内侧。 */
function StepMarker({ state, className = "" }: { state: "idle" | "running" | "done" | "failed"; className?: string }) {
	if (state === "running")
		return <ProcessSpinner className={`size-3.5 shrink-0 text-[var(--kit-accent)] ${className}`} />;
	if (state === "done" || state === "failed")
		return (
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.5"
				aria-hidden="true"
				className={`size-3.5 shrink-0 ${state === "done" ? "text-[var(--kit-success)]" : "text-[var(--kit-danger)]"} ${className}`}
			>
				{state === "done" ? (
					<path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
				) : (
					<path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
				)}
			</svg>
		);
	return <span aria-hidden="true" className={`${DOT} ${dotTone(state)} ${className}`} />;
}

/**
 * 执行过程的时间线步骤行：状态图标 + 动词 + 行内内容预览 + 状态，默认收起。
 * 图标随行内排布（缩进在时间线竖线内侧），展开详情沿子级竖线缩进。
 */
export function ProcessStep({
	verb,
	preview,
	status,
	state,
	ariaLabel,
	className = "",
	contentMaxHeight = "max-h-80",
	children,
}: {
	verb: ReactNode;
	/** 同一行露出的内容预览（如思考正文首行、工具操作对象）；超出截断。 */
	preview?: ReactNode;
	status?: string;
	state: "idle" | "running" | "done" | "failed";
	ariaLabel: string;
	/** 追加到卡片根节点（details）的工具类。 */
	className?: string;
	/** 展开内容区的限高工具类（默认 max-h-80：超长内容卡片内滚动，不撑开页面）。
	 * 传入即整体替换默认值——同类工具类叠加会由 CSS 顺序决定胜负，所以不做拼接；
	 * 传 "max-h-none" 取消限高。 */
	contentMaxHeight?: string;
	children: ReactNode;
}) {
	return (
		<details
			aria-label={ariaLabel}
			className={`kit-collapse group/step min-w-0 text-[length:var(--kit-text-label)] animate-[var(--kit-animate-in)] ${className}`}
		>
			<summary className="flex min-w-0 cursor-pointer list-none items-center gap-2.5 rounded-[var(--kit-radius-sm)] px-2 py-1.5 text-[var(--kit-fg-muted)] transition-colors select-none hover:bg-[var(--kit-bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] [&::-webkit-details-marker]:hidden">
				<StepMarker state={state} />
				<span className="min-w-0 text-[var(--kit-fg)] [overflow-wrap:anywhere]">{verb}</span>
				{preview ? (
					<span className="flex min-w-0 flex-1 items-baseline gap-1.5 font-mono text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
						<span aria-hidden="true">·</span>
						<span className="min-w-0 flex-1 truncate">{preview}</span>
					</span>
				) : null}
				{status ? (
					<span
						className={`inline-flex shrink-0 items-center gap-1 text-[length:var(--kit-text-caption)] ${state === "failed" ? "text-[var(--kit-danger)]" : ""} ${preview ? "" : "ml-auto"}`}
					>
						{status}
						{state === "running" ? <ProcessDots /> : null}
					</span>
				) : null}
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					aria-hidden="true"
					className={`size-4 shrink-0 transition-transform group-open/step:rotate-90 ${preview ? "" : "ml-auto"}`}
				>
					<path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
				</svg>
			</summary>
			<div
				className={`group-open/step:animate-[var(--kit-animate-expand)] mt-1.5 mb-2 ${contentMaxHeight} min-w-0 overflow-y-auto border-l border-[var(--kit-border)] py-1 pr-2 pl-4 ml-8`}
			>
				{children}
			</div>
		</details>
	);
}

/** 值展示的公共容器：标题 + 内容块；不猜测内容语义，由调用方决定渲染方式。 */
export function ProcessValue({ label, children }: { label: string; children: ReactNode }) {
	return (
		<section className="min-w-0">
			<p className="mb-1.5 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">{label}</p>
			{children}
		</section>
	);
}

export function ProcessValueCode({ text }: { text: string }) {
	return (
		<pre className="font-mono text-[length:var(--kit-text-caption)] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">
			{text}
		</pre>
	);
}
