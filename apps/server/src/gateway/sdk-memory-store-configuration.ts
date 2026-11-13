import { createHash } from "node:crypto";
import {
	KitError,
	MAX_MEMORY_CONFIGURATION_BYTES,
	MAX_MEMORY_ENTRIES,
	type MemoryEntry,
	type MemoryStoreConfiguration,
} from "@openagentpack/kit-sdk/protocol";
import {
	ApiError,
	getMemory,
	getMemoryStore,
	listMemories,
	type MemoryInfo,
	type MemoryListItem,
	type MemoryPage,
	type MemoryStoreInfo,
	type ProjectRuntimeContext,
} from "@openagentpack/sdk";
import { memoryStoreConfiguration } from "./memory-store-configuration.ts";

const invalid = () =>
	new KitError("provider_error", "记忆库条目未完整读取，请重试；可继续复用原库。", { retryable: true });
const safeId = (id: string) => typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id);
type Collection = {
	items: Map<string, MemoryInfo>;
	prefixes: (string | undefined)[];
	seenPrefixes: Set<string>;
	bytes: number;
};

function nextPage(result: MemoryPage<MemoryListItem>, seen: Set<string>) {
	const next = result.next_page ?? result.next_cursor;
	if (result.has_more && !next) throw invalid();
	if (!next) return undefined;
	if (typeof next !== "string" || seen.has(next)) throw invalid();
	seen.add(next);
	return next;
}

function addMemory(state: Collection, item: MemoryInfo, storeId: string) {
	if (item.type !== "memory" || !safeId(item.id) || item.memory_store_id !== storeId || typeof item.path !== "string")
		throw invalid();
	const previous = state.items.get(item.id);
	if (
		previous &&
		(previous.path !== item.path ||
			previous.content_sha256 !== item.content_sha256 ||
			previous.content !== item.content)
	)
		throw invalid();
	if (!previous && typeof item.content === "string")
		state.bytes += Buffer.byteLength(JSON.stringify({ key: item.path, content: item.content }));
	state.items.set(item.id, item);
	if (state.items.size > MAX_MEMORY_ENTRIES || state.bytes > MAX_MEMORY_CONFIGURATION_BYTES) throw invalid();
}

function addPrefixes(state: Collection, children: string[], prefix?: string) {
	for (const child of children) {
		if (typeof child !== "string" || !child || child === prefix) throw invalid();
		if (!state.seenPrefixes.has(child)) {
			state.seenPrefixes.add(child);
			state.prefixes.push(child);
		}
		if (state.prefixes.length > MAX_MEMORY_ENTRIES) throw invalid();
	}
}

async function scanPrefix(context: ProjectRuntimeContext, storeId: string, state: Collection, prefix?: string) {
	const seenPages = new Set<string>();
	let page: string | undefined;
	do {
		const result = await listMemories(context.providers, "bailian", storeId, {
			limit: 20,
			view: "full",
			...(prefix ? { path_prefix: prefix } : {}),
			...(page ? { page } : {}),
		});
		if (!Array.isArray(result.data)) throw invalid();
		const children = [...(result.prefixes ?? [])];
		for (const item of result.data) {
			if (item.type === "memory_prefix") children.push(item.path);
			else addMemory(state, item, storeId);
		}
		addPrefixes(state, children, prefix);
		page = nextPage(result, seenPages);
	} while (page);
}

async function loadEntry(context: ProjectRuntimeContext, storeId: string, listed: MemoryInfo): Promise<MemoryEntry> {
	const item =
		typeof listed.content === "string" ? listed : await getMemory(context.providers, "bailian", storeId, listed.id);
	if (
		item.id !== listed.id ||
		item.memory_store_id !== storeId ||
		item.path !== listed.path ||
		typeof item.content !== "string"
	)
		throw invalid();
	const hash = createHash("sha256").update(item.content).digest("hex");
	if (listed.content_sha256 && listed.content_sha256 !== hash) throw invalid();
	return { key: item.path.replace(/^\/+/, ""), content: item.content };
}

async function collect(context: ProjectRuntimeContext, storeId: string) {
	const state: Collection = { items: new Map(), prefixes: [undefined], seenPrefixes: new Set(), bytes: 0 };
	for (const prefix of state.prefixes) await scanPrefix(context, storeId, state, prefix);
	const entries: MemoryEntry[] = [];
	const rows = [...state.items.values()];
	for (let index = 0; index < rows.length; index += 4) {
		entries.push(...(await Promise.all(rows.slice(index, index + 4).map((item) => loadEntry(context, storeId, item)))));
		if (Buffer.byteLength(JSON.stringify(entries)) > MAX_MEMORY_CONFIGURATION_BYTES) throw invalid();
	}
	return entries;
}

function assertUnchanged(before: MemoryStoreInfo, after: MemoryStoreInfo, count: number) {
	if (
		after.id !== before.id ||
		after.status === "archived" ||
		after.archived_at ||
		after.updated_at !== before.updated_at ||
		after.name !== before.name ||
		after.description !== before.description
	)
		throw invalid();
	if (typeof after.entry_count === "number" && after.entry_count !== count) throw invalid();
}

export async function remoteMemoryStoreConfiguration(
	context: ProjectRuntimeContext,
	id: string,
): Promise<MemoryStoreConfiguration | null> {
	if (!safeId(id)) throw new KitError("invalid_request", "记忆库 ID 格式无效");
	let info: MemoryStoreInfo;
	try {
		info = await getMemoryStore(context.providers, "bailian", id);
	} catch (error) {
		if (ApiError.isNotFound(error)) return null;
		throw invalid();
	}
	if (info.id !== id) throw invalid();
	if (info.status === "archived" || info.archived_at) return null;
	try {
		const entries = await collect(context, id);
		assertUnchanged(info, await getMemoryStore(context.providers, "bailian", id), entries.length);
		return memoryStoreConfiguration(id, info.name || id, info.description ?? "", entries);
	} catch (error) {
		if (error instanceof KitError) throw error;
		throw invalid();
	}
}
