import { KitError, type SessionStats, type SessionUsage } from "@openagentpack/kit-sdk/protocol";

function object(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** 缺失与真实零分开；错误数值不能被静默变成零或可用于删除的快照。 */
function metric(source: Record<string, unknown>, snake: string, camel: string, integer: boolean) {
	const value = source[snake] ?? source[camel];
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value)))
		throw new KitError("provider_error", "会话用量数据无效，请稍后重试");
	return value;
}

function metrics<T extends object>(value: unknown, fields: readonly (readonly [string, string])[], integer: boolean) {
	if (value === undefined || value === null) return undefined;
	const source = object(value);
	if (!source) throw new KitError("provider_error", "会话用量数据无效，请稍后重试");
	const entries = fields.flatMap(([snake, camel]) => {
		const count = metric(source, snake, camel, integer);
		return count === undefined ? [] : [[snake, count]];
	});
	return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}

/** 只提取数值与停止原因类型，不透传 attributes 中的环境变量、凭据或任意 Provider 字段。 */
export function sessionUsageFromAttributes(attributes: unknown): {
	usage?: SessionUsage;
	stats?: SessionStats;
	stop_reason?: { type: string };
} {
	const source = object(attributes) ?? {};
	const usage = metrics<SessionUsage>(
		source.usage,
		[
			["input_tokens", "inputTokens"],
			["output_tokens", "outputTokens"],
			["cache_read_input_tokens", "cacheReadInputTokens"],
			["cache_creation_input_tokens", "cacheCreationInputTokens"],
		],
		true,
	);
	const stats = metrics<SessionStats>(
		source.stats,
		[
			["active_seconds", "activeSeconds"],
			["duration_seconds", "durationSeconds"],
		],
		false,
	);
	const reason = object(source.stop_reason ?? source.stopReason)?.type;
	return {
		...(usage ? { usage } : {}),
		...(stats ? { stats } : {}),
		...(typeof reason === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(reason) ? { stop_reason: { type: reason } } : {}),
	};
}
