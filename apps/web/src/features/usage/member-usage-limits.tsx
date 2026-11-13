import { ErrorState, MeterBar } from "@openagentpack/kit-chat-ui";
import type { MemberUsageLimitView, UsageLimitMetricState } from "@openagentpack/kit-sdk/protocol";
import { useQuota, useUsageLimits } from "@openagentpack/kit-sdk/usage/hooks";
import { formatBeijingTime, formatUsageDayStart } from "../../lib/beijing-time.ts";
import { formatExactTokenCount, formatTokenCount } from "../../lib/format-token-count.ts";
import { activityRange, CardShell, HeatLegend, HeatmapError, LoadingBody, YearHeatmap } from "./year-heatmap.tsx";

const numberText = (value: number, unit: string) =>
	unit === "Token" ? formatTokenCount(value) : value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const tokenTitle = (value: number | null, unit: string) =>
	unit === "Token" && value !== null ? `${formatExactTokenCount(value)} Token` : undefined;

/** 单指标限额内容：日/月周期分别展示服务端状态、已用量、上限和剩余。 */
function LimitMetric({
	metric,
	title,
	unit,
	period,
	hint,
}: {
	metric: UsageLimitMetricState;
	title: string;
	unit: string;
	period: "day" | "month";
	hint?: string;
}) {
	const remaining = metric.remaining === null ? null : Math.max(0, metric.remaining);
	const status = { ok: "可继续使用", exceeded: "已达限额", unavailable: "用量待确认" }[metric.status];
	const statusClass = {
		ok: "bg-[var(--kit-bg-subtle)] text-[var(--kit-fg-muted)]",
		exceeded: "bg-[var(--kit-danger)]/10 text-[var(--kit-danger)]",
		unavailable: "bg-[var(--kit-warning)]/10 text-[var(--kit-warning-fg)]",
	}[metric.status];
	return (
		<>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="text-[length:var(--kit-text-base)] font-semibold">{title}</h2>
				<p role="status" className={`rounded-full px-2 py-1 text-[length:var(--kit-text-caption)] ${statusClass}`}>
					{status}
				</p>
			</div>
			<dl className="space-y-3 text-[length:var(--kit-text-label)]">
				<div className="mb-5 flex flex-col gap-2">
					<dt className="text-[var(--kit-fg-muted)]">{period === "day" ? "今日已用" : "本月已用"}</dt>
					<dd
						title={tokenTitle(metric.used, unit)}
						className="text-[length:var(--kit-text-display)] font-semibold leading-snug tabular-nums"
					>
						{metric.used === null ? "待获取" : `${numberText(metric.used, unit)} ${unit}`}
					</dd>
				</div>
				<div className="flex flex-wrap justify-between gap-2">
					<dt className="text-[var(--kit-fg-muted)]">{period === "day" ? "每日上限" : "月度上限"}</dt>
					<dd title={tokenTitle(metric.limit, unit)} className="font-medium tabular-nums">
						{metric.limit === null ? "不限量" : `${numberText(metric.limit, unit)} ${unit}`}
					</dd>
				</div>
				<div className="flex flex-wrap justify-between gap-2">
					<dt className="text-[var(--kit-fg-muted)]">剩余额度</dt>
					<dd title={tokenTitle(remaining, unit)} className="font-medium tabular-nums">
						{metric.limit === null
							? "不限量"
							: remaining === null
								? "待确认"
								: `${numberText(remaining, unit)} ${unit}`}
					</dd>
				</div>
			</dl>
			{metric.used !== null && (
				<MeterBar value={metric.used} max={metric.limit ?? 0} unlimited={metric.limit === null} />
			)}
			{hint ? <p className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">{hint}</p> : null}
		</>
	);
}

function LimitCard({
	metric,
	title,
	unit,
	testId,
	period = "month",
	hint,
}: {
	metric: UsageLimitMetricState;
	title: string;
	unit: string;
	testId: string;
	period?: "day" | "month";
	hint?: string;
}) {
	return (
		<section
			data-testid={testId}
			className="min-w-0 space-y-5 rounded-[var(--kit-radius)] border border-[var(--kit-border)] bg-[var(--kit-surface)] p-5 [overflow-wrap:anywhere] md:p-6"
		>
			<LimitMetric metric={metric} title={title} unit={unit} period={period} hint={hint} />
		</section>
	);
}

/** 年热力固定一次查询近 53 周，独立请求不阻塞限额卡。 */
const HEATMAP_DAYS = 371;

/** 每日用量卡：成员身份看逐日 Token 增量；年维度热力一次性全量展示。 */
function ActivityCard() {
	const limits = useUsageLimits({ days: HEATMAP_DAYS });
	const { quota, error: quotaError, reload: onReloadQuota } = useQuota({ days: HEATMAP_DAYS });
	const rows = limits.data
		? limits.data.daily.map((row) => ({ day: row.day, amount: row.tokens, unit: "Token" }))
		: limits.data === null && quota
			? quota.daily.map((row) => ({ day: row.day, amount: row.turns, unit: "Credits" }))
			: null;
	if (limits.error && limits.data === undefined)
		return (
			<CardShell title="每日用量情况">
				<HeatmapError message={limits.error} onRetry={() => void limits.reload()} />
			</CardShell>
		);
	return (
		<CardShell
			title="每日用量情况"
			hint={rows ? activityRange(rows) : undefined}
			aside={rows ? <HeatLegend /> : undefined}
		>
			{rows ? (
				<YearHeatmap days={rows} />
			) : limits.data === null && quotaError ? (
				<HeatmapError message={quotaError} onRetry={() => void onReloadQuota()} />
			) : (
				<LoadingBody label="正在加载每日用量…" />
			)}
		</CardShell>
	);
}

/** 我的用量页：每日/月度 Token、月度执行时长限额卡 + 年度每日热力与口径说明。 */
export function MemberUsageView({
	view,
	loading,
	error,
	onReload,
}: {
	view: MemberUsageLimitView;
	loading: boolean;
	error: string | null;
	onReload: () => void;
}) {
	return (
		<div className="h-full min-w-0 overflow-y-auto" data-testid="member-usage-limits">
			<div className="mx-auto w-full min-w-0 max-w-6xl space-y-6 px-4 py-6 md:px-8 md:py-8">
				<header className="flex flex-wrap items-start justify-between gap-4">
					<div className="min-w-0">
						<h1 className="text-[length:var(--kit-text-display)] font-semibold leading-snug">我的用量</h1>
						<p className="mt-2 text-[length:var(--kit-text-label)] leading-relaxed text-[var(--kit-fg-muted)] [overflow-wrap:anywhere]">
							{view.month} · {formatBeijingTime(view.reset_at)} 重置
						</p>
					</div>
					<button
						type="button"
						disabled={loading}
						onClick={onReload}
						className="min-h-10 shrink-0 rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] bg-[var(--kit-surface)] px-4 py-2 text-[length:var(--kit-text-label)] font-medium transition-colors hover:bg-[var(--kit-bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] disabled:cursor-not-allowed disabled:opacity-50"
					>
						{loading ? "刷新中…" : "刷新用量"}
					</button>
				</header>
				{error && <ErrorState message={error} onRetry={onReload} />}
				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					<LimitCard
						metric={view.day_state.tokens}
						title="每日 Token 用量"
						unit="Token"
						testId="limit-daily-tokens"
						period="day"
						hint={`${formatUsageDayStart(view.day_state.day)} 起 · ${formatBeijingTime(view.day_state.reset_at)} 重置`}
					/>
					<LimitCard metric={view.tokens} title="每月 Token 用量" unit="Token" testId="limit-tokens" />
					<LimitCard metric={view.active_seconds} title="每月执行时长" unit="秒" testId="limit-active_seconds" />
				</div>
				<ActivityCard />
				<div className="space-y-2 rounded-[var(--kit-radius)] bg-[var(--kit-bg-subtle)] p-4 text-[length:var(--kit-text-caption)] leading-relaxed text-[var(--kit-fg-muted)] [overflow-wrap:anywhere] md:p-5">
					<p>Token 按输入与输出之和计算；执行时长不含会话闲置时间。</p>
					<p>
						自 {formatBeijingTime(view.accounting_started_at)} 起记录新受理执行的用量增量，
						按该轮开始所属的计量月归属，不回填历史用量；延迟上报可能归入后续月份。
					</p>
					<p>
						每日与每月额度独立计算；任一启用的指标达到限额后，后续发送会被拒绝。正在执行的一轮不会强制停止，可能超出限额。
					</p>
					<p>用量依赖采集结果，并非费用账单。用量待确认时，受限指标确认前暂不能继续发送；调整额度请联系管理员。</p>
					{view.refreshed_at && <p>最近采集：{formatBeijingTime(view.refreshed_at)}</p>}
				</div>
			</div>
		</div>
	);
}
