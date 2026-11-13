import {
	type AgentMemoryStore,
	type CatalogMemoryStore,
	KitError,
	type RemoteMemoryStore,
	redactMemoryConfigurationText,
} from "@openagentpack/kit-sdk/protocol";
import {
	ApiError,
	getMemoryStore,
	listMemoryStores,
	type MemoryPage,
	type MemoryStoreInfo,
	type ProjectRuntimeContext,
} from "@openagentpack/sdk";
import { remoteMemoryStoreConfiguration } from "./sdk-memory-store-configuration.ts";
import type { ProviderGateway } from "./types.ts";

function toRemote(info: MemoryStoreInfo): RemoteMemoryStore | null {
	if (info.status === "archived" || info.archived_at) return null;
	if (!info.id) throw new KitError("provider_error", "记忆库信息缺少 ID，请稍后重试");
	return { memory_store_id: info.id, name: info.name || info.id };
}

function nextPage(page: MemoryPage<MemoryStoreInfo>, seen: Set<string>): string | undefined {
	const token = page.next_page ?? page.next_cursor;
	if (page.has_more && !token) throw new KitError("provider_error", "记忆库列表缺少下一页游标，请重试");
	if (token && seen.has(token)) throw new KitError("provider_error", "记忆库列表分页游标重复，请重试");
	if (token) seen.add(token);
	return token;
}

async function collectStores({ providers }: ProjectRuntimeContext): Promise<RemoteMemoryStore[]> {
	const stores = new Map<string, RemoteMemoryStore>();
	const seenPages = new Set<string>();
	let pageToken: string | undefined;
	do {
		const page = await listMemoryStores(providers, "bailian", {
			limit: 100,
			include_archived: false,
			...(pageToken ? { page: pageToken } : {}),
		});
		for (const info of page.data) {
			const store = toRemote(info);
			if (store) stores.set(store.memory_store_id, store);
		}
		pageToken = nextPage(page, seenPages);
	} while (pageToken);
	return [...stores.values()];
}

async function agentMemoryStore(
	context: () => Promise<ProjectRuntimeContext>,
	item: CatalogMemoryStore,
): Promise<AgentMemoryStore | null> {
	try {
		const info = await getMemoryStore((await context()).providers, "bailian", item.memory_store_id);
		if (info.status === "archived" || info.archived_at) return null;
		return {
			name: info.name || info.id,
			...(typeof info.description === "string" && info.description
				? { description: redactMemoryConfigurationText(info.description) }
				: {}),
		};
	} catch (error) {
		if (ApiError.isNotFound(error)) return null;
		throw new KitError("provider_error", "记忆库信息查询失败，请稍后重试", { retryable: true });
	}
}

/** 只调用 SDK 公开的记忆库元数据 API；不读取条目、历史版本或内容。 */
export function createSdkMemoryStoreGateway(
	context: () => Promise<ProjectRuntimeContext>,
): Pick<
	ProviderGateway,
	"listRemoteMemoryStores" | "getRemoteMemoryStore" | "getRemoteMemoryStoreConfiguration" | "getAgentMemoryStores"
> {
	return {
		getRemoteMemoryStoreConfiguration: async (id) => remoteMemoryStoreConfiguration(await context(), id),
		/** 成员侧投影：只取库元数据（名称/描述），不读取条目；缺失或已归档的库跳过，查询失败由路由整体降级。 */
		async getAgentMemoryStores(config: CatalogMemoryStore[]) {
			const stores: AgentMemoryStore[] = [];
			for (const item of config) {
				const store = await agentMemoryStore(context, item);
				if (store) stores.push(store);
			}
			return stores;
		},
		async listRemoteMemoryStores() {
			try {
				return await collectStores(await context());
			} catch (error) {
				if (error instanceof KitError) throw error;
				throw new KitError("provider_error", "记忆库列表查询失败，请稍后重试", { retryable: true });
			}
		},
		async getRemoteMemoryStore(memoryStoreId) {
			try {
				return toRemote(await getMemoryStore((await context()).providers, "bailian", memoryStoreId));
			} catch (error) {
				if (ApiError.isNotFound(error)) return null;
				throw new KitError("provider_error", "记忆库信息查询失败，请稍后重试", { retryable: true });
			}
		},
	};
}
