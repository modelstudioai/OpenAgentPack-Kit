/** 本地声明可独立选择；云端查询失败或加载时不展示旧云端候选。 */
export function templateResourceCandidates<T>(
	local: T[],
	remote: { data?: T[]; loading: boolean; error: string | null },
	key: (resource: T) => string,
	merge?: (local: T, remote: T) => T,
) {
	const loading = remote.loading || (remote.data === undefined && !remote.error);
	const remoteReady = !loading && !remote.error;
	const rows = new Map(local.map((item) => [key(item), item]));
	for (const item of remoteReady ? (remote.data ?? []) : []) {
		// 已解析本地候选与云端同 ID 时，以最新云端可用状态为准，保留原来的排序。
		const id = key(item);
		const existing = rows.get(id);
		rows.set(id, existing && merge ? merge(existing, item) : item);
	}
	return {
		rows: [...rows.values()],
		loading: loading && local.length === 0,
		ready: local.length > 0 || remoteReady,
	};
}
