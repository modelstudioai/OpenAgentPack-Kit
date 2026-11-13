import { ProjectAgentCreateInputSchema, ProjectAgentMcpNameSchema } from "@openagentpack/kit-sdk/protocol";

function mcpDefinition(value: unknown) {
	if (!value || typeof value !== "object") return;
	const entry = value as Record<string, unknown>;
	const parsed = ProjectAgentMcpNameSchema.safeParse(entry.name);
	if (!parsed.success || parsed.data !== entry.name) return;
	return {
		name: parsed.data,
		signature: JSON.stringify(
			Object.entries(entry)
				.filter(([, item]) => item !== undefined)
				.sort(([a], [b]) => a.localeCompare(b)),
		),
		eligible:
			entry.type === "official" &&
			Object.keys(entry).every((key) => key === "name" || key === "type" || entry[key] === undefined),
	};
}

/** 同名异配置一律排除；不复制 URL、请求头或凭据到新 Agent。 */
export function projectMcpCandidates(agents: readonly { mcp_servers?: unknown }[]) {
	const definitions = new Map<string, Set<string>>();
	const eligible = new Set<string>();
	for (const value of agents.flatMap((agent) => (Array.isArray(agent.mcp_servers) ? agent.mcp_servers : []))) {
		const entry = mcpDefinition(value);
		if (!entry) continue;
		const variants = definitions.get(entry.name) ?? new Set<string>();
		variants.add(entry.signature);
		definitions.set(entry.name, variants);
		if (entry.eligible) eligible.add(entry.name);
	}
	return [...eligible].filter((name) => definitions.get(name)?.size === 1).sort();
}

export function agentSkillOption(id: string, value: { name?: unknown; description?: unknown }) {
	const name = ProjectAgentCreateInputSchema.shape.name.safeParse(value.name);
	const description = ProjectAgentCreateInputSchema.shape.description.safeParse(value.description);
	return {
		id,
		name: name.success ? name.data : id,
		...(description.success && description.data ? { description: description.data } : {}),
	};
}
