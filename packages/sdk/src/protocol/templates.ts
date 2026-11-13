import { z } from "zod";
import {
	CatalogAgentInputSchema,
	CreateTemplateDebugSessionRequestSchema,
	MembersQuerySchema,
	PlazaCategorySchema,
} from "./api.ts";

/** 模版是本地配置目录；保存引用与展示文案，不保存调试会话、事件或凭据。 */
export const TemplateInputSchema = CreateTemplateDebugSessionRequestSchema.omit({ title: true })
	.extend({
		name: z.string().trim().min(1, "请输入模版名称").max(64, "模版名称最多 64 个字符"),
		category: PlazaCategorySchema,
		...CatalogAgentInputSchema.pick({ description: true, opening_remarks: true, suggested_prompts: true }).shape,
		files: CreateTemplateDebugSessionRequestSchema.shape.files.default([]),
		memory_stores: CreateTemplateDebugSessionRequestSchema.shape.memory_stores.default([]),
		vault_ids: CreateTemplateDebugSessionRequestSchema.shape.vault_ids.default([]),
	})
	.strict();
export type TemplateInput = z.infer<typeof TemplateInputSchema>;
export type TemplateCreateInput = z.input<typeof TemplateInputSchema>;

/** 编辑以读取时版本为基线，防止覆盖其他管理员的修改。 */
export const TemplateUpdateInputSchema = TemplateInputSchema.extend({
	base_version: z.number().int().positive(),
});
export type TemplateUpdateInput = z.input<typeof TemplateUpdateInputSchema>;

export const TemplateListingInputSchema = z
	.object({ display_name: z.string().trim().min(1, "请输入展示名称").max(60, "展示名称最多 60 个字符") })
	.strict();
export type TemplateListingInput = z.infer<typeof TemplateListingInputSchema>;
export const TemplateListingRequestSchema = TemplateListingInputSchema.extend({
	plan_id: z.string().min(1).optional(),
	confirm_token: z.string().min(1).optional(),
});
export type TemplateListingRequest = z.infer<typeof TemplateListingRequestSchema>;

export const TemplateViewSchema = TemplateInputSchema.extend({
	/** 旧配置未保存分类时只在读取投影中视为通用；创建和编辑请求仍必填。 */
	category: PlazaCategorySchema.default("general"),
	template_id: z.string(),
	remote_agent_name: z.string(),
	/** 保存时元数据快照，不承诺锁定 Provider 版本。 */
	remote_agent_version: z.number().int().optional(),
	remote_environment_name: z.string().optional(),
	created_at: z.string(),
	/** Kit 模版配置版本，与远端 Agent 的版本快照相互独立。 */
	version: z.number().int().positive(),
	updated_at: z.string(),
	/** 与 Catalog 当前记录关联，不是保存时的状态快照。 */
	listing: z
		.object({
			catalog_id: z.string(),
			slug: z.string(),
			display_name: z.string(),
			status: z.enum(["listed", "unlisted"]),
			/** 最近一次由未上架转为已上架的时间；历史未记录时省略，下架后保留。 */
			listed_at: z.string().optional(),
		})
		.optional(),
});
export type TemplateView = z.infer<typeof TemplateViewSchema>;

/** 不可变配置快照；created_at 是该版本保存时间，不混入当前关联或更新时间。 */
export const TemplateVersionViewSchema = TemplateViewSchema.omit({ listing: true, updated_at: true });
export type TemplateVersionView = z.infer<typeof TemplateVersionViewSchema>;
export const TemplateVersionSummarySchema = TemplateVersionViewSchema.pick({
	version: true,
	name: true,
	category: true,
	created_at: true,
	remote_agent_id: true,
	remote_agent_name: true,
	agent_version: true,
	remote_agent_version: true,
	remote_environment_id: true,
	remote_environment_name: true,
	files: true,
	memory_stores: true,
	vault_ids: true,
});
export type TemplateVersionSummary = z.infer<typeof TemplateVersionSummarySchema>;
export const TemplateVersionsQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(20),
	page_token: z.string().min(1).max(2048).optional(),
});
export type TemplateVersionsQuery = z.infer<typeof TemplateVersionsQuerySchema>;
export const TemplateVersionsPageSchema = z.object({
	data: z.array(TemplateVersionSummarySchema),
	current_version: z.number().int().positive(),
	next_page_token: z.string().optional(),
});
export type TemplateVersionsPage = z.infer<typeof TemplateVersionsPageSchema>;

export const TemplatesQuerySchema = MembersQuerySchema.extend({
	status: z.enum(["listed", "unlisted"]).optional(),
	category: PlazaCategorySchema.optional(),
});
export type TemplatesQuery = z.infer<typeof TemplatesQuerySchema>;
export const TemplatesPageSchema = z.object({
	data: z.array(TemplateViewSchema),
	next_page_token: z.string().optional(),
});
export type TemplatesPage = z.infer<typeof TemplatesPageSchema>;
