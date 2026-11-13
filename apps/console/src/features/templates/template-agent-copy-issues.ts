export type AgentCopyIssue = { field: string; reason: string };
type ValidationIssue = { path: PropertyKey[]; code: string };

export class AgentCopyError extends Error {
	constructor(readonly issues: AgentCopyIssue[]) {
		super("无法完整复制配置");
	}
}

export function rejectAgentCopy(field: string, reason: string): never {
	throw new AgentCopyError([{ field, reason }]);
}

// 路径仅保留已知 Schema 字段和数组下标，不回显动态键或校验错误中的配置值。
const fieldNames = new Set([
	"builtin",
	"default_permission",
	"permissions",
	"mcp",
	"type",
	"mcp_server_name",
	"default_config",
	"configs",
	"name",
	"enabled",
	"skill_id",
	"version",
	"model",
	"id",
	"bailian",
	"instructions",
	"description",
	"tools",
	"skills",
	"mcp_servers",
	"url",
	"server_url",
	"headers",
	"authorization",
	"api_key",
	"token",
	"password",
	"secret",
	"credentials",
	"permission_policy",
	"permissionPolicy",
	"permission",
	"require_approval",
	"requireApproval",
	"defaultConfig",
	"multiagent",
	"agents",
	"agent_id",
]);
export function copyFieldPath(base: string, path: PropertyKey[]) {
	return path.reduce<string>((current, key) => {
		if (typeof key === "number") return `${current}[${key}]`;
		return `${current}.${fieldNames.has(String(key)) ? String(key) : "[字段]"}`;
	}, base);
}

function validationReason(issue: ValidationIssue) {
	if (issue.path.at(-1) === "version") return "Skill 版本缺失或格式无效，需要明确的固定版本。";
	switch (issue.code) {
		case "invalid_type":
			return "字段缺失或数据类型不符合创建要求。";
		case "too_small":
			return "字段为空或内容长度不足。";
		case "too_big":
			return "字段长度或配置数量超过创建上限。";
		case "invalid_value":
			return "字段取值不在当前支持的范围内。";
		case "unrecognized_keys":
			return "包含当前创建流程不支持的配置字段。";
		default:
			return "字段格式或引用不符合当前创建要求。";
	}
}

export function parseAgentCopy<T>(
	result: { success: true; data: T } | { success: false; error: { issues: ValidationIssue[] } },
	base: string,
): T {
	if (result.success) return result.data;
	throw new AgentCopyError(
		result.error.issues.map((issue) => ({
			field: copyFieldPath(base, issue.path),
			reason: validationReason(issue),
		})),
	);
}

export function copyBuiltinPermission(entry: Record<string, unknown>, path: string): "allow" | "ask" | undefined {
	const key = ["permission_policy", "permissionPolicy", "permission", "require_approval", "requireApproval"].find(
		(key) => entry[key] != null,
	);
	if (!key) return;
	const value = entry[key];
	const object = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	const policy = object.type ?? value;
	if (["allow", "always_allow", "never"].includes(String(policy))) return "allow";
	if (["ask", "always_ask", "always"].includes(String(policy))) return "ask";
	rejectAgentCopy(`${path}.${key}${object.type == null ? "" : ".type"}`, "当前 SDK 无法原样复制此工具审批或权限策略。");
}

export function checkCopyPolicy(entry: Record<string, unknown>, path: string) {
	if (copyBuiltinPermission(entry, path) !== "ask") return;
	const key = ["permission_policy", "permissionPolicy", "permission", "require_approval", "requireApproval"].find(
		(key) => entry[key] != null,
	)!;
	const value = entry[key];
	const hasType = value && typeof value === "object" && "type" in value;
	rejectAgentCopy(`${path}.${key}${hasType ? ".type" : ""}`, "当前 SDK 无法原样复制此 MCP 工具审批或权限策略。");
}

/** 只报告隐藏值的位置；字段标识以外的自由文本键不回显。 */
export function redactedCopyIssues(value: unknown, path = ""): AgentCopyIssue[] {
	if (typeof value === "string")
		return value.includes("[redacted]") ? [{ field: path, reason: "字段已脱敏，无法获取完整原值来创建副本。" }] : [];
	if (Array.isArray(value)) return value.flatMap((entry, index) => redactedCopyIssues(entry, `${path}[${index}]`));
	if (!value || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, entry]) =>
		redactedCopyIssues(entry, `${path ? `${path}.` : ""}${/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) ? key : "[字段]"}`),
	);
}

export function copyFieldLabel(field: string) {
	if (field.startsWith("multiagent")) return "Multi-Agent 模式";
	if (field.startsWith("tools")) return "工具";
	if (field.startsWith("skills")) return "技能";
	if (field.startsWith("mcp_servers")) return "MCP 服务器";
	if (field.startsWith("instructions")) return "系统提示词";
	if (field.startsWith("model")) return "模型";
	return "基础配置";
}
