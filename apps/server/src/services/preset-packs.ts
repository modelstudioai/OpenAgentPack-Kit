import {
	KitError,
	type PresetPackConfiguration,
	PresetPackConfigurationSchema,
	type PresetPackCreateInput,
	PresetPackCreateInputSchema,
	PresetPackPreviewSchema,
	type PresetPackResource,
	type PresetPacksQuery,
	PresetPacksQuerySchema,
	presetPackResourceId,
} from "@openagentpack/kit-sdk/protocol";
import type { ProviderGateway } from "../gateway/types.ts";
import type { PresetPackStore } from "../store/preset-packs.ts";
import { prepareCatalogResources } from "./catalog-resources.ts";

const identity = (type: string, id: string) => JSON.stringify([type, id]);

function requiredId(
	resource: PresetPackResource,
	field: "environment_id" | "file_id" | "memory_store_id" | "vault_id",
) {
	const id = resource[field];
	if (!id) throw new KitError("invalid_request", "所选资源缺少可复用的底层资源 ID");
	return id;
}

function environmentId(config: PresetPackConfiguration, resource: PresetPackResource) {
	if (config.remote_environment_id) throw new KitError("invalid_request", "创建智能体仅支持一个环境，请只选择一个环境");
	return requiredId(resource, "environment_id");
}

function fileBinding(references: PresetPackResource[]) {
	const file_id = requiredId(references[0]!, "file_id");
	const paths = [...new Set(references.flatMap((resource) => (resource.mount_path ? [resource.mount_path] : [])))];
	if (paths.length > 1)
		throw new KitError("invalid_request", "所选文件存在多个挂载路径，创建页暂不支持该配置，请取消选择该文件");
	if (references.some((resource) => resource.access))
		throw new KitError("invalid_request", "所选文件包含创建页暂不支持的权限配置，请取消选择该文件");
	return { file_id, ...(paths[0] ? { mount_path: paths[0] } : {}) };
}

function memoryBinding(references: PresetPackResource[]) {
	const memory_store_id = requiredId(references[0]!, "memory_store_id");
	const access = [...new Set(references.flatMap((resource) => (resource.access ? [resource.access] : [])))];
	if (access.length > 1)
		throw new KitError("invalid_request", "所选记忆库存在不同访问权限，创建页暂不支持该配置，请取消选择该记忆库");
	return { memory_store_id, access: access[0] ?? ("read_only" as const) };
}

function appendResource(config: PresetPackConfiguration, type: string, references: PresetPackResource[]) {
	switch (type) {
		case "environment":
			config.remote_environment_id = environmentId(config, references[0]!);
			break;
		case "file":
			config.files.push(fileBinding(references));
			break;
		case "memory_store":
			config.memory_stores.push(memoryBinding(references));
			break;
		case "vault":
			config.vault_ids.push(requiredId(references[0]!, "vault_id"));
			break;
		default:
			throw new KitError("invalid_request", "所选资源包含创建页暂不支持的类型，请取消选择后重试");
	}
}

/** 对齐创建页的可表示范围；不截断多环境、多挂载或不同权限，不静默丢弃不支持的资源。 */
function configuration(input: PresetPackCreateInput, resources: PresetPackResource[], version: number) {
	const available = new Map<string, PresetPackResource[]>();
	for (const resource of resources) {
		const id = presetPackResourceId(resource);
		if (!id) continue;
		const key = identity(resource.type, id);
		available.set(key, [...(available.get(key) ?? []), resource]);
	}
	const config: PresetPackConfiguration = {
		remote_agent_id: input.remote_agent_id,
		agent_version: version,
		files: [],
		memory_stores: [],
		vault_ids: [],
	};
	const selected = new Set<string>();
	for (const selection of input.resources) {
		const key = identity(selection.type, selection.resource_id);
		if (selected.has(key)) throw new KitError("invalid_request", "同一资源不能重复选择");
		selected.add(key);
		const references = available.get(key);
		if (!references) throw new KitError("conflict", "所选资源已变化或不属于当前智能体，请重新读取后选择");
		appendResource(config, selection.type, references);
	}
	const parsed = PresetPackConfigurationSchema.safeParse(config);
	if (!parsed.success)
		throw new KitError("invalid_request", "所选资源超过创建页数量限制：文件 10 个、记忆库 8 个、密钥库 10 个");
	return parsed.data;
}

async function agentMetadata(gateway: ProviderGateway, input: PresetPackCreateInput) {
	const agent = (await gateway.listRemoteAgents()).find((item) => item.agent_id === input.remote_agent_id);
	if (!agent) throw new KitError("invalid_request", "所选智能体不存在或不可访问");
	const version = input.agent_version ?? agent.version;
	if (!version) throw new KitError("invalid_request", "所选智能体缺少可用版本，请重新选择");
	return { name: agent.name || agent.agent_id, version };
}

async function previewPreset(gateway: ProviderGateway, value: PresetPackCreateInput, signal?: AbortSignal) {
	const parsed = PresetPackCreateInputSchema.safeParse(value);
	if (!parsed.success) throw new KitError("invalid_request", "预设包参数无效");
	const input = parsed.data;
	const [agent, discovered] = await Promise.all([
		agentMetadata(gateway, input),
		input.resources.length ? gateway.getPresetPackAgentResources(input.remote_agent_id, signal) : Promise.resolve(null),
	]);
	const config = configuration(
		input,
		discovered?.sessions.flatMap((session) => session.resources) ?? [],
		agent.version,
	);
	const environments = config.remote_environment_id ? await gateway.listRemoteEnvironments() : [];
	const environment = environments.find((item) => item.environment_id === config.remote_environment_id);
	if (config.remote_environment_id && !environment) throw new KitError("invalid_request", "所选环境不存在或不可访问");
	const prepared = await prepareCatalogResources(gateway, config);
	signal?.throwIfAborted();
	return PresetPackPreviewSchema.parse({
		...prepared,
		remote_agent_name: agent.name,
		...(environment ? { remote_environment_name: environment.name || environment.environment_id } : {}),
	});
}

export function createPresetPackService({ store, gateway }: { store: PresetPackStore; gateway: ProviderGateway }) {
	return {
		get: store.get,
		list(query: PresetPacksQuery) {
			const parsed = PresetPacksQuerySchema.safeParse(query);
			if (!parsed.success) throw new KitError("invalid_request", "预设包查询参数无效");
			return store.list(parsed.data);
		},
		preview: (value: PresetPackCreateInput, signal?: AbortSignal) => previewPreset(gateway, value, signal),
		async create(value: PresetPackCreateInput, signal?: AbortSignal) {
			return store.create(await previewPreset(gateway, value, signal));
		},
	};
}
export type PresetPackService = ReturnType<typeof createPresetPackService>;
