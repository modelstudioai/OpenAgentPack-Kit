import { ArrowLeftOutlined } from "@ant-design/icons";
import type {
	ModelUsageItem,
	ModelUsagePage,
	TemplateSessionUsage,
	TemplateUsageRow,
	ToolUsageItem,
	ToolUsagePage,
} from "@openagentpack/kit-sdk/protocol";
import type { TableColumnsType } from "antd";
import { Button, DatePicker, Empty, Result, Select, Table } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import type { ToolUsageQuery } from "../../lib/admin/index.ts";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import { StatCard, StatCell } from "../../lib/stat-card.tsx";
import { collectionLabels, UsageMetrics, usageMetrics } from "../members/usage-metrics.tsx";
import { aggregateTemplateRows } from "./template-usage-aggregate.ts";
import { TemplateUsageTrendCard } from "./template-usage-trend.tsx";
import styles from "./usage.module.less";
import { TemplateUsageLimits } from "./usage-limit-panels.tsx";

const PAGE_SIZE = 20;

function captureTime(value?: string) {
	return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未采集";
}

function refreshedAt(row: TemplateUsageRow) {
	return row.refreshed_at ? new Date(row.refreshed_at).toLocaleString("zh-CN", { hour12: false }) : "尚未成功采集";
}

/** 单模版或「全部模版」聚合的用量卡片：身份行 + 统计卡栅格；聚合形态隐藏模版级操作按钮。 */
function TemplateUsageCards({
	row,
	onSelect,
	onLimits,
	aggregateCount,
}: {
	row: TemplateUsageRow;
	onSelect?: (row: TemplateUsageRow) => void;
	onLimits?: (row: TemplateUsageRow) => void;
	/** 「全部」视角传入模版总数；此时身份行不展示智能体与上架状态。 */
	aggregateCount?: number;
}) {
	const hintOf = (key: keyof TemplateUsageRow["metrics"]) =>
		`覆盖 ${row.metrics[key].covered_sessions} / ${row.session_count} 个会话`;
	return (
		<div className={styles.cardStack}>
			<div className={styles.identityRow}>
				<div className={styles.identityMeta}>
					<h3 className={styles.sectionTitle}>{row.name}</h3>
					<p className={styles.identitySub}>
						{aggregateCount === undefined ? (
							<>
								智能体 {row.remote_agent_name} ·{" "}
								<span className={row.listing_status === "listed" ? styles.statusOn : undefined}>
									{row.listing_status === "listed" ? "已上架" : "未上架"}
								</span>{" "}
								·{" "}
							</>
						) : (
							`共 ${aggregateCount} 个模版 · `
						)}
						最近成功采集 {refreshedAt(row)}
					</p>
				</div>
				{onSelect && onLimits ? (
					<div className={styles.cardActions}>
						<Button type="link" size="small" onClick={() => onSelect(row)}>
							会话明细
						</Button>
						<Button type="link" size="small" onClick={() => onLimits(row)}>
							设置限额
						</Button>
					</div>
				) : null}
			</div>
			<dl className={styles.statGrid}>
				<StatCard tone="tint" className={styles.statCardSpan2}>
					<StatCell label="会话数" value={row.session_count} unit="个" hint={`含已删除 ${row.deleted_session_count}`} />
				</StatCard>
				<StatCard tone="subtle" className={styles.statCardSpan2}>
					<div className={styles.statPair}>
						<StatCell label="输入 Token" value={row.metrics.input_tokens.value} hint={hintOf("input_tokens")} />
						<StatCell label="输出 Token" value={row.metrics.output_tokens.value} hint={hintOf("output_tokens")} />
					</div>
				</StatCard>
				<StatCard tone="tint" className={styles.statCardSpan2}>
					<div className={styles.statPair}>
						<StatCell
							label="缓存读取 Token"
							value={row.metrics.cache_read_input_tokens.value}
							hint={hintOf("cache_read_input_tokens")}
						/>
						<StatCell
							label="缓存写入 Token"
							value={row.metrics.cache_creation_input_tokens.value}
							hint={hintOf("cache_creation_input_tokens")}
						/>
					</div>
				</StatCard>
				<StatCard tone="subtle" className={styles.statCardSpan3}>
					<StatCell
						label="执行时长"
						value={row.metrics.active_seconds.value}
						unit="秒"
						hint={hintOf("active_seconds")}
					/>
				</StatCard>
				<StatCard tone="tint" className={styles.statCardSpan3}>
					<StatCell
						label="会话时长"
						value={row.metrics.duration_seconds.value}
						unit="秒"
						hint={hintOf("duration_seconds")}
					/>
				</StatCard>
			</dl>
		</div>
	);
}

function metricText(session: TemplateSessionUsage, key: (typeof usageMetrics)[number][0]) {
	const metrics = { ...session.usage, ...session.stats };
	return (
		metrics[key]?.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) ?? (session.captured_at ? "未返回" : "待获取")
	);
}

const sessionDetailColumns: TableColumnsType<TemplateSessionUsage> = [
	{
		title: "会话",
		dataIndex: "session_id",
		render: (_, row) => (
			<div>
				<span className={styles.sessionTitle}>{row.title || row.session_id}</span>{" "}
				<span className={styles.metaText}>{row.session_id}</span>
			</div>
		),
	},
	{
		title: "成员",
		render: (_, row) => (
			<div>
				<span>{row.member_display_name}</span> <span className={styles.metaText}>{row.member_username}</span>
			</div>
		),
	},
	{ title: "状态", render: (_, row) => (row.deleted_at ? "已删除（用量保留）" : row.status || "—") },
	{ title: "创建时间", dataIndex: "created_at", render: (value: string | undefined) => captureTime(value) },
	...usageMetrics.map(([key, label]) => ({
		title: label,
		align: "right" as const,
		render: (_: unknown, row: TemplateSessionUsage) => (
			<span className={styles.tabularNum}>{metricText(row, key)}</span>
		),
	})),
	{
		title: "采集状态",
		dataIndex: "collection_status",
		render: (status: TemplateSessionUsage["collection_status"]) => collectionLabels[status],
	},
	{ title: "采集时间", dataIndex: "captured_at", render: (value: string | undefined) => captureTime(value) },
];

function TemplateSessionsTable({ rows, loading }: { rows: TemplateSessionUsage[]; loading: boolean }) {
	return (
		<Table
			rowKey="session_id"
			size="middle"
			loading={loading}
			columns={sessionDetailColumns}
			dataSource={rows}
			pagination={false}
			scroll={{ x: "max-content" }}
			locale={{
				emptyText: (
					<Empty
						image={Empty.PRESENTED_IMAGE_SIMPLE}
						description={
							<span>
								暂无会话
								<br />
								<span className={styles.metaText}>成员从体验页进入该模版后会话将在这里统计。</span>
							</span>
						}
					/>
				),
			}}
		/>
	);
}

export function TemplateUsageDetail({
	template,
	onBack,
	editLimits,
	onRefresh,
}: {
	template: TemplateUsageRow;
	onBack: () => void;
	editLimits: boolean;
	/** 刷新汇总行（服务端顺带触发新会话登记与后台补采）。 */
	onRefresh: () => Promise<void>;
}) {
	const client = useMemo(getAdminClient, []);
	const [query, setQuery] = useState({ cursors: [""], revision: 0 });
	const list = useAdminQuery(`usage:templates:${template.template_id}:sessions:${JSON.stringify(query)}`, (signal) =>
		client.usage.templateSessions(
			template.template_id,
			{ cursor: query.cursors.at(-1) || undefined, limit: PAGE_SIZE },
			signal,
		),
	);
	const loading = list.loading || (!list.data && !list.error);
	const rows = list.data?.data ?? [];
	const hasNext = Boolean(list.data?.next_cursor);
	return (
		<section aria-labelledby="template-usage-detail-heading" className={styles.detailStack}>
			<Button icon={<ArrowLeftOutlined />} onClick={onBack}>
				返回模版用量
			</Button>
			<header className={styles.detailHeader}>
				<div>
					<h2 id="template-usage-detail-heading" className={styles.detailTitle}>
						{template.name}的会话用量
					</h2>
					<p className={styles.detailSub}>全部成员从该模版上架条目发起的会话，包含已删除会话保存的用量。</p>
				</div>
				<Button
					loading={loading}
					onClick={() => {
						void Promise.all([list.refresh(), onRefresh()]);
					}}
				>
					刷新用量
				</Button>
			</header>
			<TemplateUsageLimits templateId={template.template_id} initiallyEditing={editLimits} />
			<div className={styles.collectStatus} role="status">
				<span>
					会话数：{template.session_count}（已删除 {template.deleted_session_count}）
				</span>
				<span>最近采集：{captureTime(template.refreshed_at)}</span>
			</div>
			<UsageMetrics summary={template} />
			<p className={styles.metaText}>各指标独立统计，未知字段不按 0 计算。统计范围与明细一致，合计不受分页影响。</p>
			{list.error ? (
				<Result
					status="error"
					title={list.error}
					extra={
						<Button
							size="small"
							onClick={() => {
								void list.refresh();
							}}
						>
							重试
						</Button>
					}
				/>
			) : (
				<TemplateSessionsTable rows={rows} loading={loading} />
			)}
			{(query.cursors.length > 1 || hasNext) && (
				<nav aria-label="模版会话分页" className={styles.pager}>
					<Button
						size="small"
						disabled={loading || query.cursors.length === 1}
						onClick={() => setQuery((current) => ({ ...current, cursors: current.cursors.slice(0, -1) }))}
					>
						上一页
					</Button>
					<span>第 {query.cursors.length} 页</span>
					<Button
						size="small"
						disabled={loading || !hasNext}
						onClick={() =>
							setQuery((current) => ({
								...current,
								cursors: [...current.cursors, list.data?.next_cursor ?? ""],
							}))
						}
					>
						下一页
					</Button>
				</nav>
			)}
		</section>
	);
}

/** 模版用量主面板：rows 为单个选中模版时逐模版展示，为全量模版行（「全部」视角）时聚合求和；查询状态与明细导航均由用量页持有。 */
export function TemplateUsagePanel({
	rows,
	loading,
	error,
	onRetry,
	onSelect,
	onLimits,
}: {
	rows: TemplateUsageRow[];
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	onSelect: (row: TemplateUsageRow) => void;
	onLimits: (row: TemplateUsageRow) => void;
}) {
	const aggregate = rows.length > 1 ? aggregateTemplateRows(rows) : null;
	const selected = aggregate ? null : (rows[0] ?? null);
	return (
		<div className={styles.panelStack}>
			<p className={styles.metaText} style={{ marginTop: "10px" }}>
				按模版统计从其上架条目发起的体验会话模型用量，包含已删除会话保存的用量；各项 Token 独立展示，缺失值不按 0
				计算，「全部」为各模版求和。
			</p>
			{loading ? (
				<p role="status" className={styles.loadingNote}>
					正在加载模版用量…
				</p>
			) : null}
			{error ? (
				<Result
					status="error"
					title={error}
					extra={
						<Button size="small" onClick={onRetry}>
							重试
						</Button>
					}
				/>
			) : null}
			{!loading && !error && !rows.length ? (
				<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="在模版管理中保存模版后，即可在此查看各模版的用量。" />
			) : null}
			{!loading && !error && aggregate ? <TemplateUsageCards row={aggregate} aggregateCount={rows.length} /> : null}
			{!loading && !error && selected ? (
				<TemplateUsageCards row={selected} onSelect={onSelect} onLimits={onLimits} />
			) : null}
			{!loading && !error && (aggregate || selected) ? (
				<TemplateUsageTrendCard templateId={selected?.template_id} />
			) : null}
			<ModelUsageSection
				templateId={selected?.template_id}
				agentId={selected?.remote_agent_id}
				templateName={selected?.name}
			/>
			<ToolUsageSection
				templateId={selected?.template_id}
				agentId={selected?.remote_agent_id}
				templateName={selected?.name}
			/>
		</div>
	);
}

const TELEMETRY_PAGE_SIZE = 20;

function usageNumber(value: number) {
	return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function hitRatioText(value: number) {
	return `${(value * 100).toFixed(1)}%`;
}

/** datetime-local 值（YYYY-MM-DDTHH:mm，本地时区）↔ 毫秒时间戳。 */
function minuteInputMs(value: string) {
	return new Date(value).getTime();
}
function toLocalMinuteInput(ms: number) {
	const local = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
	return local.toISOString().slice(0, 16);
}

/** Provider 侧用量明细的公共查询参数：agent_id 来自选中模版，时间来自筛选区（分钟精度输入 → 毫秒）。 */
function telemetryQuery(filters: { start: string; end: string }, agentId: string | undefined) {
	return {
		start_time: minuteInputMs(filters.start),
		end_time: minuteInputMs(filters.end),
		...(agentId ? { agent_id: agentId } : {}),
	};
}

/** 明细区作用域说明：选中模版时按其绑定智能体过滤；「全部」视角不过滤，展示工作空间全量调用。 */
function TelemetryScopeNote({ templateName }: { templateName?: string }) {
	return (
		<p className={styles.metaText}>
			{templateName
				? `已按选中模版「${templateName}」绑定的智能体（agent_id）过滤 Provider 侧调用。`
				: "未按模版过滤：展示工作空间内全部智能体的 Provider 侧调用。"}
		</p>
	);
}

/** 「暂不支持」占位卡：与 ErrorState 同量级的边框盒，中性信息色、无重试入口（上游接入后自动恢复）。 */
function TelemetryUnavailable() {
	return (
		<div className={styles.unavailable}>
			<svg
				aria-hidden="true"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				className={styles.unavailableIcon}
			>
				<circle cx="12" cy="12" r="9" />
				<path d="M12 11v5" />
				<path d="M12 8h.01" />
			</svg>
			<div className={styles.unavailableBody}>
				<strong className={styles.unavailableTitle}>暂不支持，待接入</strong>
				<p className={styles.unavailableDesc}>Provider 侧用量明细尚未接入，接入后此处自动展示。</p>
			</div>
		</div>
	);
}

/** 查询缓存 key 的作用域段：模版 id + 绑定智能体；任一变化都重发明细查询，两个模版绑同一智能体时也会重发。 */
function scopeKeyOf(templateId: string | undefined, agentId: string | undefined) {
	return `${templateId ?? ""}:${agentId ?? ""}`;
}

function telemetryEmpty(title: string, hint: string) {
	return (
		<Empty
			image={Empty.PRESENTED_IMAGE_SIMPLE}
			description={
				<span>
					{title}
					<br />
					<span className={styles.metaText}>{hint}</span>
				</span>
			}
		/>
	);
}

function TelemetryPagination({
	pageNo,
	hasNext,
	loading,
	onChange,
}: {
	pageNo: number;
	hasNext: boolean;
	loading: boolean;
	onChange: (pageNo: number) => void;
}) {
	return (
		<nav aria-label="用量明细分页" className={styles.pager}>
			<Button size="small" disabled={loading || pageNo === 1} onClick={() => onChange(pageNo - 1)}>
				上一页
			</Button>
			<span>第 {pageNo} 页</span>
			<Button size="small" disabled={loading || !hasNext} onClick={() => onChange(pageNo + 1)}>
				下一页
			</Button>
		</nav>
	);
}

const modelTelemetryColumns: TableColumnsType<ModelUsageItem> = [
	{ title: "模型名", dataIndex: "model_name" },
	{
		title: "工作空间",
		dataIndex: "workspace_id",
		render: (value: string) => <span className={styles.workspaceText}>{value}</span>,
	},
	{ title: "调用次数", dataIndex: "call_count", align: "right", render: (value: number) => usageNumber(value) },
	{ title: "失败次数", dataIndex: "failed_count", align: "right", render: (value: number) => usageNumber(value) },
	{
		title: "输入",
		align: "right",
		render: (_, row) => <span className={styles.tabularNum}>{usageNumber(row.tokens.input_tokens)}</span>,
	},
	{
		title: "输出",
		align: "right",
		render: (_, row) => <span className={styles.tabularNum}>{usageNumber(row.tokens.output_tokens)}</span>,
	},
	{
		title: "缓存读取",
		align: "right",
		render: (_, row) => <span className={styles.tabularNum}>{usageNumber(row.tokens.cache_read_tokens)}</span>,
	},
	{
		title: "缓存创建",
		align: "right",
		render: (_, row) => <span className={styles.tabularNum}>{usageNumber(row.tokens.cache_creation_tokens)}</span>,
	},
	{
		title: "缓存命中率",
		align: "right",
		render: (_, row) => <span className={styles.tabularNum}>{hitRatioText(row.tokens.cache_hit_ratio)}</span>,
	},
];

const toolTelemetryColumns: TableColumnsType<ToolUsageItem> = [
	{ title: "工具名", dataIndex: "tool_name" },
	{ title: "来源", dataIndex: "source", render: (value: string) => sourceLabels[value] ?? value },
	{
		title: "工作空间",
		dataIndex: "workspace_id",
		render: (value: string) => <span className={styles.workspaceText}>{value}</span>,
	},
	{ title: "调用次数", dataIndex: "call_count", align: "right", render: (value: number) => usageNumber(value) },
	{ title: "失败次数", dataIndex: "failed_count", align: "right", render: (value: number) => usageNumber(value) },
];

const sourceLabels: Record<string, string> = { builtin: "内置", mcp: "MCP", custom: "自定义" };

function ModelUsageSection({
	templateId,
	agentId,
	templateName,
}: {
	templateId?: string;
	agentId?: string;
	templateName?: string;
}) {
	const client = useMemo(getAdminClient, []);
	/** 日期与模型变更即触发查询（page_no 归 1）；scope 记录所属模版作用域，跨模版切换时由下方 effect 归位。 */
	const [filters, setFilters] = useState(() => ({
		scope: scopeKeyOf(templateId, agentId),
		start: toLocalMinuteInput(Date.now() - 7 * 24 * 60 * 60 * 1000),
		end: toLocalMinuteInput(Date.now()),
		model_name: "",
		page_no: 1,
	}));
	/** 切换选中模版（含进入/离开「全部」）即归位分页与模型筛选，保留时间区间。 */
	useEffect(() => {
		const scope = scopeKeyOf(templateId, agentId);
		setFilters((current) =>
			current.scope === scope && current.page_no === 1 && current.model_name === ""
				? current
				: { ...current, scope, page_no: 1, model_name: "" },
		);
	}, [templateId, agentId]);
	/** 模型名下拉选项：按当前模版绑定智能体与时间区间拉一页全量（不带模型筛选）去重聚合；模型种类超过 100 时选项可能不全。 */
	const optionsQuery = useAdminQuery(
		`usage:model-options:${scopeKeyOf(templateId, agentId)}:${filters.start}:${filters.end}`,
		(signal) => client.usage.modelUsage({ ...telemetryQuery(filters, agentId), page_no: 1, page_size: 100 }, signal),
	);
	const modelOptions = [...new Set((optionsQuery.data?.items ?? []).map((row) => row.model_name))];
	const list = useAdminQuery(
		`usage:model-usage:${scopeKeyOf(templateId, agentId)}:${JSON.stringify(filters)}`,
		(signal) =>
			client.usage.modelUsage(
				{
					...telemetryQuery(filters, agentId),
					...(filters.model_name ? { model_name: filters.model_name } : {}),
					page_no: filters.page_no,
					page_size: TELEMETRY_PAGE_SIZE,
				},
				signal,
			),
	);
	const page: ModelUsagePage | undefined = list.data;
	const rows: ModelUsageItem[] = page?.items ?? [];
	const hasNext = page ? filters.page_no * TELEMETRY_PAGE_SIZE < page.total : false;
	const loading = list.loading || (!list.data && !list.error);
	return (
		<section aria-labelledby="model-usage-heading" className={styles.telemetrySection}>
			<div className={styles.sectionHeader}>
				<h3 id="model-usage-heading" className={styles.sectionTitle}>
					模型用量
				</h3>
				{page ? (
					<span className={styles.metaText}>
						全部模型调用 {usageNumber(page.total_call_count)} 次 · 共 {usageNumber(page.total)} 行
					</span>
				) : null}
			</div>
			<TelemetryScopeNote templateName={templateName} />
			<div className={styles.filterRow}>
				<DatePicker
					aria-label="统计开始时间"
					showTime={{ format: "HH:mm" }}
					format="YYYY-MM-DD HH:mm"
					className={styles.datePicker}
					value={dayjs(filters.start)}
					onChange={(value) => {
						if (value) setFilters({ ...filters, start: value.format("YYYY-MM-DDTHH:mm"), page_no: 1 });
					}}
				/>
				<span className={styles.metaText}>至</span>
				<DatePicker
					aria-label="统计结束时间"
					showTime={{ format: "HH:mm" }}
					format="YYYY-MM-DD HH:mm"
					className={styles.datePicker}
					value={dayjs(filters.end)}
					onChange={(value) => {
						if (value) setFilters({ ...filters, end: value.format("YYYY-MM-DDTHH:mm"), page_no: 1 });
					}}
				/>
				<Select
					aria-label="模型名筛选"
					className={styles.selectName}
					value={filters.model_name}
					onChange={(value) => setFilters({ ...filters, model_name: value, page_no: 1 })}
					options={[{ value: "", label: "全部模型" }, ...modelOptions.map((name) => ({ value: name, label: name }))]}
				/>
			</div>
			{list.error ? (
				<TelemetryUnavailable />
			) : (
				<Table
					rowKey={(row) => `${row.workspace_id}/${row.model_name}`}
					size="small"
					loading={loading}
					columns={modelTelemetryColumns}
					dataSource={rows}
					pagination={false}
					scroll={{ x: "max-content" }}
					locale={{
						emptyText: telemetryEmpty("统计区间内无模型调用", "调整时间区间、模型筛选或切换选中模版后重试。"),
					}}
				/>
			)}
			{page && (page.total > TELEMETRY_PAGE_SIZE || filters.page_no > 1) ? (
				<TelemetryPagination
					pageNo={filters.page_no}
					hasNext={hasNext}
					loading={loading}
					onChange={(pageNo) => setFilters({ ...filters, page_no: pageNo })}
				/>
			) : null}
		</section>
	);
}

function ToolUsageSection({
	templateId,
	agentId,
	templateName,
}: {
	templateId?: string;
	agentId?: string;
	templateName?: string;
}) {
	const client = useMemo(getAdminClient, []);
	/** 日期、来源与工具变更即触发查询（page_no 归 1）；scope 记录所属模版作用域，跨模版切换时由下方 effect 归位。 */
	const [filters, setFilters] = useState(() => ({
		scope: scopeKeyOf(templateId, agentId),
		start: toLocalMinuteInput(Date.now() - 7 * 24 * 60 * 60 * 1000),
		end: toLocalMinuteInput(Date.now()),
		source: "",
		tool_name: "",
		page_no: 1,
	}));
	/** 切换选中模版（含进入/离开「全部」）即归位分页与来源/工具筛选，保留时间区间。 */
	useEffect(() => {
		const scope = scopeKeyOf(templateId, agentId);
		setFilters((current) =>
			current.scope === scope && current.page_no === 1 && current.source === "" && current.tool_name === ""
				? current
				: { ...current, scope, page_no: 1, source: "", tool_name: "" },
		);
	}, [templateId, agentId]);
	/** 工具名下拉选项：按当前模版绑定智能体、时间区间与来源拉一页全量去重聚合；工具种类超过 100 时选项可能不全。 */
	const optionsQuery = useAdminQuery(
		`usage:tool-options:${scopeKeyOf(templateId, agentId)}:${filters.start}:${filters.end}:${filters.source}`,
		(signal) =>
			client.usage.toolUsage(
				{
					...telemetryQuery(filters, agentId),
					...(filters.source ? { source: filters.source as ToolUsageQuery["source"] } : {}),
					page_no: 1,
					page_size: 100,
				},
				signal,
			),
	);
	const toolOptions = [...new Set((optionsQuery.data?.items ?? []).map((row) => row.tool_name))];
	const list = useAdminQuery(
		`usage:tool-usage:${scopeKeyOf(templateId, agentId)}:${JSON.stringify(filters)}`,
		(signal) =>
			client.usage.toolUsage(
				{
					...telemetryQuery(filters, agentId),
					...(filters.source ? { source: filters.source as ToolUsageQuery["source"] } : {}),
					...(filters.tool_name ? { tool_name: filters.tool_name } : {}),
					page_no: filters.page_no,
					page_size: TELEMETRY_PAGE_SIZE,
				},
				signal,
			),
	);
	const page: ToolUsagePage | undefined = list.data;
	const rows: ToolUsageItem[] = page?.items ?? [];
	const hasNext = page ? filters.page_no * TELEMETRY_PAGE_SIZE < page.total : false;
	const loading = list.loading || (!list.data && !list.error);
	return (
		<section aria-labelledby="tool-usage-heading" className={styles.telemetrySection}>
			<div className={styles.sectionHeader}>
				<h3 id="tool-usage-heading" className={styles.sectionTitle}>
					工具调用
				</h3>
				{page ? (
					<span className={styles.metaText}>
						全部工具调用 {usageNumber(page.total_call_count)} 次 · 共 {usageNumber(page.total)} 行
					</span>
				) : null}
			</div>
			<TelemetryScopeNote templateName={templateName} />
			<div className={styles.filterRow}>
				<DatePicker
					aria-label="统计开始时间"
					showTime={{ format: "HH:mm" }}
					format="YYYY-MM-DD HH:mm"
					className={styles.datePicker}
					value={dayjs(filters.start)}
					onChange={(value) => {
						if (value) setFilters({ ...filters, start: value.format("YYYY-MM-DDTHH:mm"), page_no: 1 });
					}}
				/>
				<span className={styles.metaText}>至</span>
				<DatePicker
					aria-label="统计结束时间"
					showTime={{ format: "HH:mm" }}
					format="YYYY-MM-DD HH:mm"
					className={styles.datePicker}
					value={dayjs(filters.end)}
					onChange={(value) => {
						if (value) setFilters({ ...filters, end: value.format("YYYY-MM-DDTHH:mm"), page_no: 1 });
					}}
				/>
				<Select
					aria-label="工具来源筛选"
					className={styles.selectSource}
					value={filters.source}
					onChange={(value) => setFilters({ ...filters, source: value, page_no: 1 })}
					options={[
						{ value: "", label: "全部来源" },
						{ value: "builtin", label: "内置" },
						{ value: "mcp", label: "MCP" },
						{ value: "custom", label: "自定义" },
					]}
				/>
				<Select
					aria-label="工具名筛选"
					className={styles.selectName}
					value={filters.tool_name}
					onChange={(value) => setFilters({ ...filters, tool_name: value, page_no: 1 })}
					options={[{ value: "", label: "全部工具" }, ...toolOptions.map((name) => ({ value: name, label: name }))]}
				/>
			</div>
			{list.error ? (
				<TelemetryUnavailable />
			) : (
				<Table
					rowKey={(row) => `${row.workspace_id}/${row.source}/${row.tool_name}`}
					size="small"
					loading={loading}
					columns={toolTelemetryColumns}
					dataSource={rows}
					pagination={false}
					scroll={{ x: "max-content" }}
					locale={{
						emptyText: telemetryEmpty("统计区间内无工具调用", "调整时间区间、来源/工具筛选或切换选中模版后重试。"),
					}}
				/>
			)}
			{page && (page.total > TELEMETRY_PAGE_SIZE || filters.page_no > 1) ? (
				<TelemetryPagination
					pageNo={filters.page_no}
					hasNext={hasNext}
					loading={loading}
					onChange={(pageNo) => setFilters({ ...filters, page_no: pageNo })}
				/>
			) : null}
		</section>
	);
}
