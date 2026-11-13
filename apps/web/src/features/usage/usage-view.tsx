import { ActivityHeatmap, EmptyState, ErrorState, isIconImageSource, MeterBar } from "@openagentpack/kit-chat-ui";
import { useAgentCatalog } from "@openagentpack/kit-sdk/agents/hooks";
import type { AgentSummary, QuotaRequestView, QuotaView } from "@openagentpack/kit-sdk/protocol";
import { useCreateQuotaRequest, useQuota, useQuotaRequests, useUsageLimits } from "@openagentpack/kit-sdk/usage/hooks";
import { type ReactNode, useCallback, useState } from "react";
import { formatBeijingTime } from "../../lib/beijing-time.ts";
import type { NavigateFn } from "../../lib/use-route.ts";
import { ApplyCreditsDialog, type ApplyCreditsValues } from "./apply-credits-dialog.tsx";
import { MemberUsageView } from "./member-usage-limits.tsx";

function AgentIcon({ agent, className }: { agent: AgentSummary | undefined; className: string }) {
	return (
		<span className={`grid shrink-0 place-items-center bg-[var(--kit-surface)] ${className}`} aria-hidden>
			{isIconImageSource(agent?.icon) ? (
				<img src={agent?.icon} alt="" className="h-3/5 w-3/5 object-contain" />
			) : (
				(agent?.icon ?? "🤖")
			)}
		</span>
	);
}

/** 申请状态复用主题语义色，亮暗主题由 token 统一控制。 */
function Chip({ tone, children }: { tone: "warn" | "ok" | "bad" | "muted"; children: ReactNode }) {
	const tones: Record<string, string> = {
		warn: "bg-[var(--kit-warning)]/15 text-[var(--kit-warning-fg)]",
		ok: "bg-[var(--kit-success)]/15 text-[var(--kit-success)]",
		bad: "bg-[var(--kit-danger)]/15 text-[var(--kit-danger)]",
		muted: "bg-[var(--kit-bg-subtle)] text-[var(--kit-fg-muted)]",
	};
	return (
		<span className={`rounded-full px-2 py-0.5 text-[length:var(--kit-text-meta)] font-semibold ${tones[tone]}`}>
			{children}
		</span>
	);
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
	return (
		<section className="min-w-0 rounded-[var(--kit-radius)] border border-[var(--kit-border)] bg-[var(--kit-surface)] p-5 [overflow-wrap:anywhere] md:p-6">
			<div className="mb-5 flex flex-wrap items-baseline gap-2">
				<h2 className="text-[length:var(--kit-text-base)] font-semibold">{title}</h2>
				{hint ? <span className="text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)]">{hint}</span> : null}
			</div>
			{children}
		</section>
	);
}

/** 左栏主卡：月度额度 + 加油包 + 申请入口。 */
function CreditsCard({ quota, onApply }: { quota: QuotaView; onApply: () => void }) {
	const unlimited = quota.unlimited || quota.limit < 0;
	const pct = unlimited || quota.limit <= 0 ? 0 : Math.min(100, Math.round((quota.used / quota.limit) * 100));
	const remaining = unlimited || quota.remaining < 0 ? "不限量" : String(quota.remaining);
	const pending = quota.pending_request !== null;
	return (
		<section
			data-testid="usage-meter"
			tabIndex={-1}
			aria-label="每月 Credits 用量"
			className="min-w-0 rounded-[var(--kit-radius)] border border-[var(--kit-border)] bg-[var(--kit-surface)] p-5 [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] md:p-6"
		>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="text-[length:var(--kit-text-base)] font-semibold">每月用量（Credits/月）</h2>
				<span className="text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)]">
					{quota.month} · {formatBeijingTime(quota.reset_at)} 重置
				</span>
			</div>
			<div className="mt-5 text-[length:var(--kit-text-display)] font-semibold leading-snug tabular-nums">
				{unlimited ? (
					"不限量"
				) : (
					<>
						{quota.used}
						<span className="ml-1 text-[length:var(--kit-text-heading)] font-normal text-[var(--kit-fg-muted)]">
							/ {quota.limit}
						</span>
					</>
				)}
			</div>
			<div
				className="mt-2 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]"
				data-testid="usage-meter-summary"
			>
				已使用 {unlimited ? quota.used : `${pct}%`} | 剩余 {remaining}
			</div>
			<MeterBar value={quota.used} max={quota.limit} unlimited={unlimited} className="mt-3" />
			{quota.packs.length > 0 ? (
				<ul className="mt-3 flex flex-col gap-1.5">
					{quota.packs.map((pack) => (
						<li
							key={pack.id}
							className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--kit-radius-sm)] bg-[var(--kit-bg-subtle)] px-3 py-2 text-[length:var(--kit-text-caption)]"
						>
							<span className="min-w-0 flex-1 truncate" title={pack.reason ?? undefined}>
								{pack.reason ?? "加油包"}
							</span>
							<span className="font-semibold text-[var(--kit-success)]">+{pack.credits}</span>
							<span className="text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)]">
								当期重置时失效（{pack.month}）
							</span>
						</li>
					))}
				</ul>
			) : null}
			<div className="mt-4 flex flex-wrap items-center gap-2">
				<button
					type="button"
					data-testid="usage-apply-btn"
					disabled={pending}
					onClick={onApply}
					className="min-h-10 flex-1 rounded-[var(--kit-radius-sm)] bg-[var(--kit-accent)] px-4 py-2 text-[length:var(--kit-text-label)] font-medium text-[var(--kit-accent-fg)] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
				>
					申请 Credits
				</button>
				{pending ? <Chip tone="warn">审批中</Chip> : null}
			</div>
		</section>
	);
}

/** 左栏「我的应用」：per_agent 的 slug 映射回目录条目，点击直达对话。 */
function MyAgents({
	perAgent,
	agents,
	onOpen,
}: {
	perAgent: QuotaView["per_agent"];
	agents: AgentSummary[];
	onOpen: (slug: string) => void;
}) {
	if (perAgent.length === 0) return null;
	return (
		<Panel title="我的应用" hint="点图标继续对话">
			<div className="flex flex-wrap gap-2">
				{perAgent.map((row) => {
					const agent = agents.find((a) => a.slug === row.agent_slug);
					return (
						<button
							key={row.agent_slug}
							type="button"
							onClick={() => onOpen(row.agent_slug)}
							data-testid={`usage-agent-${row.agent_slug}`}
							title={`${agent?.display_name ?? row.agent_slug}：${row.turns} turns`}
							className="flex w-20 min-w-0 flex-col items-center gap-2 rounded-[var(--kit-radius-sm)] border border-transparent p-2 text-[length:var(--kit-text-meta)] transition-colors hover:border-[var(--kit-border)] hover:bg-[var(--kit-bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]"
						>
							<AgentIcon
								agent={agent}
								className="h-10 w-10 rounded-[var(--kit-radius-icon)] text-[length:var(--kit-text-title)]"
							/>
							<span className="w-full truncate">{agent?.display_name ?? row.agent_slug}</span>
						</button>
					);
				})}
			</div>
		</Panel>
	);
}

/** 右栏「用量查询」：按 agent 的 turn 分解（1 Turn = 1 Credit）。 */
function UsageTable({ perAgent, agents }: { perAgent: QuotaView["per_agent"]; agents: AgentSummary[] }) {
	if (perAgent.length === 0)
		return (
			<p className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
				本月还没有使用记录，去广场挑一个 Agent 试试。
			</p>
		);
	const max = perAgent.reduce((m, row) => Math.max(m, row.turns), 0);
	return (
		<table className="w-full table-fixed border-collapse text-[length:var(--kit-text-caption)]">
			<caption className="sr-only">各应用本月使用次数及占比</caption>
			<thead>
				<tr className="text-left text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)]">
					<th scope="col" className="w-8 pb-2 font-medium">
						#
					</th>
					<th scope="col" className="pb-2 font-medium">
						应用
					</th>
					<th scope="col" className="w-16 pb-2 text-right font-medium">
						Turns
					</th>
					<th scope="col" className="w-16 pb-2 pl-3 font-medium sm:w-24">
						占比
					</th>
				</tr>
			</thead>
			<tbody>
				{perAgent.map((row, index) => {
					const agent = agents.find((a) => a.slug === row.agent_slug);
					return (
						<tr key={row.agent_slug} className="border-t border-[var(--kit-border-subtle)] align-middle">
							<td className="py-3">
								<span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--kit-bg-subtle)] text-[length:var(--kit-text-meta)] font-semibold">
									{index + 1}
								</span>
							</td>
							<td className="py-3 pr-2">
								<span className="block truncate" title={agent?.display_name ?? row.agent_slug}>
									{agent?.display_name ?? row.agent_slug}
								</span>
							</td>
							<td className="py-3 text-right tabular-nums [overflow-wrap:anywhere]">{row.turns}</td>
							<td className="py-3 pl-3">
								<MeterBar value={row.turns} max={max} className="h-1.5" />
							</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}

/** 单条申请：状态 chip + 生效方式 + 理由/驳回说明/审批时间。 */
function RequestItem({ item }: { item: QuotaRequestView }) {
	const approved = item.status === "approved";
	return (
		<li
			data-testid={`usage-request-${item.status}`}
			className="min-w-0 rounded-[var(--kit-radius)] border border-[var(--kit-border)] bg-[var(--kit-surface)] p-4 text-[length:var(--kit-text-caption)] leading-relaxed [overflow-wrap:anywhere] md:p-5"
		>
			<div className="flex flex-wrap items-center gap-2">
				{item.status === "pending" ? <Chip tone="warn">审批中</Chip> : null}
				{approved ? <Chip tone="ok">已通过</Chip> : null}
				{item.status === "rejected" ? <Chip tone="bad">已驳回</Chip> : null}
				<span className="font-semibold">申请 {item.requested_credits} Credits</span>
				{approved && item.mode ? (
					<Chip tone="muted">{item.mode === "override" ? "长期上限" : "当月加油包"}</Chip>
				) : null}
				{approved && item.granted_credits !== null ? (
					<span className="font-semibold text-[var(--kit-success)]">+{item.granted_credits}</span>
				) : null}
				<span className="ml-auto text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)]">
					{formatBeijingTime(item.created_at)}
				</span>
			</div>
			{item.reason ? <p className="mt-1.5 text-[var(--kit-fg-muted)]">理由：{item.reason}</p> : null}
			{item.status === "rejected" && item.review_note ? (
				<p className="mt-1.5 text-[var(--kit-danger)]">驳回说明：{item.review_note}</p>
			) : null}
			{item.reviewed_at ? (
				<p className="mt-1.5 text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)]">
					审批于 {formatBeijingTime(item.reviewed_at)}
				</p>
			) : null}
		</li>
	);
}

/** 底部「我的申请」列表。 */
function RequestList({ requests }: { requests: QuotaRequestView[] }) {
	if (requests.length === 0) return null;
	return (
		<section className="mt-8 min-w-0">
			<h2 className="mb-4 text-[length:var(--kit-text-heading)] font-semibold">我的申请</h2>
			<ul className="flex flex-col gap-3">
				{requests.map((item) => (
					<RequestItem key={item.id} item={item} />
				))}
			</ul>
		</section>
	);
}

/** 两栏主体（lg 双栏，H5 单栏堆叠）；早退分支独立成组件，好让申请弹窗在 reload 时不被卸载。 */
function UsageBody({
	quota,
	requests,
	agents,
	error,
	reload,
	onApply,
	onOpenAgent,
}: {
	quota: QuotaView | null;
	requests: QuotaRequestView[];
	agents: AgentSummary[];
	error: string | null;
	reload: () => void;
	onApply: () => void;
	onOpenAgent: (slug: string) => void;
}) {
	if (error)
		return (
			<div className="mt-6 min-w-0 [overflow-wrap:anywhere]">
				<ErrorState message={error} onRetry={reload} />
			</div>
		);
	// 首次加载才出占位；申请成功后的 reload 保留旧数据，避免 meter 闪成「加载中」
	if (!quota)
		return (
			<div className="mt-6 rounded-[var(--kit-radius)] border border-[var(--kit-border-subtle)] bg-[var(--kit-surface)] py-6">
				<EmptyState title="加载中…" loading />
			</div>
		);
	return (
		<>
			<div className="mt-6 grid min-w-0 gap-4 lg:grid-cols-2">
				<div className="flex min-w-0 flex-col gap-4">
					<CreditsCard quota={quota} onApply={onApply} />
					<MyAgents perAgent={quota.per_agent} agents={agents} onOpen={onOpenAgent} />
				</div>
				<div className="flex min-w-0 flex-col gap-4">
					<Panel title="每日活跃情况（近 30 天）">
						<ActivityHeatmap days={quota.daily} />
					</Panel>
					<Panel title="用量查询" hint="1 Turn = 1 Credit">
						<UsageTable perAgent={quota.per_agent} agents={agents} />
					</Panel>
				</div>
			</div>
			<RequestList requests={requests} />
		</>
	);
}

/** 我的用量（?view=usage）：额度卡 + 加油包 + 申请弹窗 + 活跃热力图 + 按应用分解 + 申请历史。 */
function CreditsUsageView({ navigate }: { navigate: NavigateFn }) {
	const { submit: createQuotaRequest } = useCreateQuotaRequest();
	const { quota, error, reload } = useQuota();
	const { requests, reload: reloadRequests } = useQuotaRequests();
	const { agents } = useAgentCatalog();
	const [applyOpen, setApplyOpen] = useState(false);

	const submitRequest = useCallback(
		async (values: ApplyCreditsValues): Promise<string | null> => {
			try {
				await createQuotaRequest({
					requestedCredits: values.requestedCredits,
					...(values.reason ? { reason: values.reason } : {}),
				});
				// 申请成功后额度与历史都要刷新：pending chip 与「我的申请」列表都依赖它们
				reload();
				reloadRequests();
				return null;
			} catch (e) {
				return e instanceof Error ? e.message : String(e);
			}
		},
		[createQuotaRequest, reload, reloadRequests],
	);

	return (
		<div className="h-full min-w-0 overflow-y-auto">
			<div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 md:px-8 md:py-8">
				<h1 className="text-[length:var(--kit-text-display)] font-semibold leading-snug">我的用量</h1>
				<p className="mt-2 text-[length:var(--kit-text-label)] leading-relaxed text-[var(--kit-fg-muted)]">
					Credits 按月发放，1 Turn = 1 Credit；不够用可以在这里申请提额。
				</p>
				<UsageBody
					quota={quota}
					requests={requests}
					agents={agents}
					error={error}
					reload={reload}
					onApply={() => setApplyOpen(true)}
					onOpenAgent={(slug) => navigate({ view: "chat", agent: slug })}
				/>
			</div>
			{applyOpen ? <ApplyCreditsDialog onClose={() => setApplyOpen(false)} onSubmit={submitRequest} /> : null}
		</div>
	);
}

/** 本地成员使用 Token/执行时长限额；仅服务端明确返回 null 时显示兼容 Credits 页面。 */
export function UsageView({ navigate }: { navigate: NavigateFn }) {
	const limits = useUsageLimits();
	if (limits.data) {
		return (
			<MemberUsageView
				view={limits.data}
				loading={limits.loading}
				error={limits.error}
				onReload={() => void limits.reload()}
			/>
		);
	}
	if (limits.error || limits.data === undefined)
		return (
			<div className="h-full min-w-0 overflow-y-auto">
				<div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 [overflow-wrap:anywhere] md:px-8 md:py-8">
					{limits.error ? (
						<ErrorState message={limits.error} onRetry={() => void limits.reload()} />
					) : (
						<div className="rounded-[var(--kit-radius)] border border-[var(--kit-border-subtle)] bg-[var(--kit-surface)] py-6">
							<EmptyState title="正在加载用量…" loading />
						</div>
					)}
				</div>
			</div>
		);
	return <CreditsUsageView navigate={navigate} />;
}
