/** 历史快照的只读展示适配：兼容 Provider 工具集与 Kit 声明形状，不修改保存配置。 */
export function configObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function configText(value: unknown): string | undefined {
	if (value === "[redacted]") return "已隐藏";
	return typeof value === "string" && value.trim() ? value : typeof value === "number" ? String(value) : undefined;
}

export function configList(value: unknown): unknown[] {
	return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

export function permissionLabel(value: unknown, fallback = "总是允许"): string {
	const policy = configText(configObject(value).type ?? value);
	if (!policy) return fallback;
	if (["allow", "always_allow", "never"].includes(policy)) return "总是允许";
	if (["ask", "always_ask", "always"].includes(policy)) return "每次询问";
	if (["deny", "never_allow"].includes(policy)) return "禁止调用";
	return policy === "已隐藏" ? policy : "未识别的策略";
}

function policyOf(value: Record<string, unknown>): unknown {
	return value.permission_policy ?? value.permissionPolicy ?? value.permission;
}

export interface VersionTool {
	name: string;
	description?: string;
	enabled?: boolean;
	permission: string;
	inheritedEnabled: boolean;
	inheritedPermission: boolean;
}

export interface VersionToolkit {
	id: string;
	title: string;
	kind: "builtin" | "mcp" | "other";
	serverId?: string;
	defaultEnabled?: boolean;
	defaultPermission: string;
	tools: VersionTool[];
}

function toolkit(value: unknown, id: string, fallbackPolicy?: unknown): VersionToolkit {
	const item = configObject(value);
	const defaults = configObject(item.default_config ?? item.defaultConfig);
	const serverId = configText(item.mcp_server_name ?? item.mcpServerName);
	const kind = item.type === "builtin_toolkit" ? "builtin" : item.type === "mcp_toolkit" ? "mcp" : "other";
	const defaultEnabled = typeof defaults.enabled === "boolean" ? defaults.enabled : undefined;
	const defaultPermission = permissionLabel(policyOf(defaults) ?? fallbackPolicy);
	const tools = new Map<string, VersionTool>();
	for (const entry of configList(item.configs)) {
		const tool = configObject(entry);
		const name = configText(tool.name ?? entry);
		if (!name) continue;
		tools.set(name, {
			name,
			description: configText(tool.description),
			enabled: typeof tool.enabled === "boolean" ? tool.enabled : defaultEnabled,
			permission: permissionLabel(policyOf(tool), defaultPermission),
			inheritedEnabled: typeof tool.enabled !== "boolean",
			inheritedPermission: policyOf(tool) == null,
		});
	}
	return {
		id,
		kind,
		serverId,
		title: kind === "builtin" ? "内置工具" : (serverId ?? configText(item.name) ?? "工具集"),
		defaultEnabled,
		defaultPermission,
		tools: [...tools.values()],
	};
}

function canonicalToolName(name: string) {
	const key = name.replace(/[-_]/g, "").toLowerCase();
	return (
		({ readfile: "read", writefile: "write", editfile: "edit", executebash: "bash" } as Record<string, string>)[key] ??
		key
	);
}

export function versionToolkits(value: unknown): VersionToolkit[] {
	if (Array.isArray(value)) return value.map((item, index) => toolkit(item, `toolkit:${index}`));
	const declared = configObject(value);
	const groups: VersionToolkit[] = [];
	if (Array.isArray(declared.builtin)) {
		const permissions = configObject(declared.permissions);
		const defaultPermission = permissionLabel(declared.default_permission);
		const names = [...new Set(declared.builtin.map(configText).filter((name): name is string => !!name))];
		groups.push({
			id: "builtin",
			kind: "builtin",
			title: "内置工具",
			defaultEnabled: false,
			defaultPermission,
			tools: names.map((name) => {
				const override = Object.entries(permissions).find(
					([key]) => canonicalToolName(key) === canonicalToolName(name),
				);
				return {
					name,
					enabled: true,
					permission: permissionLabel(override?.[1], defaultPermission),
					inheritedEnabled: false,
					inheritedPermission: !override,
				};
			}),
		});
	}
	for (const [index, entry] of configList(declared.mcp).entries()) groups.push(toolkit(entry, `mcp:${index}`));
	if (!groups.length && Object.keys(declared).length) groups.push(toolkit(declared, "toolkit"));
	return groups;
}

export interface VersionMcpServer {
	id: string;
	name: string;
	code?: string;
	type?: string;
	url?: string;
	protocol?: string;
	description?: string;
	toolkit?: VersionToolkit;
}

export function versionMcpServers(value: unknown, tools: unknown): VersionMcpServer[] {
	const groups = versionToolkits(tools).filter((item) => item.kind === "mcp");
	const used = new Set<string>();
	const servers = configList(value).map((entry, index) => {
		const item = configObject(entry);
		const code = configText(item.server_code ?? item.serverCode ?? item.name ?? entry);
		const name = configText(item.server_name ?? item.serverName) ?? code ?? "MCP 服务";
		const group = groups.find((group) => group.serverId === code);
		if (group) used.add(group.id);
		const serverPolicy = policyOf(item) ?? item.require_approval ?? item.requireApproval;
		// server 级权限兼容旧快照；单工具覆盖仍优先。
		const rawToolkit = Array.isArray(tools) ? tools : configList(configObject(tools).mcp);
		const rawGroup = rawToolkit.find((entry) => {
			const record = configObject(entry);
			return (record.mcp_server_name ?? record.mcpServerName) === code;
		});
		return {
			id: `${code ?? "server"}:${index}`,
			name,
			code,
			type: configText(item.type),
			url: configText(item.server_url ?? item.serverUrl ?? item.url),
			protocol: configText(item.server_protocol ?? item.serverProtocol ?? item.transport),
			description: configText(item.description),
			toolkit: group ? toolkit(rawGroup, group.id, serverPolicy) : undefined,
		};
	});
	for (const group of groups) {
		if (!used.has(group.id))
			servers.push({
				id: group.id,
				name: group.title,
				code: group.serverId,
				toolkit: group,
				type: undefined,
				url: undefined,
				protocol: undefined,
				description: undefined,
			});
	}
	return servers;
}
