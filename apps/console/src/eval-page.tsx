import type { EvalRunDetail, EvalRunSummary, EvalWorkspaceView } from "@openagentpack/kit-sdk/protocol";
import type { TableColumnsType } from "antd";
import { Alert, Button, Select, Table } from "antd";
import { useEffect, useState } from "react";
import styles from "./app.module.less";
import { useConsoleRoute } from "./features/navigation/console-router.tsx";
import { adminApi } from "./lib/api.ts";

function runColumns(onOpen: (runId: string) => void) {
	return [
		{
			title: "run",
			dataIndex: "run_id",
			render: (_, row: EvalRunSummary) => <span className={styles.monoMeta}>{row.run_id}</span>,
		},
		{
			title: "skill",
			render: (_, row: EvalRunSummary) => `${row.skill.name} v${row.skill.version}`,
		},
		{
			title: "pass_rate",
			align: "right" as const,
			render: (_, row: EvalRunSummary) => <span className={styles.passRate}>{row.pass_rate.toFixed(2)}</span>,
		},
		{
			title: "baseline Δ",
			align: "right" as const,
			render: (_, row: EvalRunSummary) => (
				<span className={styles.tabularNum}>
					{row.delta_pass_rate == null ? "-" : `${row.delta_pass_rate >= 0 ? "+" : ""}${row.delta_pass_rate}`}
				</span>
			),
		},
		{
			title: "infra 排除",
			render: (_, row: EvalRunSummary) => row.infra_excluded || "-",
		},
		{
			title: "cases",
			align: "right" as const,
			render: (_, row: EvalRunSummary) => <span className={styles.tabularNum}>{row.case_count}</span>,
		},
		{
			title: "创建时间",
			render: (_, row: EvalRunSummary) => (
				<span className={styles.metaText}>{row.created_at.slice(0, 16).replace("T", " ")}</span>
			),
		},
		{
			title: "操作",
			render: (_, row: EvalRunSummary) => (
				<Button type="link" size="small" data-testid={`eval-open-${row.run_id}`} onClick={() => onOpen(row.run_id)}>
					查看报告
				</Button>
			),
		},
	] satisfies TableColumnsType<EvalRunSummary>;
}

/**
 * 评测浏览页（只读）：workspace → run 列表 → run 详情（report.html 用 srcdoc 内嵌，
 * 令牌只走 Authorization header，不进 URL）。触发执行留给 CLI/CI（跑几分钟且碰本地 FS）。
 */
export function EvalPage() {
	const [workspaces, setWorkspaces] = useState<EvalWorkspaceView[]>([]);
	const { route, navigate } = useConsoleRoute();
	const workspace = route.workspace ?? workspaces[0]?.path ?? "";
	const runId = route.run;
	const [runs, setRuns] = useState<EvalRunSummary[]>([]);
	const [loadingRuns, setLoadingRuns] = useState(false);
	const [detail, setDetail] = useState<EvalRunDetail | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		adminApi.eval
			.workspaces()
			.then((list) => {
				setWorkspaces(list);
			})
			.catch((e: unknown) => setError(String(e instanceof Error ? e.message : e)));
	}, []);

	useEffect(() => {
		let active = true;
		setRuns([]);
		if (!workspace) return;
		setLoadingRuns(true);
		setError(null);
		adminApi.eval
			.runs(workspace)
			.then((value) => {
				if (active) setRuns(value);
			})
			.catch((e: unknown) => {
				if (active) setError(String(e instanceof Error ? e.message : e));
			})
			.finally(() => {
				if (active) setLoadingRuns(false);
			});
		return () => {
			active = false;
		};
	}, [workspace]);

	useEffect(() => {
		let active = true;
		setDetail(null);
		if (!workspace || !runId) return;
		setError(null);
		adminApi.eval
			.run(workspace, runId)
			.then((value) => {
				if (active) setDetail(value);
			})
			.catch((e: unknown) => {
				if (active) setError(e instanceof Error ? e.message : String(e));
			});
		return () => {
			active = false;
		};
	}, [workspace, runId]);

	const workspaceOptions = workspaces.map((w) => ({
		value: w.path,
		label: `${w.name}${w.skill_name ? ` · ${w.skill_name}` : ""} · ${w.runs} runs`,
	}));

	return (
		<div className={styles.evalRoot}>
			<section className={styles.evalPanel}>
				<div className={styles.evalControls}>
					<strong>评测 workspace</strong>
					<Select
						aria-label="评测 workspace"
						className={styles.workspaceSelect}
						placeholder={workspaces.length === 0 ? "（服务端未配置 KIT_EVAL_WORKSPACES）" : "请选择 workspace"}
						value={workspace || undefined}
						options={workspaceOptions}
						onChange={(value) => navigate({ page: "eval", workspace: value })}
					/>
					<span className={styles.metaText}>
						只读浏览；跑评测用 <code>pnpm eval run</code>（仓库脚本/CI）
					</span>
				</div>
				{error ? <Alert type="error" showIcon message={error} /> : null}
			</section>

			<section className={styles.runsSection}>
				<h3 className={styles.runsTitle}>Runs（complete，新→旧）</h3>
				<Table
					rowKey="run_id"
					size="middle"
					loading={loadingRuns}
					columns={runColumns((id) => navigate({ page: "eval", workspace, run: id }))}
					dataSource={runs}
					pagination={false}
					scroll={{ x: "max-content" }}
					locale={{ emptyText: "暂无 complete run" }}
				/>
			</section>

			{detail ? (
				<section className={styles.evalPanel}>
					<div className={styles.evalControls}>
						<strong>报告 {detail.summary.run_id}</strong>
						<span className={styles.metaText}>
							pass_rate {detail.summary.pass_rate.toFixed(2)}
							{detail.summary.baseline_pass_rate == null
								? ""
								: `（基线 ${detail.summary.baseline_pass_rate.toFixed(2)}，Δ ${detail.summary.delta_pass_rate ?? 0}）`}
						</span>
					</div>
					<iframe
						title="评测报告"
						data-testid="eval-report-frame"
						srcDoc={detail.report_html}
						className={styles.reportFrame}
					/>
				</section>
			) : null}
		</div>
	);
}
