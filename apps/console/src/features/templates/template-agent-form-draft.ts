import {
	type ProjectAgentCreateInput,
	ProjectAgentCreateInputSchema,
	ProjectAgentMultiagentSchema,
	type RemoteAgentVersionDetail,
	RemoteSkillReferenceSchema,
} from "@openagentpack/kit-sdk/protocol";
import { configObject } from "./agent-version-configuration.ts";
import type { AgentCapabilities } from "./template-agent-capability-picker.tsx";
import {
	AgentCopyError,
	type AgentCopyIssue,
	checkCopyPolicy,
	copyBuiltinPermission,
	parseAgentCopy,
	redactedCopyIssues,
	rejectAgentCopy,
} from "./template-agent-copy-issues.ts";
import { type AgentMcpDraft, createMcpDraft, mcpDraftFingerprint, mcpToolkit } from "./template-agent-mcp-draft.ts";

export const BUILTIN_TOOLS = [
	"bash",
	"read",
	"write",
	"edit",
	"glob",
	"grep",
	"web_search",
	"web_fetch",
	"mark_artifacts",
] as const;
export type AgentFormDraft = {
	name: string;
	description: string;
	model: string;
	instructions: string;
	capabilities: AgentCapabilities;
	tools?: ProjectAgentCreateInput["tools"];
	mcpServers: AgentMcpDraft[];
	multiAgentEnabled: boolean;
	subAgents: NonNullable<ProjectAgentCreateInput["multiagent"]>["agents"];
};
export type AgentFormDetail = Pick<
	RemoteAgentVersionDetail,
	"name" | "description" | "configuration" | "redacted_fields"
>;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const list = (value: unknown): unknown[] => (value == null ? [] : Array.isArray(value) ? value : [value]);

/** 比较实际可编辑配置，忽略选择顺序和 Skill 展示名称；改回原值仍沿用原 Agent。 */
export function agentFormDraftChanged(initial: AgentFormDraft, draft: AgentFormDraft) {
	const comparable = (value: AgentFormDraft) =>
		JSON.stringify({
			name: value.name.trim(),
			description: value.description.trim(),
			model: value.model.trim(),
			instructions: value.instructions,
			builtin: [...(value.tools?.builtin ?? BUILTIN_TOOLS)].sort(),
			default_permission: value.tools?.default_permission ?? "allow",
			permissions: Object.entries(value.tools?.permissions ?? {}).sort(([first], [second]) =>
				first.localeCompare(second),
			),
			skills: value.capabilities.skills.map((skill) => JSON.stringify(skill.reference)).sort(),
			mcp: value.mcpServers.map(mcpDraftFingerprint).sort(),
			multiagent: value.multiAgentEnabled ? value.subAgents : null,
		});
	return comparable(initial) !== comparable(draft);
}

function builtinNames(configs: Record<string, unknown>[], defaultEnabled: boolean, path: string) {
	const names = new Set<string>(defaultEnabled ? BUILTIN_TOOLS : []);
	for (const [index, tool] of configs.entries()) {
		const name = text(tool.name);
		if (!name) rejectAgentCopy(`${path}.configs[${index}].name`, "工具名称缺失，无法复制此工具。");
		parseAgentCopy(
			ProjectAgentCreateInputSchema.shape.tools.unwrap().shape.builtin.element.safeParse(name),
			`${path}.configs[${index}].name`,
		);
		if (tool.enabled === false) names.delete(name);
		else if (tool.enabled === true || defaultEnabled) names.add(name);
	}
	return [...names];
}

function builtinConfiguration(
	group: Record<string, unknown>,
	defaults: Record<string, unknown>,
	configs: Record<string, unknown>[],
	path: string,
	defaultsPath: string,
) {
	const fallback = copyBuiltinPermission(group, path);
	const defaultPermission = copyBuiltinPermission(defaults, defaultsPath) ?? fallback;
	const permissions = Object.fromEntries(
		configs.flatMap((tool, index) => {
			const permission = copyBuiltinPermission(tool, `${path}.configs[${index}]`);
			return permission ? [[text(tool.name), permission]] : [];
		}),
	);
	return {
		builtin: builtinNames(configs, defaults.enabled === true, path),
		...(defaultPermission ? { default_permission: defaultPermission } : {}),
		...(Object.keys(permissions).length ? { permissions } : {}),
	};
}

function toolsFromConfiguration(value: unknown): ProjectAgentCreateInput["tools"] {
	if (value == null) return undefined;
	if (!Array.isArray(value)) return parseAgentCopy(ProjectAgentCreateInputSchema.shape.tools.safeParse(value), "tools");
	const result: NonNullable<ProjectAgentCreateInput["tools"]> = { builtin: [], mcp: [] };
	for (const [index, raw] of value.entries()) {
		const path = `tools[${index}]`;
		const group = configObject(raw);
		const defaults = configObject(group.default_config ?? group.defaultConfig);
		const defaultsPath = `${path}.${group.default_config == null && group.defaultConfig != null ? "defaultConfig" : "default_config"}`;
		const configs = list(group.configs).map(configObject);
		if (group.type === "builtin_toolkit") {
			Object.assign(result, builtinConfiguration(group, defaults, configs, path, defaultsPath));
			continue;
		}
		if (group.type === "mcp_toolkit") {
			result.mcp!.push(
				parseAgentCopy(
					ProjectAgentCreateInputSchema.shape.tools
						.unwrap()
						.shape.mcp.unwrap()
						.element.safeParse({
							type: "mcp_toolkit",
							mcp_server_name: text(group.mcp_server_name ?? group.mcpServerName),
							default_config: { enabled: defaults.enabled === true },
							configs: configs.map((tool) => ({
								name: text(tool.name),
								enabled: tool.enabled === undefined ? defaults.enabled === true : tool.enabled === true,
							})),
						}),
					path,
				),
			);
		} else rejectAgentCopy(`${path}.type`, "当前创建流程不支持此工具类型。");
		// MCP 声明目前只支持启用范围，不能丢弃独立的审批策略。
		checkCopyPolicy(group, path);
		checkCopyPolicy(defaults, defaultsPath);
		configs.forEach((tool, index) => {
			checkCopyPolicy(tool, `${path}.configs[${index}]`);
		});
	}
	return parseAgentCopy(ProjectAgentCreateInputSchema.shape.tools.safeParse(result), "tools");
}

function mcpFromConfiguration(raw: unknown, path: string) {
	const entry = configObject(raw);
	checkCopyPolicy(entry, path);
	let unsupportedField: string | undefined;
	if (entry.url) unsupportedField = "url";
	else if (entry.server_url) unsupportedField = "server_url";
	else if (entry.type && entry.type !== "official") unsupportedField = "type";
	if (unsupportedField)
		rejectAgentCopy(`${path}.${unsupportedField}`, "当前 SDK 创建流程仅支持官方 MCP，无法原样复制此服务。");
	return { name: text(entry.name ?? entry.server_code ?? raw), type: "official" as const };
}

/** 把已选版本转成可编辑草稿；不支持或脱敏的字段阻止复制，原版本仍可直接使用。 */
export function createAgentFormDraft(
	detail?: AgentFormDetail,
	skillNames: Record<string, string> = {},
): { draft: AgentFormDraft; error?: string; issues: AgentCopyIssue[] } {
	const config = detail?.configuration ?? {};
	const model = configObject(config.model);
	const providerModel = model.bailian;
	const draft: AgentFormDraft = {
		name: detail?.name ?? "",
		description: detail?.description ?? "",
		model:
			text(config.model) || text(model.id ?? model.name) || text(providerModel) || text(configObject(providerModel).id),
		instructions: config.instructions ?? "",
		capabilities: { skills: [] },
		mcpServers: [],
		multiAgentEnabled: false,
		subAgents: [],
	};
	// 描述和 instructions 是原文；占位符可能就是正文，是否受损以服务端标记为准。
	const { instructions: _instructions, ...structuredConfiguration } = config;
	const issues = [
		...redactedCopyIssues(structuredConfiguration),
		...redactedCopyIssues({ name: detail?.name }),
		...(detail?.redacted_fields ?? []).map((field) => ({
			field,
			reason: "字段已脱敏，无法获取完整原值来创建副本。",
		})),
	];
	const collect = <T>(field: string, read: () => T): T | undefined => {
		try {
			return read();
		} catch (error) {
			issues.push(
				...(error instanceof AgentCopyError
					? error.issues
					: [{ field, reason: "配置解析失败，无法转换成可编辑字段。" }]),
			);
			return undefined;
		}
	};
	if (config.multiagent != null) {
		const roster = configObject(config.multiagent);
		// Provider 以空名册表示关闭；其他额外字段仍必须经严格 Schema 检查。
		if (
			!(
				roster.type === "coordinator" &&
				Array.isArray(roster.agents) &&
				roster.agents.length === 0 &&
				Object.keys(roster).every((key) => ["type", "agents"].includes(key))
			)
		) {
			const multiagent = collect("multiagent", () => {
				if (
					Array.isArray(roster.agents) &&
					roster.agents.some((member) => {
						const entry = configObject(member);
						return entry.version != null;
					})
				)
					rejectAgentCopy("multiagent.agents", "当前 SDK 不支持子 Agent 固定版本，无法完整另存此配置。");
				return parseAgentCopy(ProjectAgentMultiagentSchema.safeParse(config.multiagent), "multiagent");
			});
			if (multiagent) {
				draft.multiAgentEnabled = true;
				draft.subAgents = multiagent.agents;
			}
		}
	}
	draft.tools = collect("tools", () => toolsFromConfiguration(config.tools));
	draft.capabilities.skills = list(config.skills).flatMap((raw, index) => {
		const entry = collect(`skills[${index}]`, () => {
			if (typeof raw === "string")
				return { key: `project:${raw}`, name: skillNames[`project:${raw}`] ?? raw, reference: raw };
			const skill = configObject(raw);
			const type = skill.type === "customer" ? "custom" : skill.type;
			const reference = parseAgentCopy(
				RemoteSkillReferenceSchema.safeParse({
					type,
					skill_id: skill.skill_id,
					version: skill.version,
				}),
				`skills[${index}]`,
			);
			return {
				key: `${type}:${skill.skill_id}`,
				name: text(skill.name ?? skill.skill_name ?? skillNames[`${type}:${skill.skill_id}`] ?? skill.skill_id),
				reference,
			};
		});
		return entry ? [entry] : [];
	});
	draft.mcpServers = list(config.mcp_servers).flatMap((raw, index) => {
		const path = `mcp_servers[${index}]`;
		const configuration = collect(path, () => mcpFromConfiguration(raw, path));
		return configuration
			? [
					createMcpDraft(
						configuration.name,
						draft.tools?.mcp?.find((entry) => entry.mcp_server_name === configuration.name),
					),
				]
			: [];
	});
	const uniqueIssues = [...new Map(issues.map((issue) => [`${issue.field}:${issue.reason}`, issue])).values()];
	return {
		draft,
		issues: uniqueIssues,
		...(issues.length ? { error: "此版本暂时无法编辑另存，以下配置无法完整复制：" } : {}),
	};
}

function enabledToolConfiguration(tools: NonNullable<ProjectAgentCreateInput["tools"]>) {
	const canonical = (name: string) =>
		name
			.trim()
			.replace(/[^a-zA-Z0-9]+/g, "")
			.toLowerCase();
	const enabled = new Set(tools.builtin.map(canonical));
	const permissions = Object.fromEntries(
		Object.entries(tools.permissions ?? {}).filter(([name]) => enabled.has(canonical(name))),
	);
	const { permissions: _permissions, ...configuration } = tools;
	return { ...configuration, ...(Object.keys(permissions).length ? { permissions } : {}) };
}

export function agentFormInput(draft: AgentFormDraft, revision: string) {
	const names = draft.mcpServers.map((server) => server.name.trim());
	const tools = draft.tools ? enabledToolConfiguration(draft.tools) : undefined;
	return {
		base_revision: revision,
		name: draft.name,
		model: draft.model,
		...(draft.multiAgentEnabled ? { multiagent: { type: "coordinator" as const, agents: draft.subAgents } } : {}),
		...(draft.description.trim() ? { description: draft.description } : {}),
		...(draft.instructions ? { instructions: draft.instructions } : {}),
		...(draft.capabilities.skills.length ? { skills: draft.capabilities.skills.map((skill) => skill.reference) } : {}),
		...(names.length ? { mcp_servers: names } : {}),
		...(tools || names.length
			? { tools: { ...(tools ?? { builtin: [...BUILTIN_TOOLS] }), mcp: draft.mcpServers.map(mcpToolkit) } }
			: {}),
		...(names.length ? { mcp_configurations: names.map((name) => ({ name, type: "official" as const })) } : {}),
	};
}

/** 摘要只读当前表单，包含未保存/校验未通过的输入，不额外查询资源。 */
export function agentFormPreview(draft: AgentFormDraft): AgentFormDetail {
	const input = agentFormInput(draft, "preview");
	return {
		name: draft.name,
		description: draft.description,
		configuration: {
			model: draft.model,
			instructions: draft.instructions,
			tools: input.tools ?? { builtin: [...BUILTIN_TOOLS] },
			mcp_servers: input.mcp_servers,
			skills: draft.capabilities.skills.map((skill) => ({ name: skill.name, skill_id: skill.key })),
			multiagent: input.multiagent,
		},
	};
}

/** 本批次尚未发布的 Agent 原位更新声明，避免重复生成会随批次发布的无用 Agent。 */
export function agentFormDeclaration(input: ProjectAgentCreateInput, original: Record<string, unknown>) {
	const names = input.mcp_servers ?? [];
	const inherited = new Map(input.tools?.mcp?.map((entry) => [entry.mcp_server_name, entry]));
	const tools =
		input.tools || names.length
			? {
					...(input.tools ?? { builtin: [] }),
					mcp: names.map(
						(name) =>
							inherited.get(name) ?? {
								type: "mcp_toolkit",
								mcp_server_name: name,
								default_config: { enabled: true },
								configs: [],
							},
					),
				}
			: undefined;
	const {
		description: _,
		tools: _tools,
		mcp_servers: _mcp,
		skills: _skills,
		multiagent: _multiagent,
		...rest
	} = original;
	return {
		...rest,
		name: input.name,
		model: input.model,
		instructions: input.instructions ?? "",
		...(input.description ? { description: input.description } : {}),
		...(tools ? { tools } : {}),
		...(names.length ? { mcp_servers: names.map((name) => ({ name, type: "official" })) } : {}),
		...(input.skills?.length ? { skills: input.skills } : {}),
		...(input.multiagent ? { multiagent: input.multiagent } : {}),
	};
}
