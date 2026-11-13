import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type CaseResultRow, latestRunId, readRun, renderHtml } from "@openagentpack/kit-eval";
import {
	type EvalRunCaseRow,
	type EvalRunDetail,
	type EvalRunSummary,
	type EvalWorkspaceView,
	KitError,
} from "@openagentpack/kit-sdk/protocol";

function readSkillName(workspacePath: string): string | undefined {
	const evalsJson = join(workspacePath, "evals", "evals.json");
	if (!existsSync(evalsJson)) return undefined;
	try {
		return (JSON.parse(readFileSync(evalsJson, "utf8")) as { skill_name?: string }).skill_name;
	} catch {
		return undefined;
	}
}

/**
 * 评测浏览服务（控制面只读）：workspace 列表 / run 列表 / run 详情 / report.html 原文。
 * 触发执行不在此层——评测跑几分钟且碰本地 FS 与凭据，留给 CLI/CI（见 docs 站 skill-eval 页）。
 */
export function createEvalService(workspaceRoots: string[]) {
	function assertWorkspace(path: string): string {
		if (!workspaceRoots.includes(path)) throw new KitError("not_found", `未配置的评测 workspace：${path}`);
		if (!existsSync(path)) throw new KitError("not_found", `workspace 目录不存在：${path}`);
		return path;
	}

	function caseRow(c: CaseResultRow): EvalRunCaseRow {
		return {
			case_id: c.case_id,
			kind: c.kind,
			triggered: c.triggered,
			turns: c.turns,
			duration_ms: c.duration_ms,
			score: c.score,
			...(c.infra_error ? { infra_error: true } : {}),
			...(c.error ? { error: c.error } : {}),
			assertions: c.grading.assertion_results.map((a) => ({
				kind: a.kind,
				passed: a.passed,
				text: a.text,
				evidence: a.evidence,
			})),
		};
	}

	function summaryOf(path: string, runId: string): EvalRunSummary {
		const run = readRun(path, runId);
		const withSkill = run.benchmark.run_summary.with_skill;
		return {
			run_id: run.runId,
			created_at: run.manifest.created_at,
			skill: { name: run.manifest.skill.name, version: run.manifest.skill.version },
			model: run.manifest.model,
			judge_model: run.manifest.judge_model,
			case_count: run.cases.length,
			pass_rate: withSkill.pass_rate.mean,
			pass_rate_stddev: withSkill.pass_rate.stddev,
			baseline_pass_rate: run.benchmark.run_summary.without_skill?.pass_rate.mean ?? null,
			delta_pass_rate: run.benchmark.run_summary.delta?.pass_rate ?? null,
			infra_excluded: withSkill.infra_excluded ?? 0,
		};
	}

	return {
		workspaces(): EvalWorkspaceView[] {
			const out: EvalWorkspaceView[] = [];
			for (const path of workspaceRoots) {
				if (!existsSync(path)) continue;
				const skillName = readSkillName(path);
				const runs = listRunIds(path).length;
				out.push({
					path,
					name: path.split("/").pop() ?? path,
					...(skillName ? { skill_name: skillName } : {}),
					runs,
				});
			}
			return out;
		},
		runs(path: string): EvalRunSummary[] {
			assertWorkspace(path);
			return listRunIds(path)
				.map((id) => summaryOf(path, id))
				.sort((a, b) => b.created_at.localeCompare(a.created_at));
		},
		run(path: string, runId?: string): EvalRunDetail {
			assertWorkspace(path);
			const id = runId ?? latestRunId(path);
			if (!id) throw new KitError("not_found", "该 workspace 还没有 complete 的 run");
			const run = readRun(path, id);
			return {
				summary: summaryOf(path, id),
				cases: run.cases.map(caseRow),
				baseline_cases: run.baseline ? run.baseline.map(caseRow) : null,
				report_html: renderHtml(run),
			};
		},
	};
}

function listRunIds(path: string): string[] {
	const runsDir = join(path, "runs");
	if (!existsSync(runsDir)) return [];
	const ids: string[] = [];
	for (const entry of readdirSync(runsDir)) {
		if (!entry.startsWith("run-")) continue;
		try {
			readRun(path, entry);
			ids.push(entry);
		} catch {
			// 残 run 跳过
		}
	}
	return ids;
}
export type EvalService = ReturnType<typeof createEvalService>;
