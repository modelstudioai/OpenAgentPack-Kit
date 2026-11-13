import { z } from "zod";

const credentialText =
	/\bsk-[A-Za-z0-9_-]{8,}\b|\bBearer\s+[A-Za-z0-9._~-]+|[a-z][a-z0-9+.-]*:\/\/[^\s/]+@|(?:api[_-]?key|access[_-]?key|password|secret|token|signature)\s*[=:]\s*(?!\$\{)[^\s&]+/i;

export const ProjectVaultCredentialInputSchema = z
	.object({
		name: z
			.string()
			.trim()
			.min(1, "请输入密钥名称")
			.max(50, "密钥名称最多 50 个字符")
			.refine((value) => !credentialText.test(value), "密钥名称不能包含明文凭据"),
		secret_name: z
			.string()
			.trim()
			.min(1, "请输入变量名")
			.max(200, "变量名最多 200 个字符")
			.regex(/^[A-Za-z][A-Za-z0-9_]*$/, "变量名须以字母开头，仅支持字母、数字、下划线"),
		secret_value: z
			.string()
			.min(1, "请输入变量值")
			.max(500, "变量值最多 500 个字符")
			.refine((value) => Boolean(value.trim()) && !value.includes("\0"), "请输入有效的变量值"),
		allowed_hosts: z
			.array(
				z
					.string()
					.trim()
					.toLowerCase()
					.max(253)
					.refine(
						(value) => value === "*" || /^(\*\.)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(value),
						"请输入有效域名，不支持协议、端口或路径",
					),
			)
			.min(1, "请输入密钥替换生效域名")
			.max(10, "最多可填写 10 个域名")
			.refine((hosts) => !hosts.includes("*") || hosts.length === 1, "* 代表所有域名，不能与其他域名混填")
			.refine((hosts) => new Set(hosts).size === hosts.length, "生效域名不能重复"),
		acknowledged: z.boolean().refine(Boolean, "请确认密钥共享与生效范围"),
	})
	.strict();
export type ProjectVaultCredentialInput = z.infer<typeof ProjectVaultCredentialInputSchema>;

/** 密钥值仅为写入输入；返回值、源码和 YAML 均不包含密钥值。 */
export const ProjectVaultCreateInputSchema = z
	.object({
		base_revision: z.string().min(1, "缺少项目版本，请重新加载").max(256),
		display_name: z
			.string()
			.trim()
			.min(1, "请输入密钥库名称")
			.max(50, "密钥库名称最多 50 个字符")
			.refine((value) => !credentialText.test(value), "密钥库名称不能包含明文凭据"),
		credentials: z
			.array(ProjectVaultCredentialInputSchema)
			.max(100, "最多添加 100 个密钥")
			.refine((items) => new Set(items.map((item) => item.name)).size === items.length, "密钥名称不能重复")
			.refine((items) => new Set(items.map((item) => item.secret_name)).size === items.length, "变量名不能重复")
			.optional(),
	})
	.strict();
export type ProjectVaultCreateInput = z.infer<typeof ProjectVaultCreateInputSchema>;

export const ProjectVaultCreateResultSchema = z.object({
	new_revision: z.string(),
	vault: z.object({ id: z.string(), display_name: z.string(), source_path: z.string() }),
});
export type ProjectVaultCreateResult = z.infer<typeof ProjectVaultCreateResultSchema>;
