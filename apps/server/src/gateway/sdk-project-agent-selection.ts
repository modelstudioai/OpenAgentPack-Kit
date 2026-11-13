import { KitError, type ProjectAgentCreateInput } from "@openagentpack/kit-sdk/protocol";
import { buildAgentDecl } from "@openagentpack/sdk";

type AgentSelection = {
	agent: ReturnType<typeof buildAgentDecl>["agent"];
	metadata: Record<string, unknown> & { name: string; model: string };
};

/** 仅接收无凭据的配置与引用；SDK 生成 MCP 规则，再合并显式的工具启用范围。 */
export function buildProjectAgentSelection(
	input: ProjectAgentCreateInput,
	options: { localSkills: ReadonlySet<string>; mcpNames: readonly string[] },
): AgentSelection {
	const { name, model, description, skills = [], mcp_servers = [] } = input;
	if (skills.some((skill) => typeof skill === "string" && !options.localSkills.has(skill)))
		throw new KitError("invalid_request", "所选项目 Skill 不存在或不属于共享范围，请重新选择");
	const declaredMcp = new Set(input.mcp_configurations?.map((entry) => entry.name));
	if (mcp_servers.some((name) => !options.mcpNames.includes(name) && !declaredMcp.has(name)))
		throw new KitError("invalid_request", "MCP 服务缺少官方服务声明或不支持复用，请检查配置");
	const { agent } = buildAgentDecl(undefined, {
		name,
		model,
		description,
		instructions: "",
		mcp: mcp_servers.map((serverName) => ({ serverName, serverType: "official", defaultEnabled: true })),
	});
	// SDK builder 的 custom 是新建本地 Skill；这里是已验证引用，直接保留 SDK AgentDecl 契约。
	agent.skills = skills;
	if (input.multiagent) agent.multiagent = input.multiagent;
	if (input.tools) {
		const overrides = new Map(input.tools.mcp?.map((entry) => [entry.mcp_server_name, entry]));
		agent.tools = {
			...input.tools,
			mcp: agent.tools!.mcp?.map((entry) => overrides.get(entry.mcp_server_name) ?? entry),
		};
	}
	return {
		agent,
		metadata: {
			name,
			model,
			...(description ? { description } : {}),
			...(skills.length ? { skills } : {}),
			...(input.multiagent ? { multiagent: input.multiagent } : {}),
			...(mcp_servers.length ? { mcp_servers: agent.mcp_servers } : {}),
			...(mcp_servers.length || input.tools ? { tools: agent.tools } : {}),
		},
	};
}
