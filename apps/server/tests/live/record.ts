/**
 * 只读录制器：从真实 workspace 抓取 provider 原始响应存为契约 fixture。
 * 不创建/修改/删除任何远端资源（见 AGENTS.md「真实 Cloud 验证」）。
 * 运行：KIT_LIVE=1 pnpm --filter @openagentpack/kit-server exec tsx tests/live/record.ts
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type BackendRuntimeInput,
	LocalFileStateBackend,
	listRemoteAgents,
	listSessionEvents,
	listSessionSummaries,
	readProjectRuntime,
	resolveProjectConfigFromObject,
} from "@openagentpack/sdk";
import { loadConfig, redactSecrets } from "../../src/config.ts";

const OUT = join(process.cwd(), "tests/fixtures");

/**
 * 入库脱敏：fixture 会进仓库，真实对话正文/工具入参/分页游标一律替换为 `[redacted:<长度>]`；
 * **结构性字段保留**（type/raw_type/role/status/tool_name/id 决定 mapper 分支与去重语义），
 * 否则契约测试失去意义。脱敏是否彻底由 `tests/contract.test.ts` 的叶子级用例守护。
 */
const PRESERVE_KEYS = new Set(["type", "role", "status"]);
/** metadata 里保留原值的结构性键（其余字符串一律脱敏）。 */
const PRESERVE_META_KEYS = new Set(["status", "session_thread_id", "display_bucket", "tool_name"]);

function redactLeaf(value: string): string {
	return value.length > 0 ? `[redacted:${value.length}]` : value;
}

/** 深度脱敏：字符串叶子替换为占位符，结构性键保留原值。 */
function scrubDeep(value: unknown, key?: string): unknown {
	if (typeof value === "string") return key && PRESERVE_KEYS.has(key) ? value : redactLeaf(value);
	if (Array.isArray(value)) return value.map((item) => scrubDeep(item));
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, item] of Object.entries(value as Record<string, unknown>)) out[k] = scrubDeep(item, k);
		return out;
	}
	return value;
}

function scrubContentBlock(block: Record<string, unknown>): Record<string, unknown> {
	const next: Record<string, unknown> = { ...block };
	if (typeof next.text === "string") next.text = redactLeaf(next.text);
	if (next.data !== undefined) next.data = scrubDeep(next.data);
	return next;
}

function scrubMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(metadata)) {
		if (key === "artifact" && value && typeof value === "object") out[key] = scrubDeep(value);
		else if (typeof value === "string" && !PRESERVE_META_KEYS.has(key)) out[key] = redactLeaf(value);
		else out[key] = value;
	}
	return out;
}

/** 顶层字符串字段（provider 事件的 content 是字符串，不是块数组——曾因此漏脱敏）。 */
const STRING_LEAF_KEYS = ["content", "tool_input", "message"] as const;

/**
 * 事件级脱敏：保留契约结构与 `id`（去重/游标依赖唯一值），
 * 脱敏顶层字符串叶子、content 块、metadata 与 `raw` 载荷。
 */
function scrubEvent(event: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...event };
	for (const key of STRING_LEAF_KEYS) {
		if (typeof out[key] === "string") out[key] = redactLeaf(out[key] as string);
	}
	if (Array.isArray(out.content)) out.content = (out.content as Record<string, unknown>[]).map(scrubContentBlock);
	if (out.metadata && typeof out.metadata === "object") {
		out.metadata = scrubMetadata(out.metadata as Record<string, unknown>);
	}
	if (out.raw !== undefined) out.raw = scrubDeep(out.raw);
	return out;
}

function scrubAgentsPage(page: unknown): unknown {
	return scrubDeep(page);
}

async function buildInput(): Promise<BackendRuntimeInput> {
	const config = loadConfig({ ...process.env, KIT_GATEWAY: "sdk" });
	if (!config.bailian) throw new Error("缺少 BAILIAN 凭据");
	const providerConfig: Record<string, unknown> = { api_key: config.bailian.apiKey };
	if (config.bailian.baseUrl) providerConfig.base_url = config.bailian.baseUrl;
	if (config.bailian.workspaceId) providerConfig.workspace_id = config.bailian.workspaceId;
	const loaded = (await resolveProjectConfigFromObject(
		{ version: "1", project: "kit-record", providers: { bailian: providerConfig }, agents: {} },
		{ projectName: "kit-record", resolveEnv: false },
	)) as unknown as { config?: unknown };
	return {
		projectName: "kit-record",
		config: (loaded.config ?? loaded) as never,
		// 列表类 op 会读 state：给一个空的临时 state 文件（只读使用，不写远端）
		stateBackend: new LocalFileStateBackend({
			statePath: join(mkdtempSync(join(tmpdir(), "kit-record-")), "state.json"),
		}),
		stateScope: { projectId: "kit-record" },
		providers: { bailian: providerConfig },
	};
}

async function main() {
	const input = await buildInput();

	const agentsPage = await readProjectRuntime(input, (ctx) => listRemoteAgents(ctx, { limit: 20 }));
	writeFileSync(join(OUT, "bailian-agents-page.json"), `${JSON.stringify(scrubAgentsPage(agentsPage), null, 2)}\n`);
	console.warn(`[record] agents page keys=${Object.keys(agentsPage as object).join(",")}`);

	const summaries = await readProjectRuntime(input, (ctx) => listSessionSummaries(ctx, {}));
	// 实测形状（2026-10-14）：{ provider, hasMore, nextPage, summaries: [{ session: { id, ... } }] }
	const list = ((summaries as unknown as { summaries?: { session?: { id?: string } }[] }).summaries ?? [])
		.map((entry) => entry.session?.id)
		.filter((id): id is string => Boolean(id));
	console.warn(`[record] sessions=${list.length}`);

	let recorded = 0;
	for (const sessionId of list) {
		if (recorded >= 2) break;
		const page = await readProjectRuntime(input, (ctx) => listSessionEvents(ctx, sessionId, { limit: 60 }));
		if ((page.events ?? []).length === 0) continue;
		const scrubbedPage = {
			...page,
			// 分页游标内含 msg id（base64），同样脱敏
			...(page.next_page ? { next_page: redactLeaf(page.next_page) } : {}),
			events: (page.events ?? []).map((e) => scrubEvent(e as unknown as Record<string, unknown>)),
		};
		writeFileSync(
			join(OUT, `bailian-session-events-${recorded + 1}.json`),
			`${JSON.stringify(scrubbedPage, null, 2)}\n`,
		);
		console.warn(`[record] session ${sessionId}: ${page.events.length} events`);
		recorded += 1;
	}
	if (recorded === 0) throw new Error("未录到任何会话事件：workspace 内没有带事件的 session");
	console.warn("[record] OK（只读，未改动任何远端资源）");
}

main().catch((error) => {
	console.error(`[record] FAILED: ${redactSecrets(error instanceof Error ? error.message : String(error))}`);
	process.exit(1);
});
