import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CaseResultRow, readRun } from "./report.ts";
import { runDir, workspacePaths } from "./workspace.ts";

export interface CaseDiff {
	case_id: string;
	base_score: number;
	new_score: number;
	delta: number;
	verdict: "regression" | "improved" | "flat" | "new" | "removed";
	new_failed: string[];
	fixed: string[];
}

export interface RunDiff {
	base_run: string;
	new_run: string;
	pass_rate: { base: number; new: number; delta: number };
	cases: CaseDiff[];
}

function failedAssertions(row: CaseResultRow): string[] {
	return row.grading.assertion_results.filter((r) => !r.passed).map((r) => r.text);
}

/** 逐 case 对比：0.1 以上变化才记 improved/regression，其余 flat。 */
export function computeDiff(
	base: { runId: string; cases: CaseResultRow[]; passRate: number },
	next: { runId: string; cases: CaseResultRow[]; passRate: number },
): RunDiff {
	const baseById = new Map(base.cases.map((c) => [c.case_id, c]));
	const newById = new Map(next.cases.map((c) => [c.case_id, c]));
	const cases: CaseDiff[] = [];
	for (const [id, n] of newById) {
		const b = baseById.get(id);
		if (!b) {
			cases.push({
				case_id: id,
				base_score: 0,
				new_score: n.score,
				delta: n.score,
				verdict: "new",
				new_failed: failedAssertions(n),
				fixed: [],
			});
			continue;
		}
		const delta = Number((n.score - b.score).toFixed(4));
		const newFailed = failedAssertions(n);
		const baseFailed = failedAssertions(b);
		cases.push({
			case_id: id,
			base_score: b.score,
			new_score: n.score,
			delta,
			verdict: delta <= -0.1 ? "regression" : delta >= 0.1 ? "improved" : "flat",
			new_failed: newFailed.filter((t) => !baseFailed.includes(t)),
			fixed: baseFailed.filter((t) => !newFailed.includes(t)),
		});
	}
	for (const [id, b] of baseById) {
		if (!newById.has(id)) {
			cases.push({
				case_id: id,
				base_score: b.score,
				new_score: 0,
				delta: -b.score,
				verdict: "removed",
				new_failed: [],
				fixed: [],
			});
		}
	}
	return {
		base_run: base.runId,
		new_run: next.runId,
		pass_rate: {
			base: base.passRate,
			new: next.passRate,
			delta: Number((next.passRate - base.passRate).toFixed(4)),
		},
		cases,
	};
}

export function diffRuns(workspaceRoot: string, baseRunId: string, newRunId?: string): RunDiff {
	const base = readRun(workspaceRoot, baseRunId);
	const next = readRun(workspaceRoot, newRunId);
	if (base.runId === next.runId) throw new Error("base 与 new 是同一个 run，无法 diff");
	const diff = computeDiff(
		{ runId: base.runId, cases: base.cases, passRate: base.benchmark.run_summary.with_skill.pass_rate.mean },
		{ runId: next.runId, cases: next.cases, passRate: next.benchmark.run_summary.with_skill.pass_rate.mean },
	);
	const dir = runDir(workspacePaths(workspaceRoot), next.runId);
	const out = join(dir, `diff-${base.runId}.json`);
	writeFileSync(out, JSON.stringify(diff, null, 2));
	return diff;
}

export function renderDiffMarkdown(diff: RunDiff): string {
	const lines = [
		`# Run 对比：${diff.base_run} → ${diff.new_run}`,
		"",
		`pass_rate：${diff.pass_rate.base} → ${diff.pass_rate.new}（${diff.pass_rate.delta >= 0 ? "+" : ""}${diff.pass_rate.delta}）`,
		"",
		"| case | base | new | Δ | 判定 | 新增失败 | 修复 |",
		"| --- | --- | --- | --- | --- | --- | --- |",
	];
	for (const c of diff.cases) {
		lines.push(
			`| ${c.case_id} | ${c.base_score.toFixed(2)} | ${c.new_score.toFixed(2)} | ${c.delta >= 0 ? "+" : ""}${c.delta} | ${c.verdict} | ${c.new_failed.join("；") || "-"} | ${c.fixed.join("；") || "-"} |`,
		);
	}
	return `${lines.join("\n")}\n`;
}
