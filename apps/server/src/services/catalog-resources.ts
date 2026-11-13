import {
	type AttachmentRef,
	type CatalogAgentInput,
	type CatalogMemoryStore,
	KitError,
} from "@openagentpack/kit-sdk/protocol";
import type { ProviderGateway } from "../gateway/types.ts";
import type { CatalogStore } from "../store/catalog.ts";
import { requireAgentVersion } from "./agent-versions.ts";
import { prepareCatalogFiles } from "./catalog-files.ts";

async function prepareMemoryStores(
	gateway: ProviderGateway,
	input: CatalogMemoryStore[],
): Promise<CatalogMemoryStore[]> {
	if (input.length > 8) throw new KitError("invalid_request", "最多选择 8 个记忆库");
	const ids = new Set<string>();
	const result: CatalogMemoryStore[] = [];
	for (const resource of input) {
		const id = resource.memory_store_id.trim();
		if (ids.has(id)) throw new KitError("invalid_request", "同一记忆库不能重复选择");
		ids.add(id);
		const store = await gateway.getRemoteMemoryStore(id);
		if (!store) throw new KitError("invalid_request", "所选记忆库不存在或已归档，请重新选择");
		const instructions = resource.instructions?.trim();
		result.push({
			memory_store_id: store.memory_store_id,
			access: resource.access,
			...(instructions ? { instructions } : {}),
		});
	}
	return result;
}

async function prepareVaults(gateway: ProviderGateway, input: string[]): Promise<string[]> {
	if (input.length > 10) throw new KitError("invalid_request", "最多选择 10 个密钥库");
	const ids = new Set<string>();
	const result: string[] = [];
	for (const value of input) {
		const id = value.trim();
		if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new KitError("invalid_request", "密钥库 ID 格式无效");
		if (ids.has(id)) throw new KitError("invalid_request", "同一密钥库不能重复选择");
		ids.add(id);
		const vault = await gateway.getRemoteVault(id);
		if (!vault) throw new KitError("invalid_request", "所选密钥库不存在或已归档，请重新选择");
		result.push(vault.vault_id);
	}
	return result;
}

/** 目录资源均由管理员配置并经 Provider 元数据校验；省略的字段不覆盖已保存配置。 */
export async function prepareCatalogResources<
	T extends {
		remote_agent_id?: string;
		agent_version?: number | null;
		files?: AttachmentRef[];
		memory_stores?: CatalogMemoryStore[];
		vault_ids?: string[];
	},
>(gateway: ProviderGateway, input: T): Promise<T> {
	if (input.agent_version != null) {
		if (!input.remote_agent_id) throw new KitError("invalid_request", "选择智能体版本时必须指定智能体");
		await requireAgentVersion(gateway, input.remote_agent_id, input.agent_version);
	}
	return {
		...input,
		...(input.files ? { files: await prepareCatalogFiles(gateway, input.files) } : {}),
		...(input.memory_stores ? { memory_stores: await prepareMemoryStores(gateway, input.memory_stores) } : {}),
		...(input.vault_ids ? { vault_ids: await prepareVaults(gateway, input.vault_ids) } : {}),
	};
}

/** 校验使用完整绑定，但未提交的绑定不能变成写入；异步校验期间变更需重新审阅。 */
export async function updateCatalogResources(
	gateway: ProviderGateway,
	catalog: CatalogStore,
	slug: string,
	patch: Partial<Omit<CatalogAgentInput, "slug">>,
) {
	const current = catalog.getBySlug(slug);
	if (!current) throw new KitError("not_found", "agent 不存在");
	const changedAgent = patch.remote_agent_id !== undefined && patch.remote_agent_id !== current.remote_agent_id;
	const versionPatch = patch.agent_version === undefined && changedAgent ? null : patch.agent_version;
	const prepared = await prepareCatalogResources(gateway, {
		...patch,
		remote_agent_id: patch.remote_agent_id ?? current.remote_agent_id,
		agent_version: versionPatch === undefined ? current.agent_version : versionPatch,
	});
	const latest = catalog.getBySlug(slug);
	if (
		latest?.id !== current.id ||
		latest.remote_agent_id !== current.remote_agent_id ||
		latest.agent_version !== current.agent_version
	)
		throw new KitError("conflict", "智能体或版本绑定已变更，请刷新后重试");
	return catalog.updateBySlug(slug, {
		...prepared,
		remote_agent_id: patch.remote_agent_id,
		agent_version: versionPatch,
	});
}
