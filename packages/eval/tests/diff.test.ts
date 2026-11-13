import { describe, expect, it } from "vitest";
import { computeDiff, renderDiffMarkdown } from "../src/diff.ts";
import type { CaseResultRow } from "../src/report.ts";

const row = (id: string, score: number, failed: string[]): CaseResultRow => ({
	case_id: id,
	kind: "task",
	triggered: true,
	turns: 1,
	duration_ms: 1000,
	score,
	grading: {
		assertion_results: [
			{ text: "ok 断言", passed: true, evidence: "e", kind: "script" },
			...failed.map((text) => ({ text, passed: false, evidence: "e", kind: "judge" as const })),
		],
		score,
	},
	timing: { turns: 1, duration_ms: 1000, tokens: null },
});

describe("run diff", () => {
	it("回归/改进/新增失败/修复 四类判定", () => {
		const diff = computeDiff(
			{ runId: "base", cases: [row("1", 1, []), row("2", 0.5, ["a"])], passRate: 0.75 },
			{ runId: "new", cases: [row("1", 0.5, ["b"]), row("2", 1, []), row("3", 1, [])], passRate: 0.83 },
		);
		const by = new Map(diff.cases.map((c) => [c.case_id, c]));
		expect(by.get("1")?.verdict).toBe("regression");
		expect(by.get("1")?.new_failed).toEqual(["b"]);
		expect(by.get("2")?.verdict).toBe("improved");
		expect(by.get("2")?.fixed).toEqual(["a"]);
		expect(by.get("3")?.verdict).toBe("new");
		expect(diff.pass_rate.delta).toBeCloseTo(0.08, 2);
	});

	it("markdown 渲染含表头与判定列", () => {
		const md = renderDiffMarkdown(
			computeDiff(
				{ runId: "b", cases: [row("1", 1, [])], passRate: 1 },
				{ runId: "n", cases: [row("1", 0, ["x"])], passRate: 0 },
			),
		);
		expect(md).toContain("| case | base | new |");
		expect(md).toContain("regression");
	});
});
