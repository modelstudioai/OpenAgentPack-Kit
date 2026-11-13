import type { AgentSummary } from "@openagentpack/kit-sdk/protocol";
import type { ReactNode } from "react";

export interface AgentHeaderProps {
	agent: AgentSummary | null;
	/** 同时传入列表与回调时，标题渲染为 Agent 切换器。 */
	agents?: AgentSummary[];
	onPickAgent?: (slug: string) => void;
	/** 标题左侧的入口，如移动端侧栏开关。 */
	leading?: ReactNode;
	/** 使用固定高度的工作区页头，省略描述并约束右侧操作宽度。 */
	compact?: boolean;
	/** 显式传入时替代默认的新会话按钮；传 null 可隐藏操作区。 */
	actions?: ReactNode;
	onNewSession?: () => void;
}

/** 图片地址使用 img，其余图标值（如 emoji）按文本展示。 */
export function isIconImageSource(icon: string | undefined): boolean {
	return Boolean(icon && /^(https?:|data:|\/|\.\/)/.test(icon));
}

function AgentIcon({ agent, compact }: Pick<AgentHeaderProps, "agent" | "compact">) {
	return (
		<div
			className={`grid shrink-0 place-items-center rounded-[var(--kit-radius-icon-sm)] bg-[var(--kit-user-bubble)] text-lg ${compact ? "h-8 w-8 overflow-hidden border border-[var(--kit-border-subtle)]" : "h-9 w-9"}`}
			aria-hidden
		>
			{isIconImageSource(agent?.icon) ? (
				<img src={agent?.icon} alt="" className={compact ? "h-5 w-5 object-contain" : "h-[22px] w-[22px]"} />
			) : (
				(agent?.icon ?? "🤖")
			)}
		</div>
	);
}

function AgentTitle({
	agent,
	agents,
	onPickAgent,
	compact,
}: Pick<AgentHeaderProps, "agent" | "agents" | "onPickAgent" | "compact">) {
	const name = agent?.display_name ?? "未选择 Agent";
	if (!agents?.length || !onPickAgent) {
		return (
			<strong
				title={name}
				className={`block truncate ${compact ? "text-[length:var(--kit-text-heading)] leading-snug" : "text-[length:var(--kit-text-body)]"}`}
			>
				{name}
			</strong>
		);
	}
	return (
		<div className={compact ? "relative inline-flex max-w-full align-middle" : "contents"}>
			<select
				aria-label="切换 Agent"
				title={name}
				value={agent?.slug ?? ""}
				onChange={(event) => onPickAgent(event.target.value)}
				className={`block w-auto min-w-0 max-w-full truncate rounded-[var(--kit-radius-sm)] border border-transparent bg-transparent font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] ${compact ? "cursor-pointer appearance-none py-1.5 pl-2 pr-8 text-[length:var(--kit-text-heading)] leading-snug transition-colors hover:bg-[var(--kit-bg-subtle)] [&>option]:bg-[var(--kit-surface)]" : "px-1 py-0.5 text-[length:var(--kit-text-body)] hover:border-[var(--kit-border)]"}`}
			>
				{agents.map((item) => (
					<option key={item.slug} value={item.slug}>
						{item.display_name}
					</option>
				))}
			</select>
			{compact ? (
				<svg
					aria-hidden="true"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kit-fg-muted)]"
				>
					<path d="m6 9 6 6 6-6" />
				</svg>
			) : null}
		</div>
	);
}

export function AgentHeader({
	agent,
	agents,
	onPickAgent,
	leading,
	compact = false,
	actions,
	onNewSession,
}: AgentHeaderProps) {
	const actionContent =
		actions !== undefined ? (
			actions
		) : onNewSession ? (
			<button
				type="button"
				onClick={onNewSession}
				className="rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] bg-[var(--kit-bg-subtle)] px-3 py-1.5 text-[length:var(--kit-text-label)]"
			>
				新会话
			</button>
		) : null;
	return (
		<header
			className={`flex min-w-0 items-center border-b border-[var(--kit-border-subtle)] ${compact ? "h-16 shrink-0 gap-3 bg-[var(--kit-bg)] px-3 md:px-6" : "gap-3 px-4 py-3"}`}
		>
			{compact && leading ? <div className="flex shrink-0 items-center">{leading}</div> : leading}
			<AgentIcon agent={agent} compact={compact} />
			<div className="min-w-0 flex-1">
				<AgentTitle agent={agent} agents={agents} onPickAgent={onPickAgent} compact={compact} />
				{!compact ? (
					<div className="truncate text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
						{agent?.description ?? ""}
					</div>
				) : null}
			</div>
			{compact && actionContent ? (
				<div className="flex min-w-0 max-w-[40%] shrink-0 items-center justify-end gap-2">{actionContent}</div>
			) : (
				actionContent
			)}
		</header>
	);
}
