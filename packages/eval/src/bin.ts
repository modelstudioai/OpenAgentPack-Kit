#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { diffRuns, renderDiffMarkdown } from "./diff.ts";
import { gateRun, renderGateLine } from "./gate.ts";
import { genCases } from "./gen.ts";
import { initWorkspace } from "./init.ts";
import { iterateSkill } from "./iterate.ts";
import { createLlmClient } from "./llm.ts";
import { writeReport } from "./report.ts";
import { credentialsFromEnv, runEval } from "./run.ts";
import { type Suggestion, suggestFixes } from "./suggest.ts";
import { readConfig, workspaceDirFor, workspacePaths } from "./workspace.ts";

const HELP = `OpenAgentPack Kit — Skill 效果评测（本地 workspace，社区 evals/ 兼容）

用法：
  pnpm eval init <skill-dir> [--force]      铺 <skill-dir>-workspace/ 骨架并起草 case（draft）
  pnpm eval gen  <skill-dir> [--max N]      judge 模型增量起草 case（draft，待人策展）
  pnpm eval run  <skill-dir> [--include-draft] [--cases 1,2]
                                       ingest→钉版本建 agent→逐 case 跑→打分→benchmark
  pnpm eval report <skill-dir> [run-id]     生成 report.md / report.html（默认最新 run）
  pnpm eval diff <skill-dir> <base-run> [new-run]
                                       逐 case 对比（回归/改进/新增失败），落 diff-<base>.json
  pnpm eval suggest <skill-dir> [run-id]    失败聚类 → SKILL.md 修改建议（suggestions.md/json，含机器可读 replacements）
  pnpm eval iterate <skill-dir> --run <id> [--workspace <ws>] [--out <dir>]
                                       应用 suggestions 的 replacements 生成 <skill>-next + 复制 workspace 骨架
  pnpm eval gate <skill-dir> [--min-pass-rate 0.8] [--run <id>] [--no-zero-case]
                                       CI 门禁：阈值不达标 exit 1

凭据：BAILIAN_API_KEY（或 DASHSCOPE_API_KEY）+ BAILIAN_WORKSPACE_ID（或 BAILIAN_BASE_URL）。
`;

function flag(args: string[], name: string): string | undefined {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
}

interface CliCtx {
	rest: string[];
	positional: string[];
	skillDir: string;
	workspaceRoot: string;
	skillMd: string;
}

async function cmdInit(skillDir: string | undefined, rest: string[]): Promise<number> {
	if (!skillDir) return fail("init 需要 <skill-dir>");
	const root = initWorkspace(skillDir, { force: rest.includes("--force") });
	console.log(`workspace 已创建：${root}`);
	console.log("下一步：策展 evals/evals.json 与 evals/kit.json（去掉 draft 才会被 run 执行）；或 eval gen 增量起草");
	return 0;
}

async function cmdGen(ctx: CliCtx, maxFlag?: string): Promise<number> {
	const credentials = credentialsFromEnv(process.env);
	const config = readConfig(workspacePaths(ctx.workspaceRoot));
	const llm = createLlmClient({ apiKey: credentials.apiKey, model: config.judge_model });
	const added = await genCases({
		workspaceRoot: ctx.workspaceRoot,
		skillDir: resolve(ctx.skillDir),
		llm,
		...(maxFlag ? { maxNew: Number(maxFlag) } : {}),
	});
	console.log(`起草 ${added} 条 draft case（evals/evals.json + evals/kit.json），策展后 run`);
	return 0;
}

async function cmdRun(ctx: CliCtx, rest: string[]): Promise<number> {
	const credentials = credentialsFromEnv(process.env);
	const casesFlag = flag(rest, "--cases");
	const runId = await runEval({
		workspaceRoot: ctx.workspaceRoot,
		skillDir: resolve(ctx.skillDir),
		skillMd: ctx.skillMd,
		credentials,
		includeDraft: rest.includes("--include-draft"),
		...(casesFlag ? { caseIds: casesFlag.split(",") } : {}),
	});
	const report = writeReport(ctx.workspaceRoot, runId);
	console.log(`报告：${report.html}\n      ${report.md}`);
	return 0;
}

async function cmdSuggest(ctx: CliCtx, runId?: string): Promise<number> {
	const credentials = credentialsFromEnv(process.env);
	const config = readConfig(workspacePaths(ctx.workspaceRoot));
	const llm = createLlmClient({ apiKey: credentials.apiKey, model: config.judge_model });
	const suggestions = await suggestFixes({
		workspaceRoot: ctx.workspaceRoot,
		skillMd: ctx.skillMd,
		llm,
		...(runId ? { runId } : {}),
	});
	console.log(`生成 ${suggestions.length} 条建议（runs/<run-id>/suggestions.md）`);
	for (const item of suggestions) console.log(`- [${item.target}] ${item.issue}（case ${item.case_ids.join(",")}）`);
	return 0;
}

function cmdGate(ctx: CliCtx, rest: string[]): number {
	const minFlag = flag(rest, "--min-pass-rate");
	const runFlag = flag(rest, "--run");
	const result = gateRun(ctx.workspaceRoot, {
		...(minFlag ? { minPassRate: Number(minFlag) } : {}),
		...(runFlag ? { runId: runFlag } : {}),
		noZeroCase: rest.includes("--no-zero-case"),
	});
	console.log(renderGateLine(result));
	return result.ok ? 0 : 1;
}

function cmdIterate(ctx: CliCtx, rest: string[]): number {
	const runFlag = flag(rest, "--run");
	if (!runFlag) return fail("iterate 需要 --run <id>");
	const sourceWorkspace = flag(rest, "--workspace") ?? workspaceDirFor(ctx.skillDir);
	const suggestionsPath = join(sourceWorkspace, "runs", runFlag, "suggestions.json");
	if (!existsSync(suggestionsPath)) return fail(`run 里没有 suggestions.json：${suggestionsPath}（先跑 eval suggest）`);
	const suggestions = JSON.parse(readFileSync(suggestionsPath, "utf8")) as Suggestion[];
	const result = iterateSkill({
		skillDir: ctx.skillDir,
		suggestions,
		sourceWorkspace,
		...(flag(rest, "--out") ? { outDir: flag(rest, "--out") } : {}),
	});
	console.log(
		`已应用 ${result.applied} 条替换${result.missed.length ? `，${result.missed.length} 条锚点未命中（见下）` : ""}：${result.outSkillDir}`,
	);
	for (const m of result.missed) console.log(`  miss: ${m}`);
	console.log(`workspace 骨架：${result.outWorkspace}（review SKILL.md diff 后 run）`);
	return 0;
}

async function main(argv: string[]): Promise<number> {
	const [cmd, ...rest] = argv;
	if (!cmd || cmd === "-h" || cmd === "--help") {
		console.log(HELP);
		return 0;
	}
	if (cmd === "init")
		return cmdInit(
			rest.find((a) => !a.startsWith("--")),
			rest,
		);
	const positional = rest.filter((a) => !a.startsWith("--"));
	const skillDir = positional[0];
	if (!skillDir) return fail(`${cmd} 需要 <skill-dir>`);
	const ctx: CliCtx = {
		rest,
		positional,
		skillDir,
		workspaceRoot: workspaceDirFor(skillDir),
		skillMd: readFileSync(join(skillDir, "SKILL.md"), "utf8"),
	};
	if (cmd === "gen") return cmdGen(ctx, flag(rest, "--max"));
	if (cmd === "run") return cmdRun(ctx, rest);
	if (cmd === "diff") {
		const baseRun = positional[1];
		if (!baseRun) return fail("diff 需要 <base-run>");
		console.log(renderDiffMarkdown(diffRuns(ctx.workspaceRoot, baseRun, positional[2])));
		return 0;
	}
	if (cmd === "suggest") return cmdSuggest(ctx, positional[1]);
	if (cmd === "iterate") return cmdIterate(ctx, rest);
	if (cmd === "gate") return cmdGate(ctx, rest);
	if (cmd === "report") {
		const report = writeReport(ctx.workspaceRoot, positional[1]);
		console.log(`报告：${report.html}\n      ${report.md}`);
		return 0;
	}
	return fail(`未知子命令：${cmd}`);
}

function fail(message: string): number {
	console.error(`${message}\n${HELP}`);
	return 1;
}

main(process.argv.slice(2)).then((code) => process.exit(code));
