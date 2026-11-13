import { KitError } from "@openagentpack/kit-sdk/protocol";
import type { SessionMemoryStoreResource } from "@openagentpack/sdk";
import { type BailianCredentials, redactSecrets } from "../config.ts";

/**
 * bailian REST 直连：gateway 内部的**窄口子**，只覆盖「建会话时绑定资源」这一条路径。
 *
 * 存在理由（实测证据见 docs/research/bailian-session-file-mount.md）：
 * - 指定 Agent 历史版本须传 `agent:{id,version}`；安装版 SDK 建会话不能传版本。
 *   官方合同核对见 docs/research/2026-10-30-agent-version-binding.md。
 * - 文件挂载**不走创建载荷**（2026-11-03 实测）：`resources:[{type:"file_resource",…}]`
 *   返回 200 且 GET /sessions/:id 回显绑定，但 sandbox 不物化（/mnt/session/uploads 不存在）；
 *   顶层 `files:[{file_id, mount_path}]` 返回 **200 但被静默忽略**——都是「看起来成功、其实没挂载」。
 *   附件一律由服务层在建会话后走运行时挂载（`POST /sessions/:id/resources`，type `file`，实测可见）。
 *
 * 上游若把版本绑定并入 SDK 建会话合同后，可评估删除本文件（见 apps/server/AGENTS.md 不变量 7）。
 */
type BailianSessionResource = SessionMemoryStoreResource;

/** POST /sessions 的原始响应（只声明 kit 用到的字段，其余透传）。 */
export interface RawBailianSession {
	id: string;
	status?: string;
	title?: string;
	environment_id?: string;
	resources?: { type?: string; file_id?: string; mount_path?: string | null }[];
}

export function workspaceBaseUrl(credentials: BailianCredentials): string {
	if (credentials.baseUrl) return credentials.baseUrl.replace(/\/+$/, "");
	if (credentials.workspaceId) {
		return `https://${credentials.workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio`;
	}
	throw new KitError("internal", "bailian 需要 BAILIAN_BASE_URL 或 BAILIAN_WORKSPACE_ID");
}

export function createBailianRest(credentials: BailianCredentials) {
	const baseUrl = workspaceBaseUrl(credentials);

	async function post(path: string, body: Record<string, unknown>): Promise<RawBailianSession> {
		const res = await fetch(`${baseUrl}${path}`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${credentials.apiKey}` },
			body: JSON.stringify(body),
		});
		const text = await res.text();
		if (!res.ok)
			throw new KitError(
				"provider_error",
				`bailian ${path} → HTTP ${res.status}: ${redactSecrets(text.slice(0, 300))}`,
				{ retryable: res.status >= 500 },
			);
		return JSON.parse(text) as RawBailianSession;
	}

	return {
		/** 建会话并挂载文件与记忆资源；`environmentId` 省略时由 provider 用 agent 默认环境（实测可行）。 */
		createSessionWithResources(input: {
			agentId: string;
			agentVersion?: number;
			title?: string;
			metadata?: Record<string, string>;
			environmentId?: string;
			vaultIds?: string[];
			resources?: BailianSessionResource[];
		}): Promise<RawBailianSession> {
			return post("/sessions", {
				agent: input.agentVersion !== undefined ? { id: input.agentId, version: input.agentVersion } : input.agentId,
				...(input.vaultIds?.length ? { vault_ids: input.vaultIds } : {}),
				...(input.environmentId ? { environment_id: input.environmentId } : {}),
				...(input.title ? { title: input.title } : {}),
				...(input.metadata ? { metadata: input.metadata } : {}),
				// 空数组也发会被 provider 当成显式清空，省略更安全
				...(input.resources?.length ? { resources: input.resources } : {}),
			});
		},
	};
}

/** provider 回显的 resources → kit 契约的附件引用（只取 file_resource）。 */
export function filesFromResources(
	resources: { type?: string; file_id?: string; mount_path?: string | null }[] | undefined,
): { file_id: string; mount_path?: string }[] {
	return (resources ?? [])
		.filter((r) => r.type === "file_resource" && typeof r.file_id === "string")
		.map((r) => ({ file_id: r.file_id as string, ...(r.mount_path ? { mount_path: r.mount_path } : {}) }));
}
