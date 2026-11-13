import type { RemoteAgentVersionDetail } from "@openagentpack/kit-sdk/protocol";
import type { CloudAgent } from "@openagentpack/sdk";
import { projectMultiagentConfiguration, remoteAgentMultiagent } from "./agent-multiagent.ts";
import { redactRemoteDetailText as safeText } from "./remote-detail-redaction.ts";

const sensitive =
	/(?:api[_-]?key|access[_-]?key|private[_-]?key|auth|credential|headers?|cookie|password|secret|signature|token|^env(?:s|[_-]?vars|ironment)?$|environment[_-]?variables|^args$|^arguments$)/i;
const redacted = "[redacted]";

function object(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 只读视图从严隐藏凭据、请求头、环境变量和命令参数，不复用可编辑声明的凭据引用例外。 */
function sanitize(value: unknown, onRedacted: () => void, model = false): unknown {
	if (typeof value === "string") {
		const result = safeText(value);
		if (result !== value) onRedacted();
		return result;
	}
	if (Array.isArray(value)) return value.map((entry) => sanitize(entry, onRedacted, model));
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => {
				// 模型 Token 上限属于普通配置，保留数字、字符串及未设置的 null。
				const tokenLimit = model && /^max_?tokens$/i.test(key);
				if (sensitive.test(key) && !tokenLimit) {
					onRedacted();
					return [key, redacted];
				}
				return [key, sanitize(entry, onRedacted, model)];
			}),
		);
	return value;
}

/** SDK 暴露字段优先；历史 config 形状只回补明确允许的字段，绝不返回 attributes/metadata 整包。 */
export function agentVersionDetail(agent: CloudAgent, agentId: string, version: number): RemoteAgentVersionDetail {
	const config = object(agent.attributes?.config);
	const name = agent.name ?? config.name;
	const description = agent.description ?? config.description;
	const instructions = agent.system ?? config.system ?? config.instructions;
	const multiagent = remoteAgentMultiagent(agent);
	type RedactedField = NonNullable<RemoteAgentVersionDetail["redacted_fields"]>[number];
	const redactedFields = new Set<RedactedField>();
	const text = (field: RedactedField, value: string) => {
		const result = safeText(value);
		if (result !== value) redactedFields.add(field);
		return result;
	};
	const configuration = (field: RedactedField, value: unknown, model = false) =>
		sanitize(value, () => redactedFields.add(field), model);
	const detail: RemoteAgentVersionDetail = {
		agent_id: agentId,
		name: typeof name === "string" && name ? text("name", name) : agentId,
		version,
		...(typeof agent.created_at === "string" ? { created_at: agent.created_at } : {}),
		...(typeof description === "string" ? { description } : {}),
		configuration: {
			model: configuration("model", agent.model ?? config.model, true),
			// instructions 按用户要求作为正文原样返回，不参与展示脱敏或 URL 裁剪。
			...(typeof instructions === "string" ? { instructions } : {}),
			tools: configuration("tools", agent.tools ?? config.tools),
			skills: configuration("skills", agent.skills ?? config.skills),
			mcp_servers: configuration("mcp_servers", agent.mcp_servers ?? config.mcp_servers),
			...(multiagent !== undefined
				? { multiagent: configuration("multiagent", projectMultiagentConfiguration(multiagent)) }
				: {}),
		},
	};
	return { ...detail, ...(redactedFields.size ? { redacted_fields: [...redactedFields] } : {}) };
}
