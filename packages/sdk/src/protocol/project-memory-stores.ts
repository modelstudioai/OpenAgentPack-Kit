import { z } from "zod";

/** 读写共用凭据识别，保留 JSON/YAML 引号及环境变量引用，不裁剪普通 URL 查询。 */
export function redactMemoryConfigurationText(value: string): string {
	return value
		.replace(/\b(?:Basic|Bearer)\s+[A-Za-z0-9._~+/-]+=*/gi, "[redacted]")
		.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
		.replace(
			/(\b(?:api[_-]?key|access[_-]?key|authorization|password|secret|token|signature)["']?\s*[=:]\s*)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\$\{[^}]+\}|\[redacted\]|[^\s"'&,;}\]]+))/gi,
			(match, prefix: string, double: string | undefined, single: string | undefined, plain: string | undefined) => {
				const secret = double ?? single ?? plain ?? "";
				if (!secret || secret === "[redacted]" || /^\$\{[^}]+\}$/.test(secret)) return match;
				const quote = double !== undefined ? '"' : single !== undefined ? "'" : "";
				return `${prefix}${quote}[redacted]${quote}`;
			},
		)
		.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1");
}
const safeText = (schema: z.ZodString) =>
	schema.refine((value) => redactMemoryConfigurationText(value) === value, "记忆库配置不能包含明文凭据");

export const MAX_MEMORY_ENTRIES = 1000;
export const MAX_MEMORY_CONFIGURATION_BYTES = 512 * 1024;
export const MemoryEntrySchema = z
	.object({
		key: safeText(z.string().trim().min(1, "请输入条目路径").max(1024, "条目路径最多 1024 个字符"))
			.transform((value) => value.replace(/^\/+/, ""))
			.refine(
				(value) =>
					Boolean(value) &&
					!value.includes("\\") &&
					!value.includes("\0") &&
					value.split("/").every((part) => part && part !== "." && part !== ".."),
				"请输入有效的条目路径",
			),
		content: safeText(z.string()).refine(
			(value) => new TextEncoder().encode(value).byteLength <= 102400,
			"条目正文最多 100 KiB",
		),
	})
	.strict();
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;
export const MemoryEntriesSchema = z
	.array(MemoryEntrySchema)
	.max(MAX_MEMORY_ENTRIES, "最多配置 1000 个记忆条目")
	.refine((entries) => new Set(entries.map((entry) => entry.key)).size === entries.length, "条目路径不能重复")
	.refine(
		(entries) => new TextEncoder().encode(JSON.stringify(entries)).byteLength <= MAX_MEMORY_CONFIGURATION_BYTES,
		"记忆条目总大小超过 512 KiB，无法复制",
	);
export const MemoryStoreConfigurationSchema = z.object({
	memory_store_id: z.string(),
	name: z.string(),
	description: z.string(),
	entries: MemoryEntriesSchema,
	copy_restricted_fields: z.array(z.string()).optional(),
});
export type MemoryStoreConfiguration = z.infer<typeof MemoryStoreConfigurationSchema>;

/** 只创建本地声明及初始化条目，远端写入仍由确认发布执行。 */
export const ProjectMemoryStoreCreateInputSchema = z
	.object({
		base_revision: z.string().min(1, "缺少项目版本，请重新加载").max(256),
		name: safeText(z.string().trim().min(1, "请输入记忆库名称").max(64, "记忆库名称最多 64 个字符")),
		description: safeText(z.string().trim()).optional(),
		entries: MemoryEntriesSchema.optional(),
	})
	.strict();
export type ProjectMemoryStoreCreateInput = z.infer<typeof ProjectMemoryStoreCreateInputSchema>;

export const ProjectMemoryStoreCreateResultSchema = z.object({
	new_revision: z.string(),
	memory_store: z.object({ id: z.string(), name: z.string(), source_path: z.string() }),
});
export type ProjectMemoryStoreCreateResult = z.infer<typeof ProjectMemoryStoreCreateResultSchema>;
