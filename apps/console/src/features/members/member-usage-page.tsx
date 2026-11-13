import type {
	MemberSessionUsage,
	MemberUsageSummary,
	MemberView,
	ModelUsagePage,
	ToolUsagePage,
} from "@openagentpack/kit-sdk/protocol";
import type { TableColumnsType } from "antd";
import { Button, Empty, Result, Select, Spin, Table } from "antd";
import { useEffect, useMemo, useState } from "react";
import { createAdminClient } from "../../lib/admin/index.ts";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { useMemberUsage } from "../../lib/admin/use-member-usage.ts";
import { getAdminClient } from "../../lib/api.ts";
import { adminRequest } from "../../lib/kit.ts";
import { StatCard, StatCell } from "../../lib/stat-card.tsx";
import { InnerLayout } from "../navigation/inner-layout.tsx";
import { MemberUsageLimits } from "../usage/usage-limit-panels.tsx";
import styles from "./members.module.less";
import { collectionLabels, UsageMetrics } from "./usage-metrics.tsx";

function captureTime(value?: string) {
	return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未采集";
}

const SESSION_TELEMETRY_PAGE_SIZE = 20;

function usageTotalText(page?: ModelUsagePage | ToolUsagePage) {
	return page ? page.total_call_count.toLocaleString("zh-CN") : "—";
}

type TelemetryQueryState = { loading: boolean; data?: unknown; error?: string | null };

function telemetryLoading(...queries: TelemetryQueryState[]) {
	return queries.some((query) => query.loading || (!query.data && !query.error));
}

function telemetryHasNext(page: { total: number } | undefined, pageNo: number, pageSize: number) {
	return page ? pageNo * pageSize < page.total : false;
}

type ModelRow = ModelUsagePage["items"][number];

function countText(value: number) {
	return value.toLocaleString("zh-CN");
}

const modelColumns: TableColumnsType<ModelRow> = [
	{ title: "模型名", dataIndex: "model_name" },
	{ title: "调用次数", dataIndex: "call_count", align: "right", render: (value: number) => countText(value) },
	{ title: "失败次数", dataIndex: "failed_count", align: "right", render: (value: number) => countText(value) },
	{
		title: "输入",
		align: "right",
		render: (_, row) => <span className={styles.tabularNum}>{countText(row.tokens.input_tokens)}</span>,
	},
	{
		title: "输出",
		align: "right",
		render: (_, row) => <span className={styles.tabularNum}>{countText(row.tokens.output_tokens)}</span>,
	},
	{
		title: "缓存读取",
		align: "right",
		render: (_, row) => <span className={styles.tabularNum}>{countText(row.tokens.cache_read_tokens)}</span>,
	},
	{
		title: "缓存创建",
		align: "right",
		render: (_, row) => <span className={styles.tabularNum}>{countText(row.tokens.cache_creation_tokens)}</span>,
	},
];

function SessionModelTable({ rows, loading }: { rows: ModelUsagePage["items"]; loading?: boolean }) {
	return (
		<Table
			rowKey="model_name"
			size="small"
			loading={loading}
			columns={modelColumns}
			dataSource={rows}
			pagination={false}
			scroll={{ x: "max-content" }}
			locale={{ emptyText: "该会话无模型调用" }}
		/>
	);
}

type ToolRow = ToolUsagePage["items"][number];

const toolColumns: TableColumnsType<ToolRow> = [
	{ title: "工具名", dataIndex: "tool_name" },
	{ title: "来源", dataIndex: "source" },
	{ title: "调用次数", dataIndex: "call_count", align: "right", render: (value: number) => countText(value) },
	{ title: "失败次数", dataIndex: "failed_count", align: "right", render: (value: number) => countText(value) },
];

function SessionToolTable({ rows, loading }: { rows: ToolUsagePage["items"]; loading?: boolean }) {
	return (
		<Table
			rowKey={(row) => `${row.source}/${row.tool_name}`}
			size="small"
			loading={loading}
			columns={toolColumns}
			dataSource={rows}
			pagination={false}
			scroll={{ x: "max-content" }}
			locale={{ emptyText: "该会话无工具调用" }}
		/>
	);
}

/** 已就绪明细的展示：模型/工具两块 + 分页；加载提示悬浮右上角，不参与布局，避免切换时高度抖动。 */
function SessionTelemetryView({
	shown,
	loading,
	pageNo,
	hasNext,
	onPage,
}: {
	shown: { models: ModelUsagePage; tools: ToolUsagePage };
	loading: boolean;
	pageNo: number;
	hasNext: boolean;
	onPage: (pageNo: number) => void;
}) {
	return (
		<>
			{loading ? (
				<p role="status" className={styles.telemetryLoading}>
					正在加载…
				</p>
			) : null}
			<div>
				<p className={styles.telemetryTitle}>模型调用明细 · 全部模型调用 {usageTotalText(shown.models)} 次</p>
				<SessionModelTable rows={shown.models.items} />
			</div>
			<div>
				<p className={styles.telemetryTitle}>工具调用明细 · 全部工具调用 {usageTotalText(shown.tools)} 次</p>
				<SessionToolTable rows={shown.tools.items} />
			</div>
			{hasNext || pageNo > 1 ? (
				<nav aria-label="会话用量明细分页" className={styles.telemetryPager}>
					<Button size="small" disabled={pageNo === 1} onClick={() => onPage(pageNo - 1)}>
						上一页
					</Button>
					<span>第 {pageNo} 页</span>
					<Button size="small" disabled={!hasNext} onClick={() => onPage(pageNo + 1)}>
						下一页
					</Button>
				</nav>
			) : null}
		</>
	);
}

/** 单会话的 Provider 侧模型/工具用量（session 口径：按会话自身窗口统计，无时间筛选）。
 *  切换会话/页码期间保留上一次已就绪的内容直到新数据到位（或确认出错），明细区不塌缩，避免整页闪动。 */
function SessionUsageTelemetry({ sessionId }: { sessionId: string }) {
	const client = useMemo(getAdminClient, []);
	/** 页码随会话自动归位：会话变了视同第 1 页。组件跨会话保持挂载（重挂会丢掉上次内容导致闪动）。 */
	const [page, setPage] = useState({ sessionId, pageNo: 1 });
	const pageNo = page.sessionId === sessionId ? page.pageNo : 1;
	const models = useAdminQuery(`member-session-model:${sessionId}:${pageNo}`, (signal) =>
		client.usage.modelUsage({ session_id: sessionId, page_no: pageNo, page_size: SESSION_TELEMETRY_PAGE_SIZE }, signal),
	);
	const tools = useAdminQuery(`member-session-tool:${sessionId}:${pageNo}`, (signal) =>
		client.usage.toolUsage({ session_id: sessionId, page_no: pageNo, page_size: SESSION_TELEMETRY_PAGE_SIZE }, signal),
	);
	/** 最近一次双接口都就绪的内容；加载期间继续展示它，就绪后原子替换。 */
	const [shown, setShown] = useState<{ key: string; models: ModelUsagePage; tools: ToolUsagePage } | null>(null);
	const queryKey = `${sessionId}:${pageNo}`;
	useEffect(() => {
		if (models.data && tools.data) setShown({ key: queryKey, models: models.data, tools: tools.data });
	}, [models.data, tools.data, queryKey]);
	const loading = telemetryLoading(models, tools);
	const error = models.error ?? tools.error;
	// 加载中沿用上次内容的分页状态，避免分页栏闪现闪没。
	const hasNext =
		telemetryHasNext(models.data ?? shown?.models, pageNo, SESSION_TELEMETRY_PAGE_SIZE) ||
		telemetryHasNext(tools.data ?? shown?.tools, pageNo, SESSION_TELEMETRY_PAGE_SIZE);
	return (
		<div className={styles.telemetryRoot}>
			{error ? (
				<Result
					status="error"
					title={error}
					extra={
						<Button
							size="small"
							onClick={() => {
								void Promise.all([models.refresh(), tools.refresh()]);
							}}
						>
							重试
						</Button>
					}
				/>
			) : null}
			{!error && shown ? (
				<SessionTelemetryView
					shown={shown}
					loading={loading}
					pageNo={pageNo}
					hasNext={hasNext}
					onPage={(next) => setPage({ sessionId, pageNo: next })}
				/>
			) : null}
			{!error && !shown ? (
				<p role="status" className={styles.telemetryEmpty}>
					{loading ? "正在加载该会话的模型/工具用量…" : "该会话暂无模型/工具用量。"}
				</p>
			) : null}
		</div>
	);
}

/** 选中会话的身份行 + 用量统计卡：与模版用量卡片同款式（蓝/灰交替浅色卡，缺失不按 0 计算）。 */
function SessionOverviewCards({ session }: { session: MemberSessionUsage }) {
	const metrics = { ...session.usage, ...session.stats };
	/** 已采集但 Provider 未返回的指标用「未返回」，未采集的用「待获取」。 */
	const missingText = session.captured_at ? "未返回" : "待获取";
	return (
		<div className={styles.cardsStack}>
			<div className={styles.sessionHead}>
				<h4 className={styles.sessionTitle}>{session.title || session.session_id}</h4>
				<p className={styles.sessionMeta}>
					{session.session_id} · {session.agent_slug} ·{" "}
					{session.deleted_at ? "已删除（用量保留）" : session.status || "—"} · 创建 {captureTime(session.created_at)} ·{" "}
					{collectionLabels[session.collection_status]} · 采集时间 {captureTime(session.captured_at)}
				</p>
			</div>
			<dl className={styles.cardGrid}>
				<StatCard tone="tint" className={styles.statCardSpan3}>
					<div className={styles.statPair}>
						<StatCell label="输入 Token" value={metrics.input_tokens ?? null} missingText={missingText} />
						<StatCell label="输出 Token" value={metrics.output_tokens ?? null} missingText={missingText} />
					</div>
				</StatCard>
				<StatCard tone="subtle" className={styles.statCardSpan3}>
					<div className={styles.statPair}>
						<StatCell
							label="缓存读取 Token"
							value={metrics.cache_read_input_tokens ?? null}
							missingText={missingText}
						/>
						<StatCell
							label="缓存写入 Token"
							value={metrics.cache_creation_input_tokens ?? null}
							missingText={missingText}
						/>
					</div>
				</StatCard>
				<StatCard tone="tint" className={styles.statCardSpan3}>
					<StatCell label="执行时长" unit="秒" value={metrics.active_seconds ?? null} missingText={missingText} />
				</StatCard>
				<StatCard tone="subtle" className={styles.statCardSpan3}>
					<StatCell label="会话时长" unit="秒" value={metrics.duration_seconds ?? null} missingText={missingText} />
				</StatCard>
			</dl>
		</div>
	);
}

/** 单会话用量明细区：「选择会话」下拉置顶，选中会话后展示其用量统计卡与模型/工具调用明细。 */
function SessionUsageDetail({
	rows,
	selectedId,
	onSelect,
	pagination,
}: {
	rows: MemberSessionUsage[];
	selectedId: string | null;
	onSelect: (sessionId: string) => void;
	pagination: { page: number; hasNext: boolean; loading: boolean; onPrevious: () => void; onNext: () => void };
}) {
	/** 仅当所选会话仍在当前筛选/分页结果里时才展示明细，避免明细与列表范围脱节。 */
	const selected = rows.find((row) => row.session_id === selectedId) ?? null;
	return (
		<section aria-labelledby="session-usage-detail-heading" className={styles.detailStack}>
			<div className={styles.detailHeader}>
				<h3 id="session-usage-detail-heading" className={styles.detailTitle}>
					会话用量明细
				</h3>
				<div className={styles.detailControls}>
					<div className={styles.sessionPicker}>
						选择会话
						<Select
							aria-label="选择会话"
							className={styles.sessionSelect}
							value={selected?.session_id ?? ""}
							onChange={onSelect}
							options={rows.map((session) => ({
								value: session.session_id,
								label: `${session.title || session.session_id}（${session.session_id}）`,
							}))}
						/>
					</div>
					{(pagination.page > 1 || pagination.hasNext) && (
						<nav aria-label="成员会话分页" className={styles.sessionPager}>
							<Button
								size="small"
								disabled={pagination.loading || pagination.page === 1}
								onClick={pagination.onPrevious}
							>
								上一页
							</Button>
							<span>第 {pagination.page} 页</span>
							<Button size="small" disabled={pagination.loading || !pagination.hasNext} onClick={pagination.onNext}>
								下一页
							</Button>
						</nav>
					)}
				</div>
			</div>
			{selected ? (
				<div className={styles.detailStack}>
					<SessionOverviewCards session={selected} />
					<SessionUsageTelemetry sessionId={selected.session_id} />
				</div>
			) : null}
		</section>
	);
}

function MemberSummary({ summary }: { summary: MemberUsageSummary }) {
	const refreshing = summary.refresh_status === "refreshing";
	return (
		<>
			<div className={styles.summaryRow} role="status">
				<span>
					会话数：{summary.session_count}（已删除 {summary.deleted_session_count}）
				</span>
				<span>
					{refreshing ? "正在采集" : "已处理"} {summary.completed_sessions} / {summary.session_count} 个会话
				</span>
				<span>最近采集：{captureTime(summary.refreshed_at)}</span>
			</div>
			{["failed", "partial"].includes(summary.refresh_status) && (
				<p role="status" className={styles.summaryNote}>
					部分会话用量尚未成功获取，合计可能不完整。已保存的数据仍保留，可点击刷新用量重试。
				</p>
			)}
			<UsageMetrics summary={summary} />
			<p className={styles.metricsNote}>
				各指标独立统计，未知字段不按 0 计算。缓存 Token 与输入 Token 的包含关系由 Provider
				决定，此处不相加。统计范围与明细筛选一致，合计不受分页影响。
			</p>
		</>
	);
}

export function MemberUsagePage({
	member,
	onBack,
	backLabel = "返回成员列表",
	editLimits = false,
}: {
	member: MemberView;
	onBack: () => void;
	backLabel?: string;
	editLimits?: boolean;
}) {
	const client = useMemo(() => createAdminClient({ request: adminRequest() }), []);
	const usage = useMemberUsage(client, member.member_id);
	const summary = usage.summary;
	const refreshing = summary?.refresh_status === "refreshing";
	/** 明细区当前展示的会话；由「选择会话」下拉驱动。 */
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
	/** 有会话数据时默认选中一个会话（优先选已采集有数据的），打开页面即可看到明细。 */
	useEffect(() => {
		if (!usage.sessions.length) return;
		if (selectedSessionId && usage.sessions.some((session) => session.session_id === selectedSessionId)) return;
		const fallback = usage.sessions.find((session) => session.captured_at) ?? usage.sessions[0];
		if (!fallback) return;
		setSelectedSessionId(fallback.session_id);
	}, [usage.sessions, selectedSessionId]);
	return (
		<section aria-labelledby="member-usage-heading" className={styles.pageRoot}>
			<InnerLayout
				titleId="member-usage-heading"
				title={`${member.display_name}的会话用量`}
				description={`${member.username} · 累计该成员全部体验会话的最新用量，包含已删除会话。`}
				onBack={onBack}
				backLabel={backLabel}
				right={
					<Button loading={usage.loading || refreshing} onClick={() => void usage.refresh()}>
						{refreshing ? "采集中…" : "刷新用量"}
					</Button>
				}
			/>
			<MemberUsageLimits memberId={member.member_id} initiallyEditing={editLimits} />
			<label htmlFor="member-usage-agent" className={styles.agentFilterLabel}>
				Agent 筛选
				<Select
					id="member-usage-agent"
					value={usage.agentSlug}
					onChange={usage.setAgent}
					className={styles.agentFilterSelect}
					options={[
						{ value: "", label: "全部 Agent" },
						...usage.agents.map((agent) => ({ value: agent, label: agent })),
					]}
				/>
			</label>
			{usage.error && <Result status="error" title={usage.error} extra={<Button onClick={usage.retry}>重试</Button>} />}
			{summary ? (
				<MemberSummary summary={summary} />
			) : (
				usage.loading && (
					<div className={styles.loadingRow}>
						<Spin />
					</div>
				)
			)}
			{usage.sessions.length > 0 ? (
				<SessionUsageDetail
					rows={usage.sessions}
					selectedId={selectedSessionId}
					onSelect={setSelectedSessionId}
					pagination={{
						page: usage.page,
						hasNext: usage.hasNext,
						loading: usage.loading,
						onPrevious: usage.previous,
						onNext: usage.next,
					}}
				/>
			) : (
				!usage.loading &&
				!usage.error && (
					<Empty
						image={Empty.PRESENTED_IMAGE_SIMPLE}
						description={
							usage.agentSlug ? "该成员在此 Agent 下还没有会话。" : "该成员开始使用体验页后，将在这里统计会话用量。"
						}
					/>
				)
			)}
		</section>
	);
}
