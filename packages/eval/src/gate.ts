import { readRun } from "./report.ts";

export interface GateOptions {
	runId?: string;
	/** pass_rate 下限（0..1），默认 0.8。 */
	minPassRate?: number;
	/** 不允许存在 score=0 的 case（默认允许，只看总 pass_rate）。 */
	noZeroCase?: boolean;
}

export interface GateResult {
	ok: boolean;
	run_id: string;
	pass_rate: number;
	threshold: number;
	zero_cases: string[];
	failed_assertions: { case_id: string; text: string }[];
}

/** CI 门禁：对指定（或最新）run 判阈值，exit code 由调用方按 ok 决定。 */
export function gateRun(workspaceRoot: string, options: GateOptions = {}): GateResult {
	const threshold = options.minPassRate ?? 0.8;
	const run = readRun(workspaceRoot, options.runId);
	const passRate = run.benchmark.run_summary.with_skill.pass_rate.mean;
	const zeroCases = run.cases.filter((c) => c.score === 0).map((c) => c.case_id);
	const failedAssertions = run.cases.flatMap((c) =>
		c.grading.assertion_results.filter((r) => !r.passed).map((r) => ({ case_id: c.case_id, text: r.text })),
	);
	const ok = passRate >= threshold - 1e-9 && (!options.noZeroCase || zeroCases.length === 0);
	return {
		ok,
		run_id: run.runId,
		pass_rate: passRate,
		threshold,
		zero_cases: zeroCases,
		failed_assertions: failedAssertions,
	};
}

export function renderGateLine(result: GateResult): string {
	const head = `[eval-gate] run=${result.run_id} pass_rate=${result.pass_rate} threshold=${result.threshold} → ${result.ok ? "PASS" : "FAIL"}`;
	if (result.ok) return head;
	const details = result.failed_assertions.map((f) => `  - case ${f.case_id}: ${f.text}`).join("\n");
	return `${head}\n${details}`;
}
