/**
 * 清理历次 live 验证残留：遍历 .data/kit-live-*.state.json，按 state 销毁远端资源。
 * 运行：KIT_LIVE=1 pnpm --filter @openagentpack/kit-server exec tsx tests/live/cleanup.ts
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
	archiveCloudAgent,
	type BackendRuntimeInput,
	destroyPlannedProjectResources,
	LocalFileStateBackend,
	listRemoteAgents,
	planDestroyProjectContext,
	readProjectRuntime,
	resolveProjectConfigFromObject,
} from "@openagentpack/sdk";
import { loadConfig, redactSecrets } from "../../src/config.ts";

const config = loadConfig({ ...process.env, KIT_GATEWAY: "sdk" });
if (!config.bailian) throw new Error("缺少凭据");
const providerConfig: Record<string, unknown> = { api_key: config.bailian.apiKey };
if (config.bailian.baseUrl) providerConfig.base_url = config.bailian.baseUrl;
if (config.bailian.workspaceId) providerConfig.workspace_id = config.bailian.workspaceId;

async function inputFor(prefix: string): Promise<BackendRuntimeInput> {
	const loaded = (await resolveProjectConfigFromObject(
		{
			version: "1",
			project: "kit-live-smoke",
			providers: { bailian: providerConfig },
			environments: { [`${prefix}-env`]: { config: { type: "cloud" } } },
			agents: { [`${prefix}-smoke`]: { model: "qwen3.8-max", instructions: "cleanup", environment: `${prefix}-env` } },
		},
		{ projectName: "kit-live-smoke", resolveEnv: false },
	)) as unknown as { config?: unknown };
	return {
		projectName: "kit-live-smoke",
		config: (loaded.config ?? loaded) as never,
		stateBackend: new LocalFileStateBackend({ statePath: join(config.dataDir, `${prefix}.state.json`) }),
		stateScope: { projectId: "kit-live-smoke" },
		providers: { bailian: providerConfig },
	};
}

const stateFiles = readdirSync(config.dataDir).filter((f) => f.startsWith("kit-live-") && f.endsWith(".state.json"));
console.warn(`[cleanup] state files: ${stateFiles.length}`);
for (const file of stateFiles) {
	const prefix = file.replace(".state.json", "");
	try {
		const input = await inputFor(prefix);
		const destroyPlan = await readProjectRuntime(input, (ctx) => planDestroyProjectContext(ctx));
		await destroyPlannedProjectResources(destroyPlan as never, {});
		console.warn(`[cleanup] destroyed resources of ${prefix}`);
	} catch (error) {
		console.warn(`[cleanup] ${prefix} 失败: ${redactSecrets(String(error))}`);
	}
}

// 归档任何残留的 kit-live-* Agent（Provider 有引用时拒绝删除，按协议归档）
const input = await inputFor("final-sweep");
const leftovers = await readProjectRuntime(input, async (ctx) => {
	const page = (await listRemoteAgents(ctx, { limit: 100 })) as unknown as { data?: { id?: string; name?: string }[] };
	return (page.data ?? []).filter((a) => (a.name ?? "").startsWith("kit-live-"));
});
for (const leftover of leftovers) {
	try {
		await readProjectRuntime(input, (ctx) => archiveCloudAgent(ctx, leftover.id as string));
		console.warn(`[cleanup] archived ${leftover.name}`);
	} catch (error) {
		console.warn(`[cleanup] 归档 ${leftover.name} 失败: ${redactSecrets(String(error))}`);
	}
}
console.warn(`[cleanup] done, leftovers=${leftovers.length}`);
