import { MAX_TEMPLATE_FILES } from "../templates/template-file-draft.ts";
import { MAX_TEMPLATE_MEMORIES } from "../templates/template-memory-draft.ts";
import { MAX_TEMPLATE_VAULTS } from "../templates/template-vault-draft.ts";

const limits: Record<string, number> = {
	environment: 1,
	file: MAX_TEMPLATE_FILES,
	memory_store: MAX_TEMPLATE_MEMORIES,
	vault: MAX_TEMPLATE_VAULTS,
};

export function presetPackResourceSelectionLimit(type: string): number | undefined {
	return Object.hasOwn(limits, type) ? limits[type] : undefined;
}

/** 环境确认后替换原选择；其他受支持资源追加去重，达到创建页上限时保留原选择。 */
export function selectPresetPackResource(
	current: ReadonlyMap<string, string[]>,
	type: string,
	key: string,
	selected: boolean,
): Map<string, string[]> {
	const keys = new Set(current.get(type));
	const limit = presetPackResourceSelectionLimit(type);
	if (!selected) keys.delete(key);
	else if (limit === 1) {
		keys.clear();
		keys.add(key);
	} else if (limit !== undefined && keys.size < limit) keys.add(key);
	return new Map(current).set(type, [...keys]);
}
