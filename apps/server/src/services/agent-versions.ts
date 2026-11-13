import { KitError } from "@openagentpack/kit-sdk/protocol";
import type { ProviderGateway } from "../gateway/types.ts";

/** 显式绑定必须存在且精确匹配，不能把已失效的历史版本静默降级为最新版。 */
export async function requireAgentVersion(gateway: ProviderGateway, agentId: string, version: number) {
	const agent = await gateway.getRemoteAgentVersion(agentId, version);
	if (!agent) throw new KitError("invalid_request", "所选智能体版本不存在或已不可用，请返回第一步重新选择");
	return agent;
}

/** 管理员查看历史配置使用只读详情，不把不可用版本降级为最新版。 */
export async function readAgentVersionDetail(gateway: ProviderGateway, agentId: string, version: number) {
	const detail = await gateway.getRemoteAgentVersionDetail(agentId, version);
	if (!detail) throw new KitError("not_found", "智能体版本不存在或已不可用");
	return detail;
}
