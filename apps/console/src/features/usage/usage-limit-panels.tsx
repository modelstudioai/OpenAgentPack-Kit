import type { UsageLimitDayState, UsageLimitMetricState } from "@openagentpack/kit-sdk/protocol";
import { Button, Result } from "antd";
import { useMemo, useState } from "react";
import { type AdminClient, createAdminClient } from "../../lib/admin/index.ts";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { adminRequest } from "../../lib/kit.ts";
import styles from "./usage.module.less";
import {
	formatLimit,
	type LimitPeriod,
	LimitPeriodTabs,
	limitsDescription,
	UsageLimitEditor,
	usageLimitNotice,
} from "./usage-limit-editor.tsx";

export function useUsageLimitAccess() {
	const client = useMemo(() => createAdminClient({ request: adminRequest() }), []);
	const identity = useAdminQuery("usage-limits:identity", (signal) => client.identity(signal));
	return { client, identity, canWrite: identity.data?.role === "admin" };
}

function timeText(value?: string) {
	return value ? new Date(value).toLocaleString("zh-CN", { timeZone: "UTC", hour12: false }) : "尚未更新";
}

function LoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
	return (
		<Result
			status="error"
			title={error}
			extra={
				<Button size="small" onClick={onRetry}>
					重试
				</Button>
			}
		/>
	);
}

export function DefaultUsageLimits({ client, canWrite }: { client: AdminClient; canWrite: boolean }) {
	const [open, setOpen] = useState(false);
	const [editing, setEditing] = useState(false);
	const policy = useAdminQuery("usage-limits:policy", (signal) => client.usageLimits.policy(signal), { enabled: open });
	return (
		<div className={styles.stack}>
			<Button
				aria-expanded={open}
				onClick={() => {
					setOpen(!open);
					setEditing(false);
				}}
			>
				限额设置
			</Button>
			{open && (
				<section aria-label="默认限额设置" className={styles.limitPanel}>
					<header className={styles.limitHeader}>
						<h3 className={styles.limitTitle}>默认限额</h3>
						{canWrite && policy.data && !editing && (
							<Button size="small" onClick={() => setEditing(true)}>
								设置默认限额
							</Button>
						)}
					</header>
					<p className={styles.metaText}>适用于未设置个人限额的本地成员。{usageLimitNotice}</p>
					{policy.loading && !policy.data && <p role="status">正在加载默认限额…</p>}
					{policy.error && <LoadError error={policy.error} onRetry={() => void policy.refresh()} />}
					{policy.data && (
						<>
							<p className={styles.preLine}>{limitsDescription(policy.data.limits)}</p>
							<p className={styles.metaText}>最近设置（UTC）：{timeText(policy.data.updated_at)}</p>
							{editing && canWrite && (
								<UsageLimitEditor
									title="默认限额"
									initial={policy.data.limits}
									onSave={async (limits) => {
										await client.usageLimits.setPolicy(limits);
										await policy.refresh();
									}}
									onClose={() => setEditing(false)}
								/>
							)}
						</>
					)}
					{!canWrite && <p className={styles.metaText}>当前身份只读。</p>}
				</section>
			)}
		</div>
	);
}

const statusLabels: Record<UsageLimitMetricState["status"], string> = {
	ok: "可用",
	exceeded: "已达限额，后续发送受限",
	unavailable: "用量暂不可确认",
};

// styles 取值为 string | undefined（noUncheckedIndexedAccess），故不加 Record<string> 注解；
// 键与 statusLabels 一一对应，值必然存在。
const statusClass = {
	ok: styles.statusOk,
	exceeded: styles.statusExceeded,
	unavailable: styles.statusUnavailable,
};

/** 日维度未设置时的跟随文案：月维度已设置 → 跟随月度，两者都未设置 → 不限量；undefined = 按日数值正常展示。 */
function dayFallbackText(dayLimit: number | null, monthLimit: number | null, unit: string): string | undefined {
	if (dayLimit !== null) return undefined;
	return monthLimit === null ? "不限量" : `跟随月度（${formatLimit(monthLimit, unit)}）`;
}

function MetricBalance({
	title,
	metric,
	unit,
	limitText,
	remainingText,
}: {
	title: string;
	metric: UsageLimitMetricState;
	unit: string;
	/** 日维度跟随月度时的覆盖文案（仅日周期传入）；缺省按 metric 自身展示。 */
	limitText?: string;
	remainingText?: string;
}) {
	return (
		<div className={styles.balanceCard}>
			<h4 className={styles.balanceTitle}>{title}</h4>
			<dl className={styles.balanceGrid}>
				<dt className={styles.balanceLabel}>已用</dt>
				<dd>{metric.used === null ? "待确认" : formatLimit(metric.used, unit)}</dd>
				<dt className={styles.balanceLabel}>上限</dt>
				<dd>{limitText ?? (metric.limit === null ? "不限量" : formatLimit(metric.limit, unit))}</dd>
				<dt className={styles.balanceLabel}>剩余</dt>
				<dd>
					{remainingText ??
						(metric.limit === null
							? "不限量"
							: metric.remaining === null
								? "待确认"
								: formatLimit(metric.remaining, unit))}
				</dd>
			</dl>
			<p role="status" className={`${styles.statusNote} ${statusClass[metric.status]}`}>
				{statusLabels[metric.status]}
			</p>
		</div>
	);
}

/** 周期切换 + 当前周期（当月/今日）已用与上限展示；成员与模版视图字段同构，共用一份。 */
function PeriodUsageStatus({
	period,
	onChange,
	view,
	scopeLabel,
}: {
	period: LimitPeriod;
	onChange: (period: LimitPeriod) => void;
	view: {
		month: string;
		reset_at: string;
		tokens: UsageLimitMetricState;
		active_seconds: UsageLimitMetricState;
		day_state: UsageLimitDayState;
	};
	scopeLabel: string;
}) {
	const active =
		period === "month"
			? { key: view.month, resetAt: view.reset_at, tokens: view.tokens, seconds: view.active_seconds }
			: {
					key: view.day_state.day,
					resetAt: view.day_state.reset_at,
					tokens: view.day_state.tokens,
					seconds: view.day_state.active_seconds,
				};
	return (
		<>
			<div className={styles.scopeRow}>
				<p className={styles.scopeMeta}>
					{active.key}（UTC {period === "month" ? "月" : "日"}） · {scopeLabel} · 下次重置：{timeText(active.resetAt)}{" "}
					UTC
				</p>
				<LimitPeriodTabs period={period} onChange={onChange} />
			</div>
			<div className={styles.balanceColumns}>
				<MetricBalance
					title={period === "month" ? "当月 Token（输入 + 输出）" : "今日 Token（输入 + 输出）"}
					metric={active.tokens}
					unit="Token"
					limitText={
						period === "day" ? dayFallbackText(view.day_state.tokens.limit, view.tokens.limit, "Token") : undefined
					}
					remainingText={
						period === "day" ? dayFallbackText(view.day_state.tokens.limit, view.tokens.limit, "Token") : undefined
					}
				/>
				<MetricBalance
					title={period === "month" ? "当月运行时长" : "今日运行时长"}
					metric={active.seconds}
					unit="秒"
					limitText={
						period === "day"
							? dayFallbackText(view.day_state.active_seconds.limit, view.active_seconds.limit, "秒")
							: undefined
					}
					remainingText={
						period === "day"
							? dayFallbackText(view.day_state.active_seconds.limit, view.active_seconds.limit, "秒")
							: undefined
					}
				/>
			</div>
		</>
	);
}

/** 月度/日度限额统计与累计 Session 快照分别展示，不受 Agent 明细筛选影响。 */
export function MemberUsageLimits({
	memberId,
	initiallyEditing = false,
}: {
	memberId: string;
	initiallyEditing?: boolean;
}) {
	const { client, identity, canWrite } = useUsageLimitAccess();
	const [editing, setEditing] = useState(initiallyEditing);
	const [period, setPeriod] = useState<LimitPeriod>("month");
	const canRead = identity.data?.role === "admin" || identity.data?.role === "auditor";
	const view = useAdminQuery(
		`usage-limits:member:${memberId}`,
		(signal) => client.members.usageLimit(memberId, signal),
		{
			enabled: canRead,
		},
	);
	const policy = useAdminQuery("usage-limits:member-defaults", (signal) => client.usageLimits.policy(signal), {
		enabled: editing && canWrite,
	});
	const current = view.data;
	return (
		<section aria-label="成员限额设置" className={styles.limitPanel}>
			<header className={styles.limitHeader}>
				<h3 className={styles.limitTitle}>限额设置</h3>
				<div className={styles.limitActions}>
					<Button
						size="small"
						loading={view.loading && !current}
						disabled={!canRead || editing}
						onClick={() => void view.refresh()}
					>
						刷新限额状态
					</Button>
					{canWrite && current && !editing && (
						<Button size="small" onClick={() => setEditing(true)}>
							设置限额
						</Button>
					)}
				</div>
			</header>
			<p className={styles.metaText}>{usageLimitNotice}</p>
			{(identity.loading || view.loading) && !current && <p role="status">正在加载限额…</p>}
			{identity.error && <LoadError error={identity.error} onRetry={() => void identity.refresh()} />}
			{view.error && <LoadError error={view.error} onRetry={() => void view.refresh()} />}
			{current && (
				<>
					<PeriodUsageStatus
						period={period}
						onChange={setPeriod}
						view={current}
						scopeLabel={current.override ? "个人限额" : "跟随默认限额"}
					/>
					<p className={styles.metaText}>
						计量启用（UTC）：{timeText(current.accounting_started_at)}；最近更新（UTC）：
						{timeText(current.refreshed_at)}。 此处汇总该成员所有 Agent，不随下方 Agent 筛选变化。
					</p>
					{editing && canWrite && (
						<>
							{policy.error && (
								<LoadError error={`默认限额读取失败：${policy.error}`} onRetry={() => void policy.refresh()} />
							)}
							<UsageLimitEditor
								title="成员限额"
								initial={current.limits}
								defaults={policy.data?.limits}
								canReset={current.override !== null}
								onSave={async (limits) => {
									await client.members.setUsageLimit(memberId, limits);
									await view.refresh();
								}}
								onReset={async () => {
									await client.members.resetUsageLimit(memberId);
									await view.refresh();
								}}
								onClose={() => setEditing(false)}
							/>
						</>
					)}
				</>
			)}
			{identity.data?.role === "auditor" && <p className={styles.metaText}>当前身份只读。</p>}
		</section>
	);
}

/** 模版限额：只统计从该模版上架条目发起的会话；未设置覆盖时不限量。 */
export function TemplateUsageLimits({
	templateId,
	initiallyEditing = false,
}: {
	templateId: string;
	initiallyEditing?: boolean;
}) {
	const { client, identity, canWrite } = useUsageLimitAccess();
	const [editing, setEditing] = useState(initiallyEditing);
	const [period, setPeriod] = useState<LimitPeriod>("month");
	const canRead = identity.data?.role === "admin" || identity.data?.role === "auditor";
	const view = useAdminQuery(
		`usage-limits:template:${templateId}`,
		(signal) => client.usage.templateLimit(templateId, signal),
		{
			enabled: canRead,
		},
	);
	const current = view.data;
	return (
		<section aria-label="模版限额设置" className={styles.limitPanel}>
			<header className={styles.limitHeader}>
				<h3 className={styles.limitTitle}>限额设置</h3>
				<div className={styles.limitActions}>
					<Button
						size="small"
						loading={view.loading && !current}
						disabled={!canRead || editing}
						onClick={() => void view.refresh()}
					>
						刷新限额状态
					</Button>
					{canWrite && current && !editing && (
						<Button size="small" onClick={() => setEditing(true)}>
							设置限额
						</Button>
					)}
				</div>
			</header>
			<p className={styles.metaText}>
				限额作用于该模版上架条目下全部成员合计的消耗；超限后该模版对所有成员暂停发送。{usageLimitNotice}
			</p>
			{(identity.loading || view.loading) && !current && <p role="status">正在加载限额…</p>}
			{identity.error && <LoadError error={identity.error} onRetry={() => void identity.refresh()} />}
			{view.error && <LoadError error={view.error} onRetry={() => void view.refresh()} />}
			{current && (
				<>
					<PeriodUsageStatus
						period={period}
						onChange={setPeriod}
						view={current}
						scopeLabel={current.override ? "模版限额" : "未设置（不限量）"}
					/>
					{editing && canWrite && (
						<UsageLimitEditor
							title="模版限额"
							initial={current.limits}
							canReset={current.override !== null}
							onSave={async (limits) => {
								await client.usage.setTemplateLimit(templateId, limits);
								await view.refresh();
							}}
							onReset={
								current.override
									? async () => {
											await client.usage.resetTemplateLimit(templateId);
											await view.refresh();
										}
									: undefined
							}
							onClose={() => setEditing(false)}
						/>
					)}
				</>
			)}
			{identity.data?.role === "auditor" && <p className={styles.metaText}>当前身份只读。</p>}
		</section>
	);
}
