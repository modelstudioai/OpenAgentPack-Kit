import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { initWorkspace } from "./init.ts";
import type { Suggestion } from "./suggest.ts";
import { workspaceDirFor } from "./workspace.ts";

export interface IterateResult {
	outSkillDir: string;
	outWorkspace: string;
	applied: number;
	missed: string[];
}

/**
 * `eval iterate`：把 suggest 的机器可读 replacements 应用到新 skill 目录（默认 `<skill>-next`），
 * 并从源 workspace 复制 case/config/索引骨架——闭环的「采纳」一步机械化（人工仍应 review diff）。
 */
export function iterateSkill(input: {
	skillDir: string;
	suggestions: Suggestion[];
	sourceWorkspace: string;
	outDir?: string;
}): IterateResult {
	const skillDir = resolve(input.skillDir);
	const skillMdPath = join(skillDir, "SKILL.md");
	if (!existsSync(skillMdPath)) throw new Error(`不是 skill 包（缺 SKILL.md）：${skillDir}`);
	let text = readFileSync(skillMdPath, "utf8");
	const missed: string[] = [];
	let applied = 0;
	for (const suggestion of input.suggestions) {
		for (const rep of suggestion.replacements ?? []) {
			if (!rep.old || !text.includes(rep.old)) {
				missed.push(`${rep.old.slice(0, 60)}…`);
				continue;
			}
			text = text.split(rep.old).join(rep.new);
			applied += 1;
		}
	}
	if (applied === 0) {
		throw new Error(`没有任何 replacement 锚点命中（miss ${missed.length} 条）——先人工核对 suggestions.json`);
	}
	const outSkillDir = input.outDir ? resolve(input.outDir) : `${skillDir}-next`;
	mkdirSync(outSkillDir, { recursive: true });
	cpSync(skillDir, outSkillDir, { recursive: true });
	writeFileSync(join(outSkillDir, "SKILL.md"), text);

	const outWorkspace = workspaceDirFor(outSkillDir);
	initWorkspace(outSkillDir, { force: true });
	const srcWs = resolve(input.sourceWorkspace);
	for (const rel of ["evals/evals.json", "evals/kit.json", "evals/config.yml", "index.json"]) {
		const from = join(srcWs, rel);
		if (existsSync(from)) cpSync(from, join(outWorkspace, rel));
	}
	return { outSkillDir, outWorkspace, applied, missed };
}
