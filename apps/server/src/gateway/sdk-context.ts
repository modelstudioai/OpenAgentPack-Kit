import {
	createProjectRuntime,
	type IStateManager,
	type ProjectRuntimeContext,
	resolveProjectConfigFromObject,
} from "@openagentpack/sdk";
import type { BailianCredentials } from "../config.ts";

/** Workspace 只读运行时没有本地资源映射；仍提供 SDK 要求的完整公开 State 合同。 */
function emptyReadOnlyState(): IStateManager {
	const rejectWrite = () => {
		throw new Error("Workspace runtime state is read-only");
	};
	return {
		getResource: () => undefined,
		findResource: () => undefined,
		listResources: () => [],
		getStateFile: () => ({ resources: [] }),
		setResource: rejectWrite,
		removeResource: rejectWrite,
		save: async () => rejectWrite(),
	};
}

/**
 * 构造指向 Bailian workspace 的 ProjectRuntimeContext（无 project 文件依赖）。
 * live 脚本（smoke/record）与 SdkGateway 共用，避免三处复制凭据装配逻辑。
 */
export async function buildSdkContext(credentials: BailianCredentials): Promise<ProjectRuntimeContext> {
	const providerConfig: Record<string, unknown> = { api_key: credentials.apiKey };
	if (credentials.baseUrl) providerConfig.base_url = credentials.baseUrl;
	if (credentials.workspaceId) providerConfig.workspace_id = credentials.workspaceId;
	const loaded = (await resolveProjectConfigFromObject(
		{ version: "1", project: "kit-server", providers: { bailian: providerConfig }, agents: {} },
		{ projectName: "kit-server", resolveEnv: false },
	)) as unknown as { config?: unknown } & Record<string, unknown>;
	return createProjectRuntime({
		projectName: "kit-server",
		config: (loaded.config ?? loaded) as never,
		state: emptyReadOnlyState(),
		providers: { bailian: providerConfig },
	});
}
