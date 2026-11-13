import { z } from "zod";

const credentialKey = /(?:api[_-]?key|access[_-]?key|authorization|credential|password|secret|signature|token)/i;
const environmentReference = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
const credentialText =
	/\bsk-[A-Za-z0-9_-]{8,}\b|\bBearer\s+[A-Za-z0-9._~-]+|[a-z][a-z0-9+.-]*:\/\/[^\s/]+@|(?:api[_-]?key|access[_-]?key|password|secret|token|signature)\s*[=:]\s*(?!\$\{)[^\s&]+/i;
const safeText = (schema: z.ZodString) =>
	schema.refine((value) => !credentialText.test(value), "环境配置不能包含明文凭据，请使用环境变量引用");
const packages = z
	.array(safeText(z.string().trim().min(1, "请输入包名").max(200, "包名最多 200 个字符")))
	.max(50, "每种包管理器最多配置 50 个包");
const metadataKey = z
	.string()
	.trim()
	.min(1, "请输入元数据键")
	.max(64, "元数据键最多 64 个字符")
	.regex(/^[^A-Z]+$/, "元数据键不能包含大写字母")
	.refine((key) => !["__proto__", "constructor", "prototype"].includes(key), "元数据键不能使用保留字段");
const metadata = z
	.record(metadataKey, safeText(z.string().trim().max(200, "元数据值最多 200 个字符")))
	.refine((value) => Object.keys(value).length <= 50, "最多配置 50 项元数据")
	.refine(
		(value) =>
			Object.entries(value).every(
				([key, entry]) => !credentialKey.test(key) || !entry || environmentReference.test(entry),
			),
		"敏感元数据只允许环境变量引用，不能保存明文凭据",
	);

/** 与 SDK NetworkingConfig 对齐；省略可选开关时不自行补默认值。 */
export const ProjectEnvironmentNetworkingSchema = z
	.object({
		type: z.enum(["unrestricted", "limited"]),
		allow_mcp_servers: z.boolean().optional(),
		allow_package_managers: z.boolean().optional(),
		allowed_hosts: z.array(safeText(z.string())).optional(),
	})
	.strict();

/** 本地目录项目的环境声明输入；不包含远端 ID、文件路径或发布选项。 */
export const ProjectEnvironmentCreateInputSchema = z
	.object({
		base_revision: z.string().min(1, "缺少项目版本，请重新加载").max(256),
		name: safeText(z.string().trim().min(1, "请输入环境名称").max(50, "环境名称最多 50 个字符")),
		description: safeText(z.string().trim().max(200, "环境描述最多 200 个字符")).optional(),
		networking: ProjectEnvironmentNetworkingSchema.optional(),
		packages: z
			.object({
				apt: packages.optional(),
				pip: packages.optional(),
				npm: packages.optional(),
				go: packages.optional(),
				cargo: packages.optional(),
				gem: packages.optional(),
			})
			.strict()
			.optional(),
		metadata: metadata.optional(),
	})
	.strict();
export type ProjectEnvironmentCreateInput = z.infer<typeof ProjectEnvironmentCreateInputSchema>;

export const ProjectEnvironmentCreateResultSchema = z.object({
	new_revision: z.string(),
	environment: z.object({ id: z.string(), name: z.string(), source_path: z.string() }),
});
export type ProjectEnvironmentCreateResult = z.infer<typeof ProjectEnvironmentCreateResultSchema>;
