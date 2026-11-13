import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractJson, type LlmClient } from "./llm.ts";
import type { CommunityEval, KitCaseExt, KitJson } from "./schema.ts";
import { readEvals, readKit, workspacePaths, writeEvals, writeKit } from "./workspace.ts";

interface DraftCase {
	prompt: string;
	expected_output: string;
	assertions: string[];
	kind: "trigger_pos" | "trigger_neg" | "task";
	rubric: { text: string; weight: number; kind: "script" | "judge" }[];
	max_turns?: number;
}

/**
 * `eval gen`：judge 模型读 SKILL.md 增量起草 case（默认 ≤4 条/次），一律 draft=true 待人策展。
 * 脚本断言只允许词表内名字，模型乱给就丢弃（宁缺毋滥）。
 */
export async function genCases(input: {
	workspaceRoot: string;
	skillDir: string;
	llm: LlmClient;
	maxNew?: number;
}): Promise<number> {
	const paths = workspacePaths(input.workspaceRoot);
	const evals = readEvals(paths);
	const kit = readKit(paths);
	const skillMd = readFileSync(join(input.skillDir, "SKILL.md"), "utf8");
	const scriptVocab = ["skill_activated", "skill_not_activated", "no_clarify_before_activate", "turns_within_budget"];
	const prompt = [
		`你是 skill 评测设计师。读下面 SKILL.md，为它起草最多 ${input.maxNew ?? 4} 个新评测 case。`,
		"要求：trigger_pos（该触发）/trigger_neg（不该触发，利用 description 的不适用场景）/task（端到端）混合；",
		"prompt 用真实用户口吻且彼此变体；assertions 里脚本断言只能用词表：",
		JSON.stringify(scriptVocab),
		"其余写成语义断言（judge 判）；rubric 给 1-3 条语义项带 weight。",
		"输出 JSON 数组 [{prompt, expected_output, assertions[], kind, rubric:[{text,weight,kind}], max_turns?}]。",
		"SKILL.md：",
		skillMd.slice(0, 8000),
	].join("\n");
	const raw = await input.llm.chat([{ role: "user", content: prompt }], { temperature: 0.7 });
	const drafts = extractJson<DraftCase[]>(raw);
	let nextId = evals.evals.reduce((m, e) => Math.max(m, Number(e.id) || 0), 0);
	const newEvals: CommunityEval[] = [];
	const newKit: Record<string, KitCaseExt> = {};
	for (const d of drafts.slice(0, input.maxNew ?? 4)) {
		nextId += 1;
		const id = String(nextId);
		const assertions = [
			...d.assertions.filter((a) => scriptVocab.includes(a) || a.startsWith("artifact_contains:")),
			...d.assertions.filter((a) => !scriptVocab.includes(a) && !a.startsWith("artifact_contains:")),
		];
		newEvals.push({ id: nextId, prompt: d.prompt, expected_output: d.expected_output, files: [], assertions });
		newKit[id] = {
			kind: d.kind,
			rubric: d.rubric.map((r, i) => ({ id: `g${id}-${i}`, text: r.text, weight: r.weight, kind: r.kind })),
			mounts: [],
			followups: [],
			collect_artifacts: true,
			max_turns: d.max_turns ?? 12,
			draft: true,
		};
	}
	if (newEvals.length === 0) return 0;
	writeEvals(paths, { ...evals, evals: [...evals.evals, ...newEvals] });
	const nextKit: KitJson = { cases: { ...kit.cases, ...newKit } };
	writeKit(paths, nextKit);
	return newEvals.length;
}
