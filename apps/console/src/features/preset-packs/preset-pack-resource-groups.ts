import { type PresetPackResource, type PresetPackSession, presetPackResourceId } from "@openagentpack/kit-sdk/protocol";

export interface PresetPackResourceRow {
	key: string;
	id?: string;
	mountPaths: string[];
	repositoryUrls: string[];
	accesses: NonNullable<PresetPackResource["access"]>[];
	sources: PresetPackResource["sources"];
}

export interface PresetPackResourceGroup {
	type: string;
	rows: PresetPackResourceRow[];
}

/** 同类型按底层资源 ID 聚合；挂载 ID 与会话不同不产生重复行，无 ID 时不跨会话误合并。 */
export function groupPresetPackResources(sessions: readonly PresetPackSession[]): PresetPackResourceGroup[] {
	const groups = new Map<string, Map<string, PresetPackResource[]>>();
	for (const session of sessions) {
		for (const resource of session.resources) {
			let group = groups.get(resource.type);
			if (!group) {
				group = new Map();
				groups.set(resource.type, group);
			}
			const id = presetPackResourceId(resource);
			const key = JSON.stringify(
				id ? [resource.type, id] : [resource.type, session.session_id, resource.mount_path, resource.repository_url],
			);
			const references = group.get(key) ?? [];
			references.push(resource);
			group.set(key, references);
		}
	}
	return [...groups].map(([type, resources]) => ({
		type,
		rows: [...resources].map(([key, references]) => ({
			key,
			id: presetPackResourceId(references[0]!),
			mountPaths: [...new Set(references.flatMap((resource) => (resource.mount_path ? [resource.mount_path] : [])))],
			repositoryUrls: [
				...new Set(references.flatMap((resource) => (resource.repository_url ? [resource.repository_url] : []))),
			],
			accesses: [...new Set(references.flatMap((resource) => (resource.access ? [resource.access] : [])))],
			sources: [...new Set(references.flatMap((resource) => resource.sources))],
		})),
	}));
}
