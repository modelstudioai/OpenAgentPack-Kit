import type { MemoryStoreConfiguration, RemoteMemoryStore } from "@openagentpack/kit-sdk/protocol";

export type PresetPackMemoryConfiguration =
	| { kind: "complete"; configuration: MemoryStoreConfiguration }
	| { kind: "reference"; store: RemoteMemoryStore };

/** 条目快照不可读不妨碍复用原库；降级前重新核验可用目录，不把未读条目伪装为空。 */
export async function loadPresetPackMemoryConfiguration(
	id: string,
	signal: AbortSignal,
	readConfiguration: (id: string, signal: AbortSignal) => Promise<MemoryStoreConfiguration>,
	listStores: (signal: AbortSignal) => Promise<RemoteMemoryStore[]>,
): Promise<PresetPackMemoryConfiguration> {
	try {
		const configuration = await readConfiguration(id, signal);
		signal.throwIfAborted();
		return { kind: "complete", configuration };
	} catch {
		signal.throwIfAborted();
		const stores = await listStores(signal);
		signal.throwIfAborted();
		const store = stores.find((item) => item.memory_store_id === id);
		if (!store) throw new Error("记忆库不存在或已不可访问，请重新读取资源列表");
		return { kind: "reference", store };
	}
}
