export interface CatalogMemoryDraft {
	key: string;
	memory_store_id: string;
	access: "read_only" | "read_write";
	instructions: string;
}

const MAX_MEMORIES = 8;
const MAX_INSTRUCTIONS = 4090;

/** 默认空行不写入草稿；显式添加或编辑的行必须先选择记忆库。 */
export function validateCatalogMemories(value: CatalogMemoryDraft[]): string | null {
	if (value.length > MAX_MEMORIES) return `最多添加 ${MAX_MEMORIES} 个记忆库`;
	const ids = new Set<string>();
	for (const [index, memory] of value.entries()) {
		const memoryId = memory.memory_store_id.trim();
		if (!memoryId) return `第 ${index + 1} 个记忆请选择记忆库`;
		if (ids.has(memoryId)) return "同一个记忆库只能选择一次";
		if (memory.access !== "read_only" && memory.access !== "read_write") return `第 ${index + 1} 个记忆请选择有效权限`;
		if (memory.instructions.length > MAX_INSTRUCTIONS)
			return `第 ${index + 1} 个记忆的说明不能超过 ${MAX_INSTRUCTIONS} 字符`;
		ids.add(memoryId);
	}
	return null;
}
