import type { RemoteAgentVersionDetail } from "@openagentpack/kit-sdk/protocol";
import { useMemo } from "react";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import { configText } from "./agent-version-configuration.ts";
import type { TemplateAgentSelection } from "./template-local-resources.tsx";

export type AgentDetail = Pick<
	RemoteAgentVersionDetail,
	"name" | "description" | "configuration" | "created_at" | "redacted_fields"
> & {
	version?: number;
};

export async function loadTemplateAgentDetail(
	client: ReturnType<typeof getAdminClient>,
	agent: TemplateAgentSelection,
	version: number | undefined,
	signal: AbortSignal,
): Promise<AgentDetail> {
	if (!agent.local) {
		let target = version;
		if (target === undefined) {
			const versions = await client.remoteAgentVersions(agent.agent_id, signal);
			target = versions
				.map((item) => item.version)
				.filter((value) => Number.isInteger(value) && value > 0)
				.sort((a, b) => b - a)[0];
		}
		if (target === undefined) throw new Error("暂无可查看版本");
		return client.remoteAgentVersion(agent.agent_id, target, signal);
	}
	const source = await client.draftResources.declaration(agent.local.projectName, "agent", agent.local.id, signal);
	const config = source.declaration;
	return {
		name: configText(config.name) ?? agent.name ?? agent.local.id,
		description: typeof config.description === "string" ? config.description : undefined,
		configuration: {
			model: config.model,
			instructions: typeof config.instructions === "string" ? config.instructions : undefined,
			tools: config.tools,
			mcp_servers: config.mcp_servers,
			skills: config.skills,
			multiagent: config.multiagent,
		},
	};
}

/** 未绑定版本的旧模版只读取最新配置，查询结果不回写运行绑定。 */
export function useTemplateAgentDetail(agent: TemplateAgentSelection | null, version?: number, revision = 0) {
	const client = useMemo(getAdminClient, []);
	return useAdminQuery<AgentDetail>(
		`templates:agent-detail:${agent?.agent_id}:${version}:${revision}`,
		(signal) => {
			if (!agent) throw new Error("请选择智能体");
			return loadTemplateAgentDetail(client, agent, version, signal);
		},
		{ enabled: Boolean(agent) },
	);
}
