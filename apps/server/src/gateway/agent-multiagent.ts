function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** SDK CloudAgent 将原始 multiagent 放在 attributes；显式 null 优先于旧 config。 */
export function remoteAgentMultiagent(value: unknown): unknown {
	const agent = record(value);
	const attributes = record(agent.attributes);
	if (Object.hasOwn(agent, "multiagent")) return agent.multiagent;
	if (Object.hasOwn(attributes, "multiagent")) return attributes.multiagent;
	return record(attributes.config).multiagent;
}

/** 无损转换 Provider 身份引用及 Self 空占位；实际身份、固定版本及扩展字段仍由表单校验。 */
export function projectMultiagentConfiguration(value: unknown): unknown {
	if (value == null) return value;
	const roster = record(value);
	if (!Array.isArray(roster.agents)) return value;
	return {
		...roster,
		agents: roster.agents.map((member: unknown) => {
			if (typeof member === "string") return { agent_id: member };
			const entry = record(member);
			if (entry.type === "self") {
				const self = { ...entry };
				if (self.id === null) delete self.id;
				if (self.version === null) delete self.version;
				return self;
			}
			if (
				entry.type === "agent" &&
				typeof entry.id === "string" &&
				Object.keys(entry).every((key) => ["type", "id"].includes(key))
			)
				return { agent_id: entry.id };
			return member;
		}),
	};
}

export function isRemoteCoordinator(value: unknown): boolean {
	const multiagent = remoteAgentMultiagent(value);
	if (multiagent == null) return false;
	const agents = record(multiagent).agents;
	return !Array.isArray(agents) || agents.length > 0;
}
