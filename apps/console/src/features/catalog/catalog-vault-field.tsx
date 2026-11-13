const MAX_VAULTS = 10;

export function validateCatalogVaults(value: string[]): string | null {
	if (value.length > MAX_VAULTS) return `最多选择 ${MAX_VAULTS} 个密钥库`;
	const ids = new Set<string>();
	for (const valueId of value) {
		const id = valueId.trim();
		if (!/^[A-Za-z0-9_-]+$/.test(id)) return "请选择有效的密钥库";
		if (ids.has(id)) return "同一个密钥库只能选择一次";
		ids.add(id);
	}
	return null;
}
