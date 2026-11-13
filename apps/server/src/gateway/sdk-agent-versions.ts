import { KitError, type RemoteAgentVersion } from "@openagentpack/kit-sdk/protocol";
import {
	type AgentPage,
	ApiError,
	getRemoteAgent,
	listRemoteAgentVersions,
	type ProjectRuntimeContext,
} from "@openagentpack/sdk";
import { agentVersionDetail } from "./agent-version-detail.ts";
import { withAgentSkillDisplayMeta } from "./sdk-agent-skill-names.ts";
import type { ProviderGateway } from "./types.ts";

function validateAgentId(agentId: string): void {
	// SDK 将 ID 直接拼入路径，不能让输入改变资源路径或查询参数。
	if (!/^[A-Za-z0-9_-]+$/.test(agentId)) throw new KitError("invalid_request", "智能体 ID 格式无效");
}

function isAgentVersion(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function toRemoteVersion(agent: Awaited<ReturnType<typeof getRemoteAgent>>, agentId: string, version: number) {
	if (agent.archived_at || agent.attributes?.status === "archived") return null;
	if (agent.id !== agentId || agent.version !== version)
		throw new KitError("provider_error", "智能体版本信息不一致，请稍后重试");
	return { agent_id: agentId, name: agent.name || agentId, version };
}

function nextVersionPage(page: AgentPage, seenPages: Set<string>): string | undefined {
	const token = page.next_page;
	if (page.has_more && !token) throw new KitError("provider_error", "智能体版本列表缺少下一页游标，请重试");
	if (token && seenPages.has(token)) throw new KitError("provider_error", "智能体版本列表分页游标重复，请重试");
	if (token) seenPages.add(token);
	return token;
}

async function collectVersions(context: ProjectRuntimeContext, agentId: string): Promise<RemoteAgentVersion[]> {
	const versions = new Set<number>();
	const seenPages = new Set<string>();
	let pageToken: string | undefined;
	do {
		const page = await listRemoteAgentVersions(context, agentId, {
			limit: 100,
			...(pageToken ? { page: pageToken } : {}),
		});
		for (const info of page.data) {
			// 历史条目可能只有 agent_id/version/config；不依赖 SDK 映射出的 id。
			if (!isAgentVersion(info.version)) throw new KitError("provider_error", "智能体版本信息无效，请稍后重试");
			versions.add(info.version);
		}
		pageToken = nextVersionPage(page, seenPages);
	} while (pageToken);
	return [...versions].sort((left, right) => right - left).map((version) => ({ version }));
}

/** 仅使用 SDK 公开接口；详情单独按需读取、投影并脱敏。 */
export function createSdkAgentVersionGateway(
	context: () => Promise<ProjectRuntimeContext>,
): Pick<ProviderGateway, "listRemoteAgentVersions" | "getRemoteAgentVersion" | "getRemoteAgentVersionDetail"> {
	async function readVersion(agentId: string, version: number) {
		validateAgentId(agentId);
		if (!isAgentVersion(version)) throw new KitError("invalid_request", "智能体版本无效");
		try {
			const agent = await getRemoteAgent(await context(), agentId, { version });
			return toRemoteVersion(agent, agentId, version) ? agent : null;
		} catch (error) {
			if (ApiError.isNotFound(error)) return null;
			if (error instanceof KitError) throw error;
			throw new KitError("provider_error", "智能体版本查询失败，请稍后重试", { retryable: true });
		}
	}
	return {
		async listRemoteAgentVersions(agentId) {
			validateAgentId(agentId);
			try {
				return await collectVersions(await context(), agentId);
			} catch (error) {
				if (error instanceof KitError) throw error;
				if (ApiError.isNotFound(error)) throw new KitError("not_found", "智能体不存在");
				throw new KitError("provider_error", "智能体版本列表查询失败，请稍后重试", { retryable: true });
			}
		},
		async getRemoteAgentVersion(agentId, version) {
			const agent = await readVersion(agentId, version);
			return agent ? { agent_id: agentId, name: agent.name || agentId, version } : null;
		},
		async getRemoteAgentVersionDetail(agentId, version) {
			const agent = await readVersion(agentId, version);
			return agent ? agentVersionDetail(await withAgentSkillDisplayMeta(agent, context), agentId, version) : null;
		},
	};
}
