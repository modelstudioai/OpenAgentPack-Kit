import { describe, expect, it } from "vitest";
import {
	clarifyBeforeActivate,
	computeScore,
	detectInfraError,
	detectTrigger,
	judgeView,
	runScriptAssertion,
	type TranscriptEvent,
	toTranscript,
} from "../src/grade.ts";
import { extractJson } from "../src/llm.ts";

const ev = (over: Partial<TranscriptEvent>): TranscriptEvent => ({ type: "message", ...over });

describe("触发判定", () => {
	it("activate_skill + name 匹配才算触发", () => {
		const events: TranscriptEvent[] = [
			ev({ type: "tool_use", tool_name: "activate_skill", tool_input: '{"name":"other-skill"}' }),
			ev({ type: "tool_use", tool_name: "activate_skill", tool_input: '{"name":"prd-to-prototype"}' }),
		];
		expect(detectTrigger(events, "prd-to-prototype")).toEqual({ triggered: true, atIndex: 1 });
		expect(detectTrigger(events, "nope")).toEqual({ triggered: false, atIndex: -1 });
	});

	it("tool_input 畸形不炸，按未匹配处理", () => {
		const events = [ev({ type: "tool_use", tool_name: "activate_skill", tool_input: "not-json" })];
		expect(detectTrigger(events, "x").triggered).toBe(false);
	});
});

describe("脚本断言", () => {
	const base = {
		events: [
			ev({ role: "assistant", text: "先问你一下：目标用户是谁？" }),
			ev({ type: "tool_use", tool_name: "activate_skill", tool_input: '{"name":"s"}' }),
			ev({ type: "message", role: "assistant", text: "done" }),
		],
		triggered: true,
		atIndex: 1,
		turns: 2,
		maxTurns: 3,
		artifactText: "包含 Tailwind 的 html",
	};
	it("no_clarify_before_activate 抓住触发前提问", () => {
		const r = runScriptAssertion("no_clarify_before_activate", base);
		expect(r.passed).toBe(false);
		expect(r.evidence).toContain("目标用户");
	});
	it("clarifyBeforeActivate 未触发时不适用", () => {
		expect(clarifyBeforeActivate(base.events, -1).violated).toBe(false);
	});
	it("artifact_contains 与 turns_within_budget", () => {
		expect(runScriptAssertion("artifact_contains:Tailwind", base).passed).toBe(true);
		expect(runScriptAssertion("artifact_contains:React", base).passed).toBe(false);
		expect(runScriptAssertion("turns_within_budget", base).passed).toBe(true);
		expect(runScriptAssertion("turns_within_budget", { ...base, turns: 9 }).passed).toBe(false);
	});
	it("未知断言判 FAIL 且不静默", () => {
		const r = runScriptAssertion("magic_check", base);
		expect(r.passed).toBe(false);
		expect(r.evidence).toContain("未知脚本断言");
	});
});

describe("计分与 JSON 抽取", () => {
	it("加权通过率", () => {
		const results = [
			{ text: "a", passed: true, evidence: "", kind: "script" as const },
			{ text: "b", passed: false, evidence: "", kind: "judge" as const },
		];
		expect(computeScore(results, { b: 3 })).toBe(0.25);
		expect(computeScore([], {})).toBe(0);
	});
	it("extractJson 容忍围栏与废话", () => {
		expect(extractJson<{ a: number }>('废话 ```json\n{"a":1}\n``` 尾巴').a).toBe(1);
		expect(extractJson<number[]>("前缀 [1,2] 后缀解释")[1]).toBe(2);
	});
});

describe("toTranscript", () => {
	it("拼接 text content 块", () => {
		const t = toTranscript([
			{
				type: "message",
				role: "assistant",
				content: [
					{ type: "text", text: "a" },
					{ type: "text", text: "b" },
				],
			},
		]);
		expect(t[0]?.text).toBe("a\nb");
	});
});

describe("judgeView", () => {
	it("大 tool payload 不再吃掉其后的消息证据（12k 朴素截断的假失败根因）", () => {
		const big = "x".repeat(20_000);
		const events: TranscriptEvent[] = [
			{ type: "tool_use", tool_name: "write", tool_input: big },
			{ type: "message", role: "assistant", text: "📋 GenUI Project Confirmation 表单在此" },
		];
		const view = judgeView(events);
		expect(view).toContain("GenUI Project Confirmation");
		expect(view.length).toBeLessThan(31_000);
	});
	it("thinking/status 不进 judge 视图", () => {
		const view = judgeView([
			{ type: "thinking", text: "noise" },
			{ type: "message", role: "user", text: "hi" },
		]);
		expect(view).not.toContain("noise");
		expect(view).toContain("hi");
	});
});

describe("detectInfraError", () => {
	it("命中沙箱指纹即标记，未命中返回 null", () => {
		const events: TranscriptEvent[] = [
			{ type: "tool_result", tool_name: "bash", text: "mkdir: cannot create directory: SANDBOX_CONNECT_FAILED" },
		];
		expect(detectInfraError(events, ["SANDBOX_CONNECT_FAILED"])).toBe("SANDBOX_CONNECT_FAILED");
		expect(detectInfraError(events, ["OTHER"])).toBeNull();
		expect(detectInfraError([], ["SANDBOX_CONNECT_FAILED"])).toBeNull();
	});
});

describe("parseArtifacts", () => {
	it("解析标记产物并拒绝 .. 路径", async () => {
		const { parseArtifacts, safeArtifactName } = await import("../src/artifacts.ts");
		const text =
			"x<!--KIT-ARTIFACT:/workspace/docs/prd.md--># PRD\n正文<!--/KIT-ARTIFACT-->y<!--KIT-ARTIFACT:/etc/../secret-->nope<!--/KIT-ARTIFACT-->";
		const arts = parseArtifacts(text);
		expect(arts).toHaveLength(1);
		expect(arts[0]?.path).toBe("/workspace/docs/prd.md");
		expect(arts[0]?.content).toContain("# PRD");
		expect(safeArtifactName("/workspace/docs/prd.md")).toBe("workspace-docs-prd.md");
	});
});

describe("buildBenchmark", () => {
	it("无基线 delta=null；有基线算净增量", async () => {
		const { buildBenchmark } = await import("../src/run.ts");
		const o = (score: number, turns: number, ms: number) => ({
			case_id: "1",
			kind: "task",
			triggered: true,
			turns,
			duration_ms: ms,
			score,
			grading: { assertion_results: [], score },
			timing: { turns, duration_ms: ms, tokens: null },
		});
		const noBase = buildBenchmark([o(1, 2, 2000)], null);
		expect(noBase.run_summary.without_skill).toBeNull();
		expect(noBase.run_summary.delta).toBeNull();
		const withBase = buildBenchmark([o(1, 2, 2000)], [o(0.5, 1, 1000)]);
		expect(withBase.run_summary.delta?.pass_rate).toBe(0.5);
		expect(withBase.run_summary.without_skill?.pass_rate.mean).toBe(0.5);
	});
});

describe("aggregateReps", () => {
	it("score 均值 + 断言多数决 + evidence 带票数", async () => {
		const { aggregateReps } = await import("../src/run.ts");
		const rep = (n: number, passed: boolean, score: number) => ({
			case_id: "1",
			kind: "task",
			triggered: true,
			turns: 2,
			duration_ms: 1000,
			score,
			rep: n,
			grading: {
				assertion_results: [{ text: "a", passed, evidence: `ev${n}`, kind: "judge" as const }],
				score,
			},
			timing: { turns: 2, duration_ms: 1000, tokens: null },
		});
		const [agg] = aggregateReps([rep(1, true, 1), rep(2, false, 0), rep(3, true, 1)]);
		expect(agg?.reps).toBe(3);
		expect(agg?.score).toBeCloseTo(0.667, 2);
		expect(agg?.grading.assertion_results[0]?.passed).toBe(true);
		expect(agg?.grading.assertion_results[0]?.evidence).toContain("2/3 reps 通过");
	});
});

describe("splitAtRecovery", () => {
	it("回收轮事件不进评分边界；无回收轮时全量评分", async () => {
		const { splitAtRecovery } = await import("../src/run.ts");
		const { RECOVERY_PROMPT } = await import("../src/artifacts.ts");
		const events = [
			{ type: "message", role: "user", text: "任务" },
			{ type: "tool_use", tool_name: "write" },
			{ type: "message", role: "user", text: RECOVERY_PROMPT },
			{ type: "tool_result", tool_name: "bash", text: "<!--KIT-ARTIFACT:/workspace/a.md-->内容<!--/KIT-ARTIFACT-->" },
		];
		const { grading, recoveryText } = splitAtRecovery(events);
		expect(grading).toHaveLength(2);
		expect(recoveryText).toContain("KIT-ARTIFACT");
		expect(splitAtRecovery(events.slice(0, 2)).recoveryText).toBe("");
	});
});

describe("iterateSkill", () => {
	it("锚点命中才替换；全 miss 报错；workspace 骨架从源复制", async () => {
		const { iterateSkill } = await import("../src/iterate.ts");
		const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync: fsExists } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const skill = mkdtempSync(join(tmpdir(), "kit-iter-skill-"));
		writeFileSync(join(skill, "SKILL.md"), "---\nname: t-s\ndescription: d\n---\n\n旧句子甲。旧句子乙。\n");
		const srcWs = mkdtempSync(join(tmpdir(), "kit-iter-ws-"));
		mkdirSync(join(srcWs, "evals"), { recursive: true });
		writeFileSync(join(srcWs, "evals", "evals.json"), JSON.stringify({ skill_name: "t-s", evals: [] }));
		const out = iterateSkill({
			skillDir: skill,
			sourceWorkspace: srcWs,
			suggestions: [
				{
					target: "body",
					issue: "i",
					change: "c",
					case_ids: ["1"],
					replacements: [
						{ old: "旧句子甲。", new: "新句子甲。" },
						{ old: "不存在的锚点XYZ", new: "x" },
					],
				},
			],
		});
		expect(out.applied).toBe(1);
		expect(out.missed).toHaveLength(1);
		const next = readFileSync(join(out.outSkillDir, "SKILL.md"), "utf8");
		expect(next).toContain("新句子甲。");
		expect(next).toContain("旧句子乙。");
		expect(fsExists(join(out.outWorkspace, "evals", "evals.json"))).toBe(true);
	});
});
