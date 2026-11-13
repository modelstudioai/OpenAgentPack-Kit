import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CommunityEval, EvalsJson, KitJson } from "./schema.ts";
import { EvalConfigSchema } from "./schema.ts";
import { parseFrontMatter } from "./skillpack.ts";
import { ensureWorkspace, workspaceDirFor, workspacePaths, writeConfig, writeEvals, writeKit } from "./workspace.ts";

/** 从 description 里抽引号示例（「如'我想做一个...'」）作正例 prompt 草稿。 */
function quotedExamples(description: string): string[] {
	const found = [...description.matchAll(/[''"]([^''""]{4,60})[''"]/g)].map((m) => (m[1] as string).trim());
	return [...new Set(found)].slice(0, 3);
}

/**
 * `eval init <skill-dir>`：在 `<skill-dir>-workspace/` 铺社区同构骨架并起草 case。
 * 起草的 case 标 `draft: true`——run 默认跳过，等人策展（社区方法论：先看输出再补断言）。
 */
export function initWorkspace(skillDir: string, options: { force?: boolean } = {}): string {
	const skillMdPath = join(skillDir, "SKILL.md");
	if (!existsSync(skillMdPath)) throw new Error(`不是 skill 包（缺 SKILL.md）：${skillDir}`);
	const fm = parseFrontMatter(readFileSync(skillMdPath, "utf8"));
	const root = workspaceDirFor(skillDir);
	const paths = workspacePaths(root);
	if (existsSync(paths.evalsJson) && !options.force) {
		throw new Error(`workspace 已存在：${root}（--force 重建数据集，会覆盖人工策展）`);
	}
	ensureWorkspace(root);

	const examples = quotedExamples(fm.description);
	const posPrompt = examples[0] ?? "用这个技能处理我的一个真实需求（人工填写）";
	const evals: EvalsJson = {
		skill_name: fm.normalized,
		evals: [
			{
				id: 1,
				prompt: posPrompt,
				expected_output: "技能被触发并按 SKILL.md 流程交付产物（人工补充成功画像）",
				files: [],
				assertions: ["skill_activated", "no_clarify_before_activate", "turns_within_budget"],
			} as CommunityEval,
			{
				id: 2,
				prompt: "（人工填写：一个不应触发该技能的请求，参考 description 的不适用场景）",
				expected_output: "技能不被触发，助手以普通方式回应",
				files: [],
				assertions: ["skill_not_activated"],
			} as CommunityEval,
		],
	};
	const kit: KitJson = {
		cases: {
			"1": {
				kind: examples.length > 0 ? "task" : "trigger_pos",
				rubric: [
					{ id: "r-flow", text: "按 SKILL.md 的阶段顺序执行，未跳过强制步骤", weight: 2, kind: "judge" },
					{ id: "r-output", text: "产物符合 SKILL.md 的文件与格式规范", weight: 2, kind: "judge" },
				],
				mounts: [],
				followups: [],
				collect_artifacts: true,
				max_turns: 12,
				draft: true,
			},
			"2": {
				kind: "trigger_neg",
				rubric: [],
				mounts: [],
				followups: [],
				collect_artifacts: false,
				max_turns: 4,
				draft: true,
			},
		},
	};
	writeEvals(paths, evals);
	writeKit(paths, kit);
	writeConfig(paths, EvalConfigSchema.parse({}));
	return root;
}
