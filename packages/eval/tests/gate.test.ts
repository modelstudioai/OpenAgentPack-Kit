import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gateRun, renderGateLine } from "../src/gate.ts";

function writeRun(root: string, runId: string, scores: number[]): string {
	const dir = join(root, "runs", runId);
	mkdirSync(join(dir, "cases"), { recursive: true });
	writeFileSync(
		join(dir, "manifest.json"),
		JSON.stringify({
			run_id: runId,
			status: "complete",
			created_at: "t",
			skill: { source_hash: "h", skill_id: "s", version: "1", name: "n" },
			agent_id: "a",
			model: "m",
			judge_model: "j",
			cases_hash: "c",
			case_ids: scores.map((_, i) => String(i + 1)),
			config: {},
		}),
	);
	const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
	writeFileSync(
		join(dir, "benchmark.json"),
		JSON.stringify({
			run_summary: {
				with_skill: {
					pass_rate: { mean, stddev: 0 },
					turns: { mean: 1, stddev: 0 },
					time_seconds: { mean: 1, stddev: 0 },
				},
				without_skill: null,
				delta: null,
			},
		}),
	);
	writeFileSync(
		join(dir, "results.json"),
		JSON.stringify(
			scores.map((score, i) => ({
				case_id: String(i + 1),
				kind: "task",
				triggered: true,
				turns: 1,
				duration_ms: 1,
				score,
				grading: {
					assertion_results: score >= 1 ? [] : [{ text: "某断言", passed: false, evidence: "e", kind: "judge" }],
					score,
				},
				timing: { turns: 1, duration_ms: 1, tokens: null },
			})),
		),
	);
	return dir;
}

describe("eval gate", () => {
	it("达标 PASS、不达标 FAIL 且列出失败断言", () => {
		const root = mkdtempSync(join(tmpdir(), "kit-eval-gate-"));
		writeRun(root, "run-a", [1, 0.5]);
		const ok = gateRun(root, { minPassRate: 0.7 });
		expect(ok.ok).toBe(true);
		const bad = gateRun(root, { minPassRate: 0.8 });
		expect(bad.ok).toBe(false);
		expect(renderGateLine(bad)).toContain("case 2: 某断言");
	});

	it("--no-zero-case 拦住全灭 case", () => {
		const root = mkdtempSync(join(tmpdir(), "kit-eval-gate-"));
		writeRun(root, "run-b", [1, 0]);
		expect(gateRun(root, { minPassRate: 0.4 }).ok).toBe(true);
		expect(gateRun(root, { minPassRate: 0.4, noZeroCase: true }).ok).toBe(false);
	});

	it("残 run 不被默认选中", () => {
		const root = mkdtempSync(join(tmpdir(), "kit-eval-gate-"));
		const broken = join(root, "runs", "run-broken");
		mkdirSync(broken, { recursive: true });
		writeFileSync(join(broken, "manifest.json"), JSON.stringify({ run_id: "run-broken", status: "running" }));
		writeRun(root, "run-good", [1]);
		expect(gateRun(root).run_id).toBe("run-good");
	});
});
