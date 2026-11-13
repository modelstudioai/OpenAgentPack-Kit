import type { PresetPackResource } from "@openagentpack/kit-sdk/protocol";
import { redactRemoteDetailText } from "./remote-detail-redaction.ts";

const REFERENCE_FIELDS = [
	"resource_id",
	"file_id",
	"memory_store_id",
	"environment_id",
	"vault_id",
	"mount_path",
] as const;

/** 严格投影已知引用，丢弃 attributes、环境变量、仓库认证和记忆正文等字段。 */
export function presetPackResource(
	raw: Record<string, unknown>,
	source: "session" | "runtime",
	secret = "",
): PresetPackResource {
	const safeText = (value: string) => redactRemoteDetailText(secret ? value.split(secret).join("[redacted]") : value);
	const resource: PresetPackResource = {
		type: typeof raw.type === "string" ? safeText(raw.type === "file_resource" ? "file" : raw.type) : "unknown",
		sources: [source],
	};
	for (const key of REFERENCE_FIELDS) {
		const value = key === "resource_id" ? (raw.resource_id ?? raw.id) : raw[key];
		if (typeof value === "string" && value) resource[key] = safeText(value);
	}
	if (raw.access === "read_only" || raw.access === "read_write") resource.access = raw.access;
	if (raw.type === "github_repository" && typeof raw.url === "string") resource.repository_url = safeText(raw.url);
	return resource;
}

export function mergePresetPackResources(resources: PresetPackResource[]): PresetPackResource[] {
	const merged = new Map<string, PresetPackResource>();
	for (const resource of resources) {
		const identity =
			resource.file_id ??
			resource.memory_store_id ??
			resource.environment_id ??
			resource.vault_id ??
			resource.repository_url ??
			resource.resource_id;
		// 不同权限必须保留为独立引用，交给导入校验拒绝冲突，不能被后读到的挂载覆盖。
		const key = JSON.stringify([resource.type, identity, resource.mount_path, resource.access]);
		const previous = merged.get(key);
		merged.set(key, {
			...previous,
			...resource,
			sources: [...new Set([...(previous?.sources ?? []), ...resource.sources])],
		});
	}
	return [...merged.values()];
}
