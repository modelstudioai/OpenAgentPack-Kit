import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkJson, GradingJson, RunManifest, TimingJson } from "./schema.ts";
import { runDir, workspacePaths } from "./workspace.ts";

export interface CaseResultRow {
	case_id: string;
	kind: string;
	triggered: boolean;
	turns: number;
	duration_ms: number;
	score: number;
	grading: GradingJson;
	timing?: TimingJson;
	infra_error?: boolean;
	infra_pattern?: string;
	/** 产物回收结果：ok=捞到文件；empty=回收轮无产物（断言回落 transcript 代理）；skipped=case 关闭回收。 */
	recovery?: "ok" | "empty" | "skipped";
	reps?: number;
	error?: string;
}

function isCompleteRun(dir: string): boolean {
	const manifestPath = join(dir, "manifest.json");
	if (!existsSync(manifestPath)) return false;
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { status?: string };
		if (manifest.status === "running") return false;
		// legacy run（status 字段引入前）：产物齐全即视为 complete
		if (manifest.status === undefined) {
			return existsSync(join(dir, "benchmark.json")) && existsSync(join(dir, "results.json"));
		}
		return manifest.status === "complete";
	} catch {
		return false;
	}
}

/** 只认 complete 的 run；残 run（进程中途死）留给排查，不进默认选择。 */
export function latestRunId(workspaceRoot: string): string | null {
	const runs = workspacePaths(workspaceRoot).runsDir;
	if (!existsSync(runs)) return null;
	const ids = readdirSync(runs)
		.filter((d) => d.startsWith("run-") && isCompleteRun(join(runs, d)))
		.sort();
	return ids.at(-1) ?? null;
}

export function readRun(
	workspaceRoot: string,
	runId?: string,
): {
	runId: string;
	manifest: RunManifest;
	benchmark: BenchmarkJson;
	cases: CaseResultRow[];
	baseline: CaseResultRow[] | null;
} {
	const id = runId ?? latestRunId(workspaceRoot);
	if (!id) throw new Error(`workspace 里还没有 run：${workspaceRoot}`);
	const dir = runDir(workspacePaths(workspaceRoot), id);
	const manifestPath = join(dir, "manifest.json");
	if (!isCompleteRun(dir)) {
		throw new Error(`run ${id} 不完整（manifest 缺失或 status=running：进程可能中途崩溃），换个 run-id 或重跑`);
	}
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as RunManifest;
	const benchmark = JSON.parse(readFileSync(join(dir, "benchmark.json"), "utf8")) as BenchmarkJson;
	const cases = JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as CaseResultRow[];
	const baselinePath = join(dir, "baseline", "results.json");
	const baseline = existsSync(baselinePath)
		? (JSON.parse(readFileSync(baselinePath, "utf8")) as CaseResultRow[])
		: null;
	return { runId: id, manifest, benchmark, cases, baseline };
}

function assertionTable(grading: GradingJson): string {
	return grading.assertion_results
		.map((r) => `| ${r.kind} | ${r.passed ? "✅" : "❌"} | ${r.text} | ${r.evidence} |`)
		.join("\n");
}

export function renderMarkdown(run: ReturnType<typeof readRun>): string {
	const { manifest, benchmark, cases } = run;
	const s = benchmark.run_summary.with_skill;
	const lines = [
		`# Skill 评测报告：${manifest.skill.name} v${manifest.skill.version}`,
		"",
		`- run：\`${run.runId}\`（${manifest.created_at}）`,
		`- 模型：runner=${manifest.model} judge=${manifest.judge_model}`,
		`- case 集哈希：\`${manifest.cases_hash}\`（${manifest.case_ids.length} 条）`,
		`- **pass_rate=${s.pass_rate.mean} ± ${s.pass_rate.stddev}**；平均 turns=${s.turns.mean}；平均耗时=${s.time_seconds.mean.toFixed(1)}s`,
		...(benchmark.run_summary.without_skill
			? [
					`- without-skill 基线 pass_rate=${benchmark.run_summary.without_skill.pass_rate.mean}；**delta=${benchmark.run_summary.delta?.pass_rate ?? 0}**（skill 净增量）`,
				]
			: []),
		...(s.infra_excluded ? [`- ⚠️ ${s.infra_excluded} 条 case 因 infra_error 排除出分母`] : []),
		"- tokens：百炼事件无 usage 字段，未统计（口径见 docs/research/skill-eval-probe.md）",
		"",
		"## 逐 case",
		"",
	];
	for (const c of cases) {
		lines.push(
			`### case ${c.case_id}（${c.kind}）score=${c.score.toFixed(2)} triggered=${c.triggered} turns=${c.turns}`,
		);
		if (c.error) lines.push("", `> 运行失败：${c.error}`);
		lines.push("", "| 类型 | 结果 | 断言 | 证据 |", "| --- | --- | --- | --- |", assertionTable(c.grading), "");
	}
	return `${lines.join("\n")}\n`;
}

const HTML_CSS = `
body{font:14px/1.6 -apple-system,"PingFang SC",sans-serif;margin:0;background:#f6f7fb;color:#101322}
main{max-width:960px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:22px}h2{font-size:17px;margin-top:28px}h3{font-size:14px}
.meta{color:#5b6478;font-size:12px}
table{border-collapse:collapse;width:100%;background:#fff;font-size:12px}
th,td{border:1px solid #e3e6ef;padding:6px 8px;text-align:left;vertical-align:top}
.pass{color:#059669}.fail{color:#dc2626}
.card{background:#fff;border:1px solid #e3e6ef;border-radius:12px;padding:16px;margin-top:12px}
.kpi{display:flex;gap:24px;flex-wrap:wrap}
.kpi div{background:#fff;border:1px solid #e3e6ef;border-radius:12px;padding:12px 18px}
.kpi b{display:block;font-size:20px}
`;

export function renderHtml(run: ReturnType<typeof readRun>): string {
	const md = renderMarkdown(run);
	const body = md
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/^### (.*)$/gm, "<h3>$1</h3>")
		.replace(/^## (.*)$/gm, "<h2>$1</h2>")
		.replace(/^# (.*)$/gm, "<h1>$1</h1>")
		.replace(/^- (.*)$/gm, "<div class='meta'>$1</div>")
		.replace(/\| (script|judge) \| (✅|❌) \| (.*?) \| (.*?) \|/g, (_m, kind, mark, text, evidence) => {
			const cls = mark === "✅" ? "pass" : "fail";
			return `<tr><td>${kind}</td><td class="${cls}">${mark}</td><td>${text}</td><td>${evidence}</td></tr>`;
		})
		.replace(
			/\| 类型 \| 结果 \| 断言 \| 证据 \|/g,
			"<table><tr><th>类型</th><th>结果</th><th>断言</th><th>证据</th></tr>",
		)
		.replace(/\| --- \| --- \| --- \| --- \|/g, "")
		.replace(/\n{3,}/g, "\n\n");
	return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${run.manifest.skill.name} 评测报告</title><style>${HTML_CSS}</style></head><body><main>${body}</main></body></html>\n`;
}

export function writeReport(workspaceRoot: string, runId?: string): { md: string; html: string; runId: string } {
	const run = readRun(workspaceRoot, runId);
	const dir = runDir(workspacePaths(workspaceRoot), run.runId);
	const mdPath = join(dir, "report.md");
	const htmlPath = join(dir, "report.html");
	writeFileSync(mdPath, renderMarkdown(run));
	writeFileSync(htmlPath, renderHtml(run));
	return { md: mdPath, html: htmlPath, runId: run.runId };
}
