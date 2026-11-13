import {
	type MemoryEntry,
	type MemoryStoreConfiguration,
	ProjectMemoryStoreCreateInputSchema,
} from "@openagentpack/kit-sdk/protocol";
import { type CatalogMemoryDraft, validateCatalogMemories } from "../catalog/catalog-memory-fields.tsx";
import type { TemplateLocalResource } from "./template-local-resources.tsx";

export const MAX_TEMPLATE_MEMORIES = 8;
export type TemplateMemoryEntry = MemoryEntry & { id: string };
export interface TemplateMemoryDraft extends CatalogMemoryDraft, TemplateLocalResource {
	name?: string;
	/** 显式只复用身份；不读取或编辑原库正文。 */
	referenceOnly?: boolean;
	/** 仅用于当前页面的新库表单；权限和说明仍是挂载配置。 */
	creation?: { description: string; entries?: TemplateMemoryEntry[] };
	configuration?: {
		originalName: string;
		baseline: string;
		description: string;
		entries: TemplateMemoryEntry[];
		restricted: string[];
	};
}

function memoryFingerprint(name: string, description: string, entries: TemplateMemoryEntry[]) {
	return JSON.stringify({
		name: name.trim(),
		description: description.trim(),
		entries: entries
			.map(({ key, content }) => ({ key: key.trim().replace(/^\/+/, ""), content }))
			.sort((a, b) => a.key.localeCompare(b.key)),
	});
}

export function importedTemplateMemory(
	row: TemplateMemoryDraft,
	detail: MemoryStoreConfiguration,
): TemplateMemoryDraft {
	const entries = detail.entries.map((entry) => ({ ...entry, id: entry.key }));
	return {
		...row,
		name: detail.name,
		referenceOnly: undefined,
		configuration: {
			originalName: detail.name,
			baseline: memoryFingerprint(detail.name, detail.description, entries),
			description: detail.description,
			entries,
			restricted: detail.copy_restricted_fields ?? [],
		},
	};
}

export function memoryNeedsCreation(row: TemplateMemoryDraft) {
	return Boolean(
		row.creation ||
			(row.configuration &&
				memoryFingerprint(row.name ?? "", row.configuration.description, row.configuration.entries) !==
					row.configuration.baseline),
	);
}

export function emptyTemplateMemory(): TemplateMemoryDraft {
	const key = crypto.randomUUID();
	return {
		key,
		memory_store_id: `pending:${key}`,
		name: "",
		creation: { description: "" },
		access: "read_write",
		instructions: "",
	};
}

export const hasPendingMemories = (rows: TemplateMemoryDraft[]) => rows.some(memoryNeedsCreation);

export function memoryCreateInput(row: TemplateMemoryDraft, revision: string) {
	if (row.configuration?.restricted.length)
		throw new Error("记忆库含有无法完整复制的配置，请使用原库或清空后重新填写。");
	const configuration = row.creation ?? row.configuration;
	const entries = configuration?.entries ?? [];
	const parsed = ProjectMemoryStoreCreateInputSchema.safeParse({
		base_revision: revision,
		name: row.name ?? "",
		...(configuration?.description.trim() ? { description: configuration.description.trim() } : {}),
		...(entries.length ? { entries: entries.map(({ key, content }) => ({ key, content })) } : {}),
	});
	if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "请检查记忆库配置");
	return parsed.data;
}

export function validateTemplateMemories(rows: TemplateMemoryDraft[]): string | null {
	const bindingError = validateCatalogMemories(rows);
	if (bindingError) return bindingError;
	try {
		for (const row of rows) if (memoryNeedsCreation(row)) memoryCreateInput(row, "draft");
	} catch (error) {
		return error instanceof Error ? error.message : "请检查记忆库配置";
	}
	return null;
}

export function mergeImportedMemories(current: TemplateMemoryDraft[], imported: TemplateMemoryDraft[]) {
	const selected = new Set(imported.map((row) => row.memory_store_id));
	const retained = current.filter((row) => row.creation || selected.has(row.memory_store_id));
	const existing = new Set(retained.map((row) => row.memory_store_id));
	return [...retained, ...imported.filter((row) => !existing.has(row.memory_store_id))];
}

/** 完整读入所选库的条目后统一应用，保留已有编辑及新库草稿。 */
export async function loadImportedMemories(
	current: TemplateMemoryDraft[],
	selected: TemplateMemoryDraft[],
	read: (row: TemplateMemoryDraft) => Promise<MemoryStoreConfiguration>,
) {
	const merged = mergeImportedMemories(current, selected);
	return Promise.all(
		merged.map(async (row) => (memoryNeedsCreation(row) ? row : importedTemplateMemory(row, await read(row)))),
	);
}

/** 每成功一项就回填引用；后续失败重试只保存剩余新库，不重复创建已成功的库。 */
export async function prepareTemplateMemories(
	rows: TemplateMemoryDraft[],
	create: (row: TemplateMemoryDraft) => Promise<{ memory_store_id: string; name: string } & TemplateLocalResource>,
	onPrepared: (rows: TemplateMemoryDraft[]) => void,
) {
	const error = validateTemplateMemories(rows);
	if (error) throw new Error(error);
	let result = rows;
	for (const row of rows) {
		if (!memoryNeedsCreation(row)) continue;
		const reference = await create(row);
		result = result.map((item) =>
			item.key === row.key ? { ...reference, key: row.key, access: row.access, instructions: row.instructions } : item,
		);
		onPrepared(result);
	}
	return result;
}
