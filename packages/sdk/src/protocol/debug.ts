import { z } from "zod";
import { AttachmentRefSchema, CatalogMemoryStoreSchema, SessionSummarySchema } from "./api.ts";

/** 同一个身份字符串也不能跨体验页和管理员调试域访问会话或文件。 */
export const SessionPurposeSchema = z.enum(["experience", "admin_debug"]);
export type SessionPurpose = z.infer<typeof SessionPurposeSchema>;

/** 调试绑定真实远端 Agent，不创建 Catalog Entry。project_revision 是启动时源码快照，不保证 Provider 版本锁定。 */
export const DebugSessionSummarySchema = SessionSummarySchema.omit({ agent_slug: true }).extend({
	source: z.enum(["project", "template"]),
	project_name: z.string().optional(),
	agent_key: z.string().optional(),
	remote_agent_id: z.string(),
	remote_environment_id: z.string().optional(),
	project_revision: z.string().optional(),
	source_dirty: z.boolean().optional(),
});
export type DebugSessionSummary = z.infer<typeof DebugSessionSummarySchema>;

export const DebugSessionDetailSchema = DebugSessionSummarySchema.extend({
	agent_version: z.number().int().positive().optional(),
	remote_status: z.string().optional(),
	files: z.array(AttachmentRefSchema).optional(),
	memory_stores: z.array(CatalogMemoryStoreSchema).optional(),
	vault_ids: z.array(z.string()).optional(),
});
export type DebugSessionDetail = z.infer<typeof DebugSessionDetailSchema>;

export const CreateDebugSessionRequestSchema = z.object({
	title: z.string().max(120).optional(),
	files: z.array(AttachmentRefSchema).max(10).optional(),
});
export type CreateDebugSessionRequest = z.infer<typeof CreateDebugSessionRequestSchema>;

export const AdminIdentityViewSchema = z.object({ role: z.enum(["admin", "auditor"]), subject: z.string() });
export type AdminIdentityView = z.infer<typeof AdminIdentityViewSchema>;
