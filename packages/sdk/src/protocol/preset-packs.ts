import { z } from "zod";
import { CreateTemplateDebugSessionRequestSchema } from "./api.ts";

/** 预设包发现只返回资源引用与挂载信息，不返回资源正文或凭据。 */
export const PresetPackResourceSchema = z.object({
	type: z.string(),
	resource_id: z.string().optional(),
	file_id: z.string().optional(),
	memory_store_id: z.string().optional(),
	environment_id: z.string().optional(),
	vault_id: z.string().optional(),
	repository_url: z.string().optional(),
	mount_path: z.string().optional(),
	access: z.enum(["read_only", "read_write"]).optional(),
	sources: z.array(z.enum(["session", "runtime"])),
});
export type PresetPackResource = z.infer<typeof PresetPackResourceSchema>;

/** 底层资源 ID 优先于单次会话的挂载 ID；展示去重和保存时核验共用。 */
export function presetPackResourceId(resource: PresetPackResource) {
	return (
		resource.file_id || resource.memory_store_id || resource.environment_id || resource.vault_id || resource.resource_id
	);
}

export const PresetPackSessionSchema = z.object({
	session_id: z.string(),
	status: z.string(),
	created_at: z.string().optional(),
	updated_at: z.string().optional(),
	resources: z.array(PresetPackResourceSchema),
	resource_error: z.string().optional(),
});
export type PresetPackSession = z.infer<typeof PresetPackSessionSchema>;

export const PresetPackAgentResourcesSchema = z.object({
	agent_id: z.string(),
	complete: z.boolean(),
	sessions: z.array(PresetPackSessionSchema),
});
export type PresetPackAgentResources = z.infer<typeof PresetPackAgentResourcesSchema>;

/** 客户端只提交所选身份，挂载配置与名称由服务端重新发现并校准。 */
export const PresetPackCreateInputSchema = z
	.object({
		remote_agent_id: z.string().regex(/^[A-Za-z0-9_-]+$/),
		agent_version: z.number().int().positive().optional(),
		resources: z
			.array(
				z
					.object({
						type: z.string().min(1).max(64),
						resource_id: z.string().min(1).max(512),
					})
					.strict(),
			)
			.max(100),
	})
	.strict();
export type PresetPackCreateInput = z.infer<typeof PresetPackCreateInputSchema>;

/** 保存可复用的配置引用，不保存会话、事件、资源正文或凭据。 */
export const PresetPackConfigurationSchema = CreateTemplateDebugSessionRequestSchema.omit({ title: true })
	.extend({
		agent_version: z.number().int().positive(),
		files: CreateTemplateDebugSessionRequestSchema.shape.files.default([]),
		memory_stores: CreateTemplateDebugSessionRequestSchema.shape.memory_stores.default([]),
		vault_ids: CreateTemplateDebugSessionRequestSchema.shape.vault_ids.default([]),
	})
	.strict();
export type PresetPackConfiguration = z.infer<typeof PresetPackConfigurationSchema>;
export const PresetPackPreviewSchema = PresetPackConfigurationSchema.extend({
	remote_agent_name: z.string(),
	remote_environment_name: z.string().optional(),
});
export type PresetPackPreview = z.infer<typeof PresetPackPreviewSchema>;
export const PresetPackViewSchema = PresetPackPreviewSchema.extend({
	preset_pack_id: z.string(),
	created_at: z.string(),
});
export type PresetPackView = z.infer<typeof PresetPackViewSchema>;

export const PresetPacksQuerySchema = z.object({
	search: z.string().trim().max(200).default(""),
	limit: z.coerce.number().int().min(1).max(100).default(10),
	offset: z.coerce.number().int().min(0).default(0),
});
export type PresetPacksQuery = z.infer<typeof PresetPacksQuerySchema>;
export const PresetPackSummarySchema = PresetPackViewSchema.pick({
	preset_pack_id: true,
	remote_agent_id: true,
	remote_agent_name: true,
	agent_version: true,
	created_at: true,
}).extend({ resource_count: z.number().int().nonnegative() });
export type PresetPackSummary = z.infer<typeof PresetPackSummarySchema>;
export const PresetPacksPageSchema = z.object({
	data: z.array(PresetPackSummarySchema),
	total: z.number().int().nonnegative(),
});
export type PresetPacksPage = z.infer<typeof PresetPacksPageSchema>;
