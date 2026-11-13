import {
	configList,
	configObject,
	configText,
	versionMcpServers,
	versionToolkits,
} from "./agent-version-configuration.ts";
import { MANAGED_AGENT_MODELS } from "./managed-agent-models.ts";
import type { AgentFormDetail } from "./template-agent-form-draft.ts";

/** 创建预览与管理列表共用字段顺序及配置投影。 */
export const AGENT_CONFIGURATION_FIELDS = [
	{ key: "model", label: "模型" },
	{ key: "multiagent", label: "Multi-Agent 模式" },
	{ key: "description", label: "描述" },
	{ key: "instructions", label: "系统提示词" },
	{ key: "tools", label: "工具" },
	{ key: "mcp_servers", label: "MCP 服务器" },
	{ key: "skills", label: "技能" },
] as const;

export function agentConfigurationValues(detail?: AgentFormDetail) {
	const config = detail?.configuration ?? {};
	const fields = configObject(config.model);
	const provider = fields.bailian;
	const model = configText(
		fields.name ?? fields.id ?? configObject(provider).name ?? configObject(provider).id ?? provider ?? config.model,
	);
	const toolkits = versionToolkits(config.tools).filter((group) => group.kind !== "mcp");
	return {
		model: (MANAGED_AGENT_MODELS.find((option) => option.id === model)?.name ?? model) || "未选择",
		multiagent: configObject(config.multiagent).type === "coordinator" ? "已开启" : "未开启",
		description: detail?.description || "—",
		instructions: config.instructions || "—",
		tools: [
			...new Set(
				toolkits.flatMap((group) => group.tools.filter((tool) => tool.enabled !== false).map((tool) => tool.name)),
			),
		],
		mcp_servers: [...new Set(versionMcpServers(config.mcp_servers, config.tools).map((server) => server.name))],
		skills: [
			...new Set(
				configList(config.skills).flatMap((value) => {
					const skill = configObject(value);
					const name = configText(
						skill.name ?? skill.skill_name ?? skill.skillName ?? skill.skill_id ?? skill.id ?? value,
					);
					return name ? [name] : [];
				}),
			),
		],
	};
}

export type AgentConfigurationKey = (typeof AGENT_CONFIGURATION_FIELDS)[number]["key"];

export function agentConfigurationText(detail: AgentFormDetail, key: AgentConfigurationKey) {
	const value = agentConfigurationValues(detail)[key];
	return Array.isArray(value) ? value.join("\n") || (key === "skills" ? "未选择" : "未配置") : value;
}
