import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

const json = { "content-type": "application/json" };
const admin = { authorization: "Bearer admin-token", ...json };

/** 造一个 complete 的 fixture workspace（manifest/benchmark/results/report 齐全）。 */
function fixtureWorkspace(): string {
	const skill = mkdtempSync(join(tmpdir(), "kit-eval-skill-"));
	const ws = `${skill}-workspace`;
	const run = join(ws, "runs", "run-fixture-1");
	mkdirSync(join(run, "cases"), { recursive: true });
	mkdirSync(join(ws, "evals"), { recursive: true });
	writeFileSync(join(ws, "evals", "evals.json"), JSON.stringify({ skill_name: "fixture-skill", evals: [] }));
	writeFileSync(
		join(run, "manifest.json"),
		JSON.stringify({
			run_id: "run-fixture-1",
			status: "complete",
			created_at: "2026-10-24T00:00:00.000Z",
			skill: { source_hash: "h", skill_id: "s", version: "1.0", name: "fixture-skill" },
			agent_id: "a",
			model: "m",
			judge_model: "j",
			cases_hash: "c",
			case_ids: ["1"],
			config: {},
		}),
	);
	writeFileSync(
		join(run, "benchmark.json"),
		JSON.stringify({
			run_summary: {
				with_skill: {
					pass_rate: { mean: 1, stddev: 0 },
					turns: { mean: 2, stddev: 0 },
					time_seconds: { mean: 3, stddev: 0 },
					infra_excluded: 0,
				},
				without_skill: null,
				delta: null,
			},
		}),
	);
	writeFileSync(
		join(run, "results.json"),
		JSON.stringify([
			{
				case_id: "1",
				kind: "task",
				triggered: true,
				turns: 2,
				duration_ms: 3000,
				score: 1,
				grading: {
					assertion_results: [{ text: "skill_activated", passed: true, evidence: "ev", kind: "script" }],
					score: 1,
				},
				timing: { turns: 2, duration_ms: 3000, tokens: null },
			},
		]),
	);
	// 残 run：只有 running manifest，必须被浏览层跳过
	const broken = join(ws, "runs", "run-broken");
	mkdirSync(broken, { recursive: true });
	writeFileSync(join(broken, "manifest.json"), JSON.stringify({ run_id: "run-broken", status: "running" }));
	return ws;
}

function makeApp(ws: string) {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-evalbrowse-"));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "admin-token",
		KIT_EVAL_WORKSPACES: ws,
	});
	return createApp(createKitServices(config, openDatabase(dataDir)));
}

describe("评测浏览 ops（只读）", () => {
	it("workspaces/runs/run 三级只读视图，残 run 被跳过", async () => {
		const ws = fixtureWorkspace();
		const app = makeApp(ws);
		const list = (await (await app.request("/api/admin/eval/workspaces", { headers: admin })).json()) as {
			data: { path: string; skill_name?: string; runs: number }[];
		};
		expect(list.data).toHaveLength(1);
		expect(list.data[0]?.skill_name).toBe("fixture-skill");
		expect(list.data[0]?.runs).toBe(1);

		const runs = (await (
			await app.request(`/api/admin/eval/runs?workspace=${encodeURIComponent(ws)}`, { headers: admin })
		).json()) as {
			data: { run_id: string; pass_rate: number; delta_pass_rate: number | null }[];
		};
		expect(runs.data.map((r) => r.run_id)).toEqual(["run-fixture-1"]);
		expect(runs.data[0]?.delta_pass_rate).toBeNull();

		const detail = (await (
			await app.request(`/api/admin/eval/runs/run-fixture-1?workspace=${encodeURIComponent(ws)}`, { headers: admin })
		).json()) as { data: { cases: { case_id: string; assertions: { passed: boolean }[] }[]; report_html: string } };
		expect(detail.data.cases[0]?.case_id).toBe("1");
		expect(detail.data.cases[0]?.assertions[0]?.passed).toBe(true);
		expect(detail.data.report_html).toContain("<html");
	});

	it("未配置 workspace 与数据面身份都被拒", async () => {
		const ws = fixtureWorkspace();
		const app = makeApp(ws);
		const missing = await app.request("/api/admin/eval/runs?workspace=/nope", { headers: admin });
		expect(missing.status).toBe(404);
		const noAuth = await app.request("/api/admin/eval/workspaces");
		expect(noAuth.status).toBe(401);
	});
});
