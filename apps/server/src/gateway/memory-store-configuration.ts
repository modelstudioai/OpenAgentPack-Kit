import {
	KitError,
	type MemoryEntry,
	type MemoryStoreConfiguration,
	MemoryStoreConfigurationSchema,
	redactMemoryConfigurationText,
} from "@openagentpack/kit-sdk/protocol";

/** 正文只用于管理员显式导入；敏感投影明确标记不可复制，不落库或写日志。 */
export function memoryStoreConfiguration(
	id: string,
	name: string,
	description: string,
	entries: MemoryEntry[],
): MemoryStoreConfiguration {
	const restricted = new Set<string>();
	function text(value: string, field: string) {
		const safe = redactMemoryConfigurationText(value);
		if (safe !== value) restricted.add(field);
		return safe;
	}
	const value = {
		memory_store_id: id,
		name: text(name, "名称"),
		description: text(description, "描述"),
		entries: entries.map((entry, index) => ({
			key: text(entry.key, `条目 ${index + 1} 的路径`),
			content: text(entry.content, `条目 ${index + 1} 的正文`),
		})),
		copy_restricted_fields: [...restricted],
	};
	const parsed = MemoryStoreConfigurationSchema.safeParse(value);
	if (!parsed.success)
		throw new KitError("provider_error", "记忆库条目超出可编辑范围或格式无效，无法完整导入；可继续复用原库。");
	return parsed.data;
}
