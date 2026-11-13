import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	archiveCloudAgent,
	createCloudEnvironment,
	createProjectRuntime,
	deleteSession,
	getSession,
	listSessionEvents,
	type ProjectRuntimeContext,
	resolveProjectConfigFromObject,
	sendRemoteSessionEvents,
	uploadFile,
} from "@openagentpack/sdk";
import { parseArtifacts, RECOVERY_PROMPT, type RecoveredArtifact, safeArtifactName } from "./artifacts.ts";
import {
	computeScore,
	detectInfraError,
	detectTrigger,
	gradeWithJudge,
	judgeView,
	runScriptAssertion,
	type ScriptCtx,
	type TranscriptEvent,
	toTranscript,
} from "./grade.ts";
import { ingestSkill } from "./ingest.ts";
import { createLlmClient } from "./llm.ts";
import {
	type BenchmarkJson,
	type EvalConfig,
	type GradingJson,
	type KitJson,
	type RunManifest,
	SCRIPT_ASSERTION_PREFIX,
	SCRIPT_ASSERTIONS,
	type TimingJson,
} from "./schema.ts";
import {
	casesHash,
	newRunId,
	readConfig,
	readEvals,
	readKit,
	runDir,
	type WorkspacePaths,
	workspacePaths,
} from "./workspace.ts";

export interface RunCredentials {
	apiKey: string;
	baseUrl?: string;
	workspaceId?: string;
}

export function credentialsFromEnv(env: NodeJS.ProcessEnv): RunCredentials {
	const apiKey = env.BAILIAN_API_KEY?.trim() || env.DASHSCOPE_API_KEY?.trim();
	if (!apiKey) throw new Error("缺 BAILIAN_API_KEY（或 DASHSCOPE_API_KEY）：eval 只能跑真实 Cloud");
	const workspaceId = env.BAILIAN_WORKSPACE_ID?.trim();
	const baseUrl = env.BAILIAN_BASE_URL?.trim();
	if (!workspaceId && !baseUrl) throw new Error("缺 BAILIAN_WORKSPACE_ID 或 BAILIAN_BASE_URL");
	return { apiKey, ...(baseUrl ? { baseUrl } : {}), ...(workspaceId ? { workspaceId } : {}) };
}

export async function buildEvalContext(credentials: RunCredentials): Promise<ProjectRuntimeContext> {
	const providerConfig: Record<string, unknown> = { api_key: credentials.apiKey };
	if (credentials.baseUrl) providerConfig.base_url = credentials.baseUrl;
	if (credentials.workspaceId) providerConfig.workspace_id = credentials.workspaceId;
	const loaded = (await resolveProjectConfigFromObject(
		{ version: "1", project: "kit-eval", providers: { bailian: providerConfig }, agents: {} },
		{ projectName: "kit-eval", resolveEnv: false },
	)) as unknown as { config?: unknown } & Record<string, unknown>;
	return createProjectRuntime({
		projectName: "kit-eval",
		config: (loaded.config ?? loaded) as never,
		state: { version: 1, resources: {} } as never,
		providers: { bailian: providerConfig },
	});
}

export function agentstudioBase(credentials: RunCredentials): string {
	if (credentials.baseUrl) return credentials.baseUrl.replace(/\/+$/, "");
	return `https://${credentials.workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio`;
}

interface GradeInput {
	assertions: string[];
	weights: Record<string, number>;
	maxTurns: number;
	skillName: string;
	skillMd: string;
	judge: ReturnType<typeof createLlmClient>;
}

/** turns 口径 + 脚本/judge 双判分（回收产物优先作为 artifact 断言证据）。 */
async function gradeCase(
	events: TranscriptEvent[],
	triggered: boolean,
	atIndex: number,
	artifacts: RecoveredArtifact[],
	input: GradeInput,
): Promise<{ turns: number; grading: GradingJson }> {
	// turns = 模型回合数：优先 raw model_request_start（纯工具回合没有 assistant message 事件）
	const byRaw = events.filter((e) => e.raw_type === "model_request_start").length;
	const turns = byRaw > 0 ? byRaw : events.filter((e) => e.type === "message" && e.role === "assistant").length;
	const artifactText =
		artifacts.length > 0
			? artifacts.map((a) => `--- ${a.path} ---\n${a.content}`).join("\n")
			: events
					.filter((e) => e.type === "tool_result" || (e.type === "message" && e.role === "assistant"))
					.map((e) => e.text ?? "")
					.join("\n");
	const scriptCtx: ScriptCtx = { events, triggered, atIndex, turns, maxTurns: input.maxTurns, artifactText };
	const scriptResults = input.assertions.filter(isScriptAssertion).map((a) => runScriptAssertion(a, scriptCtx));
	const judgeAssertions = input.assertions.filter((a) => !isScriptAssertion(a));
	const judgeResults = await gradeWithJudge(input.judge, {
		skillName: input.skillName,
		skillMd: input.skillMd,
		transcriptText: judgeView(events),
		assertions: judgeAssertions,
	});
	const results = [...scriptResults, ...judgeResults];
	return { turns, grading: { assertion_results: results, score: computeScore(results, input.weights) } };
}

/** 按 case 脚本逐条发送并等 idle；任一段未 idle 即停（后续 followup 不再发）。返回是否全程收敛（false=runaway）。 */
async function playScript(
	input: { ctx: ProjectRuntimeContext; prompt: string; followups: string[]; runTimeoutMs: number },
	sessionId: string,
): Promise<boolean> {
	let settled = true;
	for (const text of [input.prompt, ...input.followups]) {
		await sendRemoteSessionEvents(input.ctx, sessionId, [
			{ type: "message", role: "user", content: [{ type: "text", text }] },
		]);
		settled = await waitIdle(input.ctx, sessionId, input.runTimeoutMs);
		if (!settled) break;
	}
	return settled;
}

async function waitIdle(ctx: ProjectRuntimeContext, sessionId: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const info = (await getSession(ctx, sessionId)) as { status?: string } | null;
		const status = String(info?.status ?? "");
		if (status === "terminated" || status === "archived") return false;
		if (status === "idle") return true;
		if (Date.now() > deadline) return false;
		await new Promise((r) => setTimeout(r, 4000));
	}
}

/** provider 实测允许的文件扩展名白名单（其余上传时映射为 .txt）。 */
const SAFE_UPLOAD_EXTS = new Set([".md", ".txt", ".pdf", ".docx", ".xlsx", ".png", ".jpg", ".jpeg"]);

/** fixture 挂载：evals/files/ 下的文件上传后按 mount_path 挂进 session sandbox。 */
async function uploadMounts(
	ctx: ProjectRuntimeContext,
	filesDir: string,
	mounts: { file: string; mount_path: string }[],
): Promise<{ type: string; file_id: string; mount_path: string }[]> {
	const resources: { type: string; file_id: string; mount_path: string }[] = [];
	for (const mount of mounts) {
		const bytes = new Uint8Array(readFileSync(join(filesDir, mount.file.replace(/^evals\/files\//, ""))));
		// provider 文件类型白名单（csv 实测 415 11900014）：上传名映射到安全扩展，
		// mount_path 保持原样——agent 在沙箱里看到的仍是请求的名字与内容
		const original = mount.file.split("/").pop() ?? "fixture";
		const ext = original.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? "";
		const safeName = SAFE_UPLOAD_EXTS.has(ext) ? original : `${original.replace(/\.[^.]+$/, "")}.txt`;
		const uploaded = (await uploadFile(ctx, bytes, safeName)) as { id: string };
		resources.push({ type: "file_resource", file_id: uploaded.id, mount_path: mount.mount_path });
	}
	return resources;
}

/** 分页拉全 session 事件（长 run 超 100 条时单页截尾，曾导致 recovery 空与断言漏判）。 */
async function listAllEvents(ctx: ProjectRuntimeContext, sessionId: string): Promise<Record<string, unknown>[]> {
	const out: Record<string, unknown>[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < 10; page++) {
		const res = (await listSessionEvents(ctx, sessionId, {
			limit: 100,
			...(cursor ? { afterId: cursor } : {}),
		})) as unknown as { events: Record<string, unknown>[]; next_page?: string | null };
		out.push(...(res.events ?? []));
		cursor = res.next_page ?? undefined;
		if (!cursor || (res.events ?? []).length === 0) break;
	}
	return out;
}

/** 回收边界切分：回收轮 user 消息之前 = 评分事件；之后 = 回收文本源。 */
export function splitAtRecovery(events: TranscriptEvent[]): { grading: TranscriptEvent[]; recoveryText: string } {
	const marker = RECOVERY_PROMPT.slice(0, 24);
	const idx = events.findIndex((e) => e.type === "message" && e.role === "user" && (e.text ?? "").startsWith(marker));
	if (idx < 0) return { grading: events, recoveryText: "" };
	const tail = events.slice(idx);
	return {
		grading: events.slice(0, idx),
		recoveryText: tail
			.filter((e) => e.type === "tool_result" || (e.type === "message" && e.role === "assistant"))
			.map((e) => e.text ?? "")
			.join("\n"),
	};
}

function parseArtifactsFromEvents(events: TranscriptEvent[]): RecoveredArtifact[] {
	const seen = new Map<string, RecoveredArtifact>();
	for (const a of parseArtifacts(splitAtRecovery(events).recoveryText)) seen.set(a.path, a);
	return [...seen.values()];
}

/** 回收轮：发 harness 指令 → 等 idle（短超时）→ 从全量事件尾段解析标记产物。 */
async function recoverArtifacts(
	input: { ctx: ProjectRuntimeContext; runTimeoutMs: number },
	sessionId: string,
): Promise<void> {
	await sendRemoteSessionEvents(input.ctx, sessionId, [
		{ type: "message", role: "user", content: [{ type: "text", text: RECOVERY_PROMPT }] },
	]);
	await waitIdle(input.ctx, sessionId, Math.min(input.runTimeoutMs, 180_000));
}

function isScriptAssertion(text: string): boolean {
	return (SCRIPT_ASSERTIONS as readonly string[]).includes(text) || text.startsWith(SCRIPT_ASSERTION_PREFIX);
}

interface CaseOutcome {
	case_id: string;
	kind: string;
	triggered: boolean;
	turns: number;
	duration_ms: number;
	score: number;
	grading: GradingJson;
	timing: TimingJson;
	transcript?: TranscriptEvent[];
	artifacts?: RecoveredArtifact[];
	recovery?: "ok" | "empty" | "skipped";
	rep?: number;
	reps?: number;
	infra_error?: boolean;
	infra_pattern?: string;
	error?: string;
}

async function runOneCase(input: {
	ctx: ProjectRuntimeContext;
	base: string;
	headers: Record<string, string>;
	agentId: string;
	skillName: string;
	caseId: string;
	prompt: string;
	followups: string[];
	mounts: { file: string; mount_path: string }[];
	filesDir: string;
	assertions: string[];
	weights: Record<string, number>;
	maxTurns: number;
	runTimeoutMs: number;
	collectArtifacts: boolean;
	skillMd: string;
	judge: ReturnType<typeof createLlmClient>;
}): Promise<CaseOutcome> {
	const started = Date.now();
	const resources = await uploadMounts(input.ctx, input.filesDir, input.mounts);
	const created = await fetch(`${input.base}/sessions`, {
		method: "POST",
		headers: input.headers,
		body: JSON.stringify({
			agent: input.agentId,
			title: `eval-${input.caseId}`,
			metadata: { kit: "eval" },
			...(resources.length ? { resources } : {}),
		}),
	});
	if (!created.ok) throw new Error(`建会话失败 HTTP ${created.status}: ${(await created.text()).slice(0, 160)}`);
	const session = (await created.json()) as { id?: string };
	const sessionId = String(session.id ?? "");
	try {
		const settled = await playScript(input, sessionId);
		// 产物真回收：同 session 追加一轮 harness 指令；回收事件不进评分边界
		if (input.collectArtifacts) {
			// runaway（段超时未 idle，实测 190 rounds 死循环）先 interrupt 镇静，否则回收轮只排队等死
			if (!settled) {
				await sendRemoteSessionEvents(input.ctx, sessionId, [{ type: "interrupt" }]).catch(() => undefined);
				await waitIdle(input.ctx, sessionId, 60_000);
			}
			await recoverArtifacts(input, sessionId);
		}
		const all = toTranscript(await listAllEvents(input.ctx, sessionId));
		const { grading: events } = splitAtRecovery(all);
		const artifacts = input.collectArtifacts ? parseArtifactsFromEvents(all) : [];
		const { triggered, atIndex } = detectTrigger(events, input.skillName);
		const { turns, grading } = await gradeCase(events, triggered, atIndex, artifacts, input);
		const timing: TimingJson = { turns, duration_ms: Date.now() - started, tokens: null };
		return {
			case_id: input.caseId,
			kind: triggered ? "triggered" : "not-triggered",
			triggered,
			turns,
			duration_ms: timing.duration_ms,
			score: grading.score,
			grading,
			timing,
			transcript: events,
			artifacts,
			recovery: input.collectArtifacts ? (artifacts.length > 0 ? "ok" : "empty") : "skipped",
		};
	} finally {
		await deleteSession(input.ctx, sessionId).catch(() => undefined);
	}
}

interface SettleDeps {
	item: { id: number | string; prompt: string; assertions: string[] };
	rep: number;
	kit: KitJson;
	dir: string;
	filesDir: string;
	log: (line: string) => void;
	ctx: ProjectRuntimeContext;
	base: string;
	headers: Record<string, string>;
	agentId: string;
	skillName: string;
	config: EvalConfig;
	judge: ReturnType<typeof createLlmClient>;
	skillMd: string;
}

type RunArgs = Parameters<typeof runOneCase>[0];

/** 瞬态网络错误重试一次 → infra 指纹再重试一次并标记；收拢 settleCase 的分支复杂度。 */
async function runWithResilience(
	runArgs: RunArgs,
	infraPatterns: string[],
	log: (line: string) => void,
): Promise<CaseOutcome> {
	let outcome: CaseOutcome;
	try {
		outcome = await runOneCase(runArgs);
	} catch (e) {
		const msg = (e as Error).message;
		if (!/aborted|fetch failed|ECONNRESET|ETIMEDOUT/i.test(msg)) throw e;
		log(`瞬态网络错误，重试一次：${msg.slice(0, 80)}`);
		outcome = await runOneCase(runArgs);
	}
	const infraPattern = detectInfraError(outcome.transcript ?? [], infraPatterns);
	if (!infraPattern) return outcome;
	log(`检测到基础设施故障 ${infraPattern}，自动重试一次`);
	const retry = await runOneCase(runArgs);
	const retryPattern = detectInfraError(retry.transcript ?? [], infraPatterns);
	if (retryPattern) {
		retry.infra_error = true;
		retry.infra_pattern = retryPattern;
	}
	return retry;
}

/** 单 case 执行 + 落盘（grading/timing/transcript）；失败不拖垮整 run。 */
async function settleCase(deps: SettleDeps): Promise<CaseOutcome> {
	const id = String(deps.item.id);
	const ext = deps.kit.cases[id];
	const weights: Record<string, number> = {};
	for (const r of ext?.rubric ?? []) weights[r.text] = r.weight;
	deps.log(`[case ${id}] 开始：${deps.item.prompt.slice(0, 40)}…`);
	try {
		// 社区 assertions 与 kit rubric 语义项合并送判（rubric 权重只在计分处生效）
		const assertions = [...new Set([...deps.item.assertions, ...(ext?.rubric ?? []).map((r) => r.text)])];
		const runArgs = {
			ctx: deps.ctx,
			base: deps.base,
			headers: deps.headers,
			agentId: deps.agentId,
			skillName: deps.skillName,
			caseId: id,
			prompt: deps.item.prompt,
			followups: ext?.followups ?? [],
			mounts: ext?.mounts ?? [],
			filesDir: deps.filesDir,
			assertions,
			weights,
			maxTurns: ext?.max_turns ?? 12,
			runTimeoutMs: ext?.timeout_ms ?? deps.config.run_timeout_ms,
			collectArtifacts: ext?.collect_artifacts ?? true,
			skillMd: deps.skillMd,
			judge: deps.judge,
		};
		const outcome = await runWithResilience(runArgs, deps.config.infra_error_patterns, (line) =>
			deps.log(`[case ${id}] ${line}`),
		);
		writeCaseArtifacts(deps.dir, id, outcome);
		deps.log(
			`[case ${id}] 完成 score=${outcome.score.toFixed(2)} triggered=${outcome.triggered} turns=${outcome.turns}`,
		);
		return outcome;
	} catch (e) {
		const failed: CaseOutcome = {
			case_id: id,
			kind: ext?.kind ?? "task",
			triggered: false,
			turns: 0,
			duration_ms: 0,
			score: 0,
			grading: { assertion_results: [], score: 0 },
			timing: { turns: 0, duration_ms: 0, tokens: null },
			error: (e as Error).message.slice(0, 300),
		};
		deps.log(`[case ${id}] 失败：${failed.error}`);
		return failed;
	}
}

function writeCaseArtifacts(dir: string, id: string, outcome: CaseOutcome): void {
	const caseDir = join(dir, "cases", id);
	mkdirSync(caseDir, { recursive: true });
	writeFileSync(join(caseDir, "grading.json"), JSON.stringify(outcome.grading, null, 2));
	writeFileSync(join(caseDir, "timing.json"), JSON.stringify(outcome.timing, null, 2));
	if (outcome.transcript) writeFileSync(join(caseDir, "transcript.json"), JSON.stringify(outcome.transcript, null, 2));
	for (const artifact of outcome.artifacts ?? []) {
		const outDir = join(caseDir, "outputs");
		mkdirSync(outDir, { recursive: true });
		writeFileSync(join(outDir, safeArtifactName(artifact.path)), artifact.content);
	}
}

/** 沙箱环境：config 指定则直接用；否则 workspace 级缓存（env.json），缺失才建 cloud environment。 */
async function resolveEnvironment(
	ctx: ProjectRuntimeContext,
	paths: WorkspacePaths,
	config: EvalConfig,
	log: (line: string) => void,
): Promise<string | undefined> {
	if (config.environment_id) return config.environment_id;
	const envPath = join(paths.root, "env.json");
	if (existsSync(envPath)) {
		const cached = JSON.parse(readFileSync(envPath, "utf8")) as { environment_id?: string };
		if (cached.environment_id) return cached.environment_id;
	}
	const resource = await createCloudEnvironment(ctx, `kit-eval-env-${Date.now() % 100000}`, {
		config: { type: "cloud" },
	});
	const id = String((resource as { id?: string }).id ?? "");
	if (!id) throw new Error("创建 cloud environment 失败（无 id 返回）");
	writeFileSync(envPath, JSON.stringify({ environment_id: id, created_at: new Date().toISOString() }, null, 2));
	log(`[env] 新建沙箱环境 ${id}（workspace 级复用，不随 run 清理）`);
	return id;
}

interface PoolDeps {
	selected: { id: number | string; prompt: string; assertions: string[] }[];
	kit: KitJson;
	dir: string;
	filesDir: string;
	log: (line: string) => void;
	ctx: ProjectRuntimeContext;
	base: string;
	headers: Record<string, string>;
	agentId: string;
	skillName: string;
	config: EvalConfig;
	judge: ReturnType<typeof createLlmClient>;
	skillMd: string;
}

interface BaselineDeps {
	selected: { id: number | string; prompt: string; assertions: string[] }[];
	kit: KitJson;
	dir: string;
	filesDir: string;
	log: (line: string) => void;
	ctx: ProjectRuntimeContext;
	base: string;
	headers: Record<string, string>;
	config: EvalConfig;
	judge: ReturnType<typeof createLlmClient>;
	skillMd: string;
}

/** 建无 skill 的基线 agent → 跑同 case → 归档 → 落 baseline/results.json。 */
async function runBaseline(deps: BaselineDeps): Promise<CaseOutcome[]> {
	const res = await fetch(`${deps.base}/agents`, {
		method: "POST",
		headers: deps.headers,
		body: JSON.stringify({
			name: `kit-eval-base-${Date.now() % 100000}`,
			model: { id: deps.config.model },
			system: deps.config.agent_instructions,
		}),
	});
	if (!res.ok) throw new Error(`建基线 agent 失败 HTTP ${res.status}`);
	const agentId = String(((await res.json()) as { id?: string }).id ?? "");
	deps.log(`[baseline] agent ${agentId}（无 skill）`);
	const baseDir = join(deps.dir, "baseline");
	mkdirSync(join(baseDir, "cases"), { recursive: true });
	const outcomes = await runCasePool({ ...deps, dir: baseDir, agentId, skillName: "" });
	await archiveCloudAgent(deps.ctx, agentId).catch(() => undefined);
	writeFileSync(join(baseDir, "results.json"), JSON.stringify(outcomes, null, 2));
	return outcomes;
}

/** 限并发跑完所选 case（with-skill 与 baseline 共用）。 */
async function runCasePool(deps: PoolDeps): Promise<CaseOutcome[]> {
	const queue: { item: PoolDeps["selected"][number]; rep: number }[] = [];
	for (const item of deps.selected) {
		for (let rep = 1; rep <= deps.config.repeat_k; rep++) queue.push({ item, rep });
	}
	const outcomes: CaseOutcome[] = [];
	const workers = Array.from({ length: Math.min(deps.config.concurrency, queue.length) }, async () => {
		for (;;) {
			const next = queue.shift();
			if (!next) return;
			outcomes.push(await settleCase({ item: next.item, rep: next.rep, ...deps }));
		}
	});
	await Promise.all(workers);
	return outcomes;
}

/** repeat_k>1 时聚合：score 均值、断言多数决（evidence 取多数侧第一个 rep）、triggered 多数决。 */
export function aggregateReps(outcomes: CaseOutcome[]): CaseOutcome[] {
	const byCase = new Map<string, CaseOutcome[]>();
	for (const o of outcomes) {
		const list = byCase.get(o.case_id) ?? [];
		list.push(o);
		byCase.set(o.case_id, list);
	}
	const aggregated: CaseOutcome[] = [];
	for (const [_caseId, reps] of byCase) {
		reps.sort((a, b) => (a.rep ?? 1) - (b.rep ?? 1));
		if (reps.length === 1) {
			aggregated.push(reps[0] as CaseOutcome);
			continue;
		}
		const texts = [...new Set(reps.flatMap((r) => r.grading.assertion_results.map((a) => a.text)))];
		const assertionResults = texts.map((text) => {
			const votes = reps.map((r) => r.grading.assertion_results.find((a) => a.text === text)).filter(Boolean);
			const passedCount = votes.filter((v) => v?.passed).length;
			const passed = passedCount * 2 > votes.length;
			const witness = votes.find((v) => v?.passed === passed) ?? votes[0];
			return {
				text,
				passed,
				evidence: `${passedCount}/${votes.length} reps 通过；例：${(witness?.evidence ?? "").slice(0, 120)}`,
				kind: witness?.kind ?? ("judge" as const),
			};
		});
		const score = reps.reduce((sum, r) => sum + r.score, 0) / reps.length;
		const first = reps[0] as CaseOutcome;
		aggregated.push({
			...first,
			score,
			turns: Math.round(reps.reduce((sum, r) => sum + r.turns, 0) / reps.length),
			duration_ms: Math.round(reps.reduce((sum, r) => sum + r.duration_ms, 0) / reps.length),
			triggered: reps.filter((r) => r.triggered).length * 2 > reps.length,
			grading: { assertion_results: assertionResults, score },
			reps: reps.length,
			recovery: reps.some((r) => r.recovery === "ok") ? "ok" : (first.recovery ?? "skipped"),
		});
	}
	return aggregated.sort((a, b) => a.case_id.localeCompare(b.case_id));
}

/** benchmark 汇总：with vs without 的 pass_rate/turns/time delta（基线缺省为 null）。 */
export function buildBenchmark(withOutcomes: CaseOutcome[], baseOutcomes: CaseOutcome[] | null): BenchmarkJson {
	const block = (list: CaseOutcome[]) => ({
		pass_rate: meanStddev(list.map((o) => o.score)),
		turns: meanStddev(list.map((o) => o.turns)),
		time_seconds: meanStddev(list.map((o) => o.duration_ms / 1000)),
		infra_excluded: 0,
	});
	const withBlock = block(withOutcomes);
	withBlock.infra_excluded = 0;
	if (!baseOutcomes) {
		return { run_summary: { with_skill: { ...withBlock }, without_skill: null, delta: null } };
	}
	const baseBlock = block(baseOutcomes);
	return {
		run_summary: {
			with_skill: withBlock,
			without_skill: baseBlock,
			delta: {
				pass_rate: Number((withBlock.pass_rate.mean - baseBlock.pass_rate.mean).toFixed(4)),
				turns: Number((withBlock.turns.mean - baseBlock.turns.mean).toFixed(4)),
				time_seconds: Number((withBlock.time_seconds.mean - baseBlock.time_seconds.mean).toFixed(4)),
			},
		},
	};
}

function meanStddev(values: number[]): { mean: number; stddev: number } {
	if (values.length === 0) return { mean: 0, stddev: 0 };
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	const stddev = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
	return { mean: Number(mean.toFixed(4)), stddev: Number(stddev.toFixed(4)) };
}

export interface RunOptions {
	workspaceRoot: string;
	skillDir: string;
	skillMd: string;
	credentials: RunCredentials;
	includeDraft?: boolean;
	caseIds?: string[];
	onProgress?: (line: string) => void;
}

/** run 主编排：ingest → 钉版本建 agent → 逐 case（限并发）→ grading/timing/benchmark/manifest。 */
export async function runEval(options: RunOptions): Promise<string> {
	const paths = workspacePaths(options.workspaceRoot);
	const evals = readEvals(paths);
	const kit = readKit(paths);
	const config: EvalConfig = readConfig(paths);
	const log = options.onProgress ?? (() => undefined);

	const selected = evals.evals.filter((e) => {
		const ext = kit.cases[String(e.id)];
		if (options.caseIds?.length) return options.caseIds.includes(String(e.id));
		return options.includeDraft ? true : !(ext?.draft ?? false);
	});
	if (selected.length === 0)
		throw new Error("没有可跑的 case（draft 默认跳过，--include-draft 放开；或 --cases 指定）");

	const ctx = await buildEvalContext(options.credentials);
	const base = agentstudioBase(options.credentials);
	const headers = { authorization: `Bearer ${options.credentials.apiKey}`, "content-type": "application/json" };

	log("[ingest] 上传/复用 skill…");
	const ingest = await ingestSkill(ctx, paths, options.skillDir, {
		reviewTimeoutMs: config.review_timeout_ms,
		rest: { base, headers },
		onStatus: (status, seconds) => log(`[ingest] 审查状态 ${status}（${seconds}s）`),
	});
	log(
		`[ingest] ${ingest.reused ? "复用" : "新上传"} ${ingest.skill_id} v${ingest.version}（审查 ${ingest.review_seconds}s）`,
	);

	const environmentId = await resolveEnvironment(ctx, paths, config, log);
	const agentName = `kit-eval-${ingest.source_hash}-${Date.now() % 100000}`;
	const createdAgent = await fetch(`${base}/agents`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			name: agentName,
			model: { id: config.model },
			// 文档字段名是 system（不是 instructions）；沙箱能力靠 builtin_toolkit（见 docs/research/skill-eval-probe.md）
			system: config.agent_instructions,
			skills: [{ type: "customer", skill_id: ingest.skill_id, version: ingest.version }],
			...(environmentId ? { environment_id: environmentId } : {}),
			...(config.sandbox_tools
				? {
						tools: [
							{
								type: "builtin_toolkit",
								default_config: { enabled: true, permission_policy: { type: "always_allow" } },
								configs: [
									{ name: "bash", enabled: true },
									{ name: "read", enabled: true },
									{ name: "write", enabled: true },
								],
							},
						],
					}
				: {}),
		}),
	});
	if (!createdAgent.ok)
		throw new Error(`建评测 agent 失败 HTTP ${createdAgent.status}: ${(await createdAgent.text()).slice(0, 200)}`);
	const agentBody = (await createdAgent.json()) as { id?: string };
	const agentId = String(agentBody.id ?? "");
	log(`[agent] ${agentId}（model=${config.model}, skill v${ingest.version}）`);

	const runId = newRunId();
	const dir = runDir(paths, runId);
	mkdirSync(join(dir, "cases"), { recursive: true });
	// 开局先落 running manifest：进程中途死掉时留下可识别的残 run（report/diff 会跳过）
	writeFileSync(
		join(dir, "manifest.json"),
		JSON.stringify(
			{
				run_id: runId,
				status: "running",
				created_at: new Date().toISOString(),
				skill: {
					source_hash: ingest.source_hash,
					skill_id: ingest.skill_id,
					version: ingest.version,
					name: ingest.name,
				},
				agent_id: agentId,
				model: config.model,
				judge_model: config.judge_model,
				cases_hash: casesHash(evals, kit),
				case_ids: selected.map((s) => String(s.id)),
				config,
			},
			null,
			2,
		),
	);
	const judge = createLlmClient({ apiKey: options.credentials.apiKey, model: config.judge_model });

	const outcomes = await runCasePool({
		selected,
		kit,
		filesDir: paths.filesDir,
		dir,
		log,
		ctx,
		base,
		headers,
		agentId,
		skillName: ingest.name,
		config,
		judge,
		skillMd: options.skillMd,
	});

	// agent 只归档不硬删（DELETE 405，见探针记录）
	await archiveCloudAgent(ctx, agentId).catch((e: Error) =>
		log(`[cleanup] agent 归档失败：${e.message.slice(0, 120)}`),
	);

	// without-skill 基线（成本 ×2，默认关）：同 case 同环境，只去掉 skill 挂载
	const baselineOutcomes = config.baseline_without_skill
		? await runBaseline({
				selected,
				kit,
				dir,
				filesDir: paths.filesDir,
				log,
				ctx,
				base,
				headers,
				config,
				judge,
				skillMd: options.skillMd,
			})
		: null;

	const aggregated = aggregateReps(outcomes);
	const scorable = aggregated.filter((o) => !o.infra_error);
	if (scorable.length === 0) {
		throw new Error("所有 case 都因基础设施故障被排除（infra_error），本次 run 无有效评分：重跑或检查 environment");
	}
	const baseAggregated = baselineOutcomes ? aggregateReps(baselineOutcomes) : null;
	const baseScorable = baseAggregated ? baseAggregated.filter((o) => !o.infra_error) : null;
	if (baselineOutcomes && (baseScorable?.length ?? 0) === 0) {
		throw new Error("基线 run 全部 infra_error，delta 不可算：重跑或关闭 baseline_without_skill");
	}
	const benchmark = buildBenchmark(scorable, baseScorable);
	benchmark.run_summary.with_skill.infra_excluded = outcomes.length - scorable.length;
	const manifest: RunManifest = {
		run_id: runId,
		status: "complete",
		created_at: new Date().toISOString(),
		skill: { source_hash: ingest.source_hash, skill_id: ingest.skill_id, version: ingest.version, name: ingest.name },
		agent_id: agentId,
		model: config.model,
		judge_model: config.judge_model,
		cases_hash: casesHash(evals, kit),
		case_ids: selected.map((s) => String(s.id)),
		config,
	};
	writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
	writeFileSync(join(dir, "benchmark.json"), JSON.stringify(benchmark, null, 2));
	writeFileSync(join(dir, "results.json"), JSON.stringify(aggregated, null, 2));
	log(`[done] run=${runId} pass_rate=${benchmark.run_summary.with_skill.pass_rate.mean}`);
	return runId;
}
