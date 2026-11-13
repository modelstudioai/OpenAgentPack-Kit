import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractJson, type LlmClient } from "./llm.ts";
import { readRun } from "./report.ts";
import { runDir, workspacePaths } from "./workspace.ts";

export interface SuggestionReplacement {
	/** 必须在 SKILL.md 中逐字出现的锚点片段。 */
	old: string;
	new: string;
}

export interface Suggestion {
	target: "description" | "body";
	issue: string;
	change: string;
	case_ids: string[];
	/** 机器可读替换对：`eval iterate` 直接应用；锚点缺失时 iterate 报错不静默。 */
	replacements?: SuggestionReplacement[];
}

/**
 * 从失败断言（带证据）聚类反推 SKILL.md 修改建议；每条挂失败 case id。
 * 只产出建议文本，**不自动改 skill**（人工采纳后走新版本重跑 diff 验证）。
 */
export async function suggestFixes(input: {
	workspaceRoot: string;
	skillMd: string;
	llm: LlmClient;
	runId?: string;
}): Promise<Suggestion[]> {
	const run = readRun(input.workspaceRoot, input.runId);
	const failures = run.cases.flatMap((c) =>
		c.grading.assertion_results
			.filter((r) => !r.passed)
			.map((r) => ({ case_id: c.case_id, assertion: r.text, evidence: r.evidence, kind: r.kind })),
	);
	if (failures.length === 0) return [];
	const prompt = [
		"你是 skill 优化顾问。下面是一次评测的失败断言（含证据）与 SKILL.md 原文。",
		"把失败聚类成根因，给出对 SKILL.md 的具体修改建议（description 或 body）。",
		"输出 JSON 数组 [{target:'description'|'body', issue, change, case_ids[], replacements:[{old,new}]}]；",
		"change 要具体到可执行（给出替换前后的句子），不要空话；case_ids 只填支撑该根因的 case；",
		"replacements 里每个 old 必须是 SKILL.md 中**逐字出现**的片段（≥20 字、含足够上下文避免多义），new 为替换后全文。",
		"失败断言：",
		JSON.stringify(failures, null, 2),
		"SKILL.md：",
		input.skillMd.slice(0, 8000),
	].join("\n");
	const raw = await input.llm.chat([{ role: "user", content: prompt }], { temperature: 0.3 });
	const suggestions = extractJson<Suggestion[]>(raw);
	const dir = runDir(workspacePaths(input.workspaceRoot), run.runId);
	writeFileSync(join(dir, "suggestions.json"), JSON.stringify(suggestions, null, 2));
	const md = [
		`# SKILL.md 优化建议（run ${run.runId}）`,
		"",
		...suggestions.map(
			(s, i) => `## ${i + 1}. [${s.target}] ${s.issue}\n\n${s.change}\n\n支撑 case：${s.case_ids.join(", ")}\n`,
		),
	].join("\n");
	writeFileSync(join(dir, "suggestions.md"), md);
	return suggestions;
}
