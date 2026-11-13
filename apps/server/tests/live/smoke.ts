/**
 * live 冒烟：真实百炼 workspace 上跑 kit 的目标全链路
 * （声明 → plan → apply → 建会话 → 发消息 → 流式 → 清理）。
 *
 * 运行：KIT_LIVE=1 pnpm --filter @openagentpack/kit-server exec tsx tests/live/smoke.ts
 * 规则（AGENTS.md「真实 Cloud 验证」）：唯一前缀 + metadata、结束清理、不输出凭据。
 */
import { join } from "node:path";
import {
	archiveCloudAgent,
	type BackendRuntimeInput,
	createSessionForAgent,
	deleteFile,
	deleteSession,
	destroyPlannedProjectResources,
	getFileInfo,
	getSession,
	LocalFileStateBackend,
	listRemoteAgents,
	planDestroyProjectContext,
	planProjectWithStateBackend,
	readProjectRuntime,
	resolveProjectConfigFromObject,
	sendRemoteSessionEvents,
	streamSessionEvents,
	syncProjectResourcesWithStateBackend,
} from "@openagentpack/sdk";
import { sanitizeSessionEvent } from "@openagentpack/sdk/session-events";
import { loadConfig, redactSecrets } from "../../src/config.ts";
import { createSdkGateway } from "../../src/gateway/sdk.ts";

const PREFIX =
	process.env.KIT_LIVE_PREFIX ??
	`kit-live-${new Date()
		.toISOString()
		.replace(/[-:T.Z]/g, "")
		.slice(0, 12)}`;
const AGENT_KEY = `${PREFIX}-smoke`;

async function buildRuntimeInput(): Promise<BackendRuntimeInput> {
	const config = loadConfig({ ...process.env, KIT_GATEWAY: "sdk", KIT_AUTH_MODE: "anonymous" });
	if (!config.bailian) throw new Error("缺少 BAILIAN 凭据");
	const providerConfig: Record<string, unknown> = { api_key: config.bailian.apiKey };
	if (config.bailian.baseUrl) providerConfig.base_url = config.bailian.baseUrl;
	if (config.bailian.workspaceId) providerConfig.workspace_id = config.bailian.workspaceId;
	const loaded = (await resolveProjectConfigFromObject(
		{
			version: "1",
			project: "kit-live-smoke",
			providers: { bailian: providerConfig },
			environments: {
				[`${PREFIX}-env`]: { config: { type: "cloud" }, metadata: { kit: "live-validation", prefix: PREFIX } },
			},
			agents: {
				[AGENT_KEY]: {
					model: process.env.KIT_LIVE_MODEL ?? "qwen3.8-max",
					instructions: `你是 OpenAgentPack Kit 的 live 冒烟测试临时 Agent（前缀 ${PREFIX}）。请始终只用一句不超过 20 字的话回复用户。`,
					environment: `${PREFIX}-env`,
					metadata: { kit: "live-validation", prefix: PREFIX },
				},
			},
		},
		{ projectName: "kit-live-smoke", resolveEnv: false },
	)) as unknown as { config?: unknown };
	return {
		projectName: "kit-live-smoke",
		config: (loaded.config ?? loaded) as never,
		stateBackend: new LocalFileStateBackend({ statePath: join(config.dataDir, `${PREFIX}.state.json`) }),
		stateScope: { projectId: "kit-live-smoke" },
		providers: { bailian: providerConfig },
	};
}

async function provision(input: BackendRuntimeInput): Promise<void> {
	const planned = await planProjectWithStateBackend(input);
	const actions = (planned as unknown as { plan?: { actions?: unknown[] } }).plan?.actions ?? [];
	console.warn(`[live] plan actions=${actions.length}`);
	// 必须走 backend 感知的 sync：executePlannedProject 只写 plan 期的只读内存 state
	const sync = await syncProjectResourcesWithStateBackend(input, {});
	const syncView = sync as unknown as {
		results?: { address?: { type?: string; name?: string }; status?: string; error?: string }[];
	};
	for (const r of syncView.results ?? []) {
		console.warn(
			`[live]   ${r.address?.type}/${r.address?.name} => ${r.status}${r.error ? ` (${redactSecrets(r.error)})` : ""}`,
		);
	}
	console.warn("[live] apply done");
}

interface ConversationResult {
	types: Map<string, number>;
	assistantText: string;
	finalStatus: string;
}

async function converse(input: BackendRuntimeInput, sessionId: string): Promise<ConversationResult> {
	const types = new Map<string, number>();
	let assistantText = "";
	const deadline = Date.now() + 180_000;
	await readProjectRuntime(input, async (ctx) => {
		for await (const raw of streamSessionEvents(ctx, sessionId, {})) {
			const event = sanitizeSessionEvent(raw);
			types.set(event.type, (types.get(event.type) ?? 0) + 1);
			if (event.type === "message" && event.role !== "user") assistantText += textOfEvent(event);
			if (isTurnEnd(event)) break;
			if (Date.now() > deadline) throw new Error("live: 180s 超时未收敛");
		}
	});
	const info = await readProjectRuntime(input, (ctx) => getSession(ctx, sessionId));
	return { types, assistantText, finalStatus: info.status };
}

function textOfEvent(event: ReturnType<typeof sanitizeSessionEvent>): string {
	return (event.content ?? []).map((b) => (b as { text?: string }).text ?? "").join("");
}

function isTurnEnd(event: ReturnType<typeof sanitizeSessionEvent>): boolean {
	return event.type === "session_status" && (event.metadata as Record<string, unknown> | undefined)?.status === "idle";
}

/**
 * 会话生命周期 + 附件链路的 live 验证，全部经 **kit 自己的 SdkGateway**（不直接用 SDK 建会话），
 * 验证的是产品代码路径而不是探针代码：
 *   建会话（远端 agent id，无附件）→ getSession → deleteSession → getSession 应为 null
 *   上传 → 等扫描可用 → createSession → mountSessionResource（运行时挂载，返回 resourceId）
 *   → 发消息请 agent 读文件（软断言）→ archiveSession → deleteSession → deleteFile
 *
 * 硬断言：gateway 的 create/get/archive/delete/uploadFile/mountSessionResource 行为。
 * 软断言：agent 能否读到文件取决于其工具集（临时 Agent 无工具时只告警）；
 *   provider 不回显运行时挂载（echo 仅观察，不作为断言）。
 * wire 形状与沙箱物化的实测依据：docs/research/bailian-session-file-mount.md。
 */
async function verifySessionLifecycle(
	input: BackendRuntimeInput,
	gateway: ReturnType<typeof createSdkGateway>,
): Promise<{ mounted: boolean; echoed: boolean }> {
	const remote = (await gateway.listRemoteAgents()).find((a) => a.name === AGENT_KEY);
	if (!remote) throw new Error(`live: 未在 workspace 找到临时 agent ${AGENT_KEY}`);

	// 1) 无附件建会话：kit 数据面主入口（catalog 存的是远端 agent id）
	const plain = await gateway.createSession({ agentId: remote.agent_id, title: `${PREFIX} plain` });
	const plainDetail = await gateway.getSession(plain.session_id);
	if (!plainDetail) throw new Error("live: 建会话后 getSession 返回 null");
	console.warn(`[live] plain session=${plain.session_id} status=${plainDetail.status}`);
	await gateway.deleteSession(plain.session_id);
	if (await gateway.getSession(plain.session_id)) throw new Error("live: 删除后仍能读到会话");
	console.warn("[live] plain session deleted（getSession 已为 null）");

	// 2) 上传 + 运行时挂载（创建时 file_resource 回显成功但 sandbox 不物化，2026-11-03 实测）
	const marker = `${PREFIX}-marker-42`;
	const filename = `${PREFIX}-note.txt`;
	const bytes = new TextEncoder().encode(`kit live attachment\n${marker}\n`);
	const uploaded = await gateway.uploadFile({ filename, bytes, mimeType: "text/plain" });
	if (!uploaded.file_id) throw new Error("live: uploadFile 未返回 file_id");
	console.warn(`[live] uploaded file=${uploaded.file_id} size=${uploaded.size}`);

	// 文件需先过扫描才可挂载（实测 checking → available 约 15~20s）
	let available = false;
	for (let i = 0; i < 15 && !available; i++) {
		const info = await readProjectRuntime(input, (ctx) => getFileInfo(ctx, uploaded.file_id));
		available = info.available;
		console.warn(`[live] file scan status=${info.status ?? "-"} available=${available}`);
		if (!available) await new Promise((r) => setTimeout(r, 2000));
	}

	const mountPath = `/mnt/session/uploads/${filename}`;
	const created = await gateway.createSession({ agentId: remote.agent_id, title: `${PREFIX} files` });
	const mount = await gateway.mountSessionResource(created.session_id, { fileId: uploaded.file_id, mountPath });
	console.warn(`[live] file session=${created.session_id} mount=${mount.mountPath} resource=${mount.resourceId}`);
	if (!mount.resourceId) throw new Error("live: 运行时挂载未返回 resource id，无法支持回滚与索引");
	const detail = await gateway.getSession(created.session_id);
	const echoed = (detail?.files ?? []).some((f) => f.file_id === uploaded.file_id);
	console.warn(`[live] session files echo=${JSON.stringify(detail?.files ?? [])}（运行时挂载 provider 不回显属正常）`);

	await gateway.sendMessage(created.session_id, {
		text: `请读取 ${mountPath}，把包含 marker 的那一行原样输出，不要解释。`,
	});
	const result = await converse(input, created.session_id);
	const echoedText = result.assistantText.includes(marker);
	console.warn(`[live] file session assistant: ${redactSecrets(result.assistantText.slice(0, 120))}`);
	if (!echoedText)
		console.warn("[live] ⚠️ agent 未回显 marker：挂载成立，但该临时 Agent 可能没有文件读取工具（软断言）");

	await gateway.archiveSession(created.session_id);
	console.warn("[live] file session archived");
	try {
		await gateway.deleteSession(created.session_id);
		console.warn("[live] file session deleted");
	} catch (error) {
		console.warn(`[live] 归档后删除失败（需手工）: ${redactSecrets(String(error))}`);
	}
	try {
		await readProjectRuntime(input, (ctx) => deleteFile(ctx, uploaded.file_id));
		console.warn("[live] uploaded file deleted");
	} catch (error) {
		console.warn(`[live] 删除文件失败（需手工）: ${redactSecrets(String(error))}`);
	}
	return { mounted: !!mount.resourceId, echoed };
}

async function teardown(input: BackendRuntimeInput, sessionId: string): Promise<void> {
	try {
		await readProjectRuntime(input, (ctx) => deleteSession(ctx, sessionId));
		console.warn("[live] session deleted");
	} catch (error) {
		console.warn(`[live] 删除会话失败（需手工）: ${redactSecrets(String(error))}`);
	}
	const destroyPlan = await readProjectRuntime(input, (ctx) => planDestroyProjectContext(ctx));
	await destroyPlannedProjectResources(destroyPlan as never, {});
	console.warn("[live] resources destroyed");
}

async function sweepLeftovers(input: BackendRuntimeInput): Promise<number> {
	const leftovers = await readProjectRuntime(input, async (ctx) => {
		const page = (await listRemoteAgents(ctx, { limit: 100 })) as unknown as {
			data?: { id?: string; name?: string }[];
		};
		return (page.data ?? []).filter((a) => (a.name ?? "").startsWith("kit-live-"));
	});
	for (const leftover of leftovers) {
		try {
			await readProjectRuntime(input, (ctx) => archiveCloudAgent(ctx, leftover.id as string));
			console.warn(`[live] archived ${leftover.name}`);
		} catch (error) {
			console.warn(`[live] 归档 ${leftover.name} 失败: ${redactSecrets(String(error))}`);
		}
	}
	return leftovers.length;
}

async function main() {
	const input = await buildRuntimeInput();
	console.warn(`[live] prefix=${PREFIX} agent=${AGENT_KEY}`);
	await provision(input);

	const session = await readProjectRuntime(input, (ctx) =>
		createSessionForAgent(ctx, { agent: AGENT_KEY, title: `${PREFIX} smoke` }),
	);
	console.warn(`[live] session=${session.session.id}`);
	const prompt = `${PREFIX} 请回复 OK。`;
	await readProjectRuntime(input, (ctx) =>
		sendRemoteSessionEvents(ctx, session.session.id, [
			{ type: "message", role: "user", content: [{ type: "text", text: prompt }] },
		]),
	);
	console.warn("[live] message sent");

	const result = await converse(input, session.session.id);
	console.warn(`[live] event types: ${JSON.stringify(Object.fromEntries(result.types))}`);
	console.warn(`[live] assistant: ${redactSecrets(result.assistantText.slice(0, 80))}`);
	console.warn(`[live] final session status=${result.finalStatus}`);
	if (!result.types.has("message")) throw new Error("live: 未收到 message 事件");
	if ((result.types.get("session_status") ?? 0) < 1) throw new Error("live: 未收到 session_status（turn 未收敛）");

	const liveConfig = loadConfig({ ...process.env, KIT_GATEWAY: "sdk", KIT_AUTH_MODE: "anonymous" });
	if (!liveConfig.bailian) throw new Error("live: 缺少 BAILIAN 凭据");
	const lifecycle = await verifySessionLifecycle(input, createSdkGateway(liveConfig.bailian));
	console.warn(
		`[live] session lifecycle + attachment mount verified (mounted=${lifecycle.mounted} echoed=${lifecycle.echoed})`,
	);

	await teardown(input, session.session.id);
	const leftovers = await sweepLeftovers(input);
	console.warn(`[live] 残留 kit-live-* agent=${leftovers}（已尝试归档）`);
	console.warn("[live] SMOKE OK");
}

main().catch((error) => {
	console.error(`[live] SMOKE FAILED: ${redactSecrets(error instanceof Error ? error.message : String(error))}`);
	process.exit(1);
});
