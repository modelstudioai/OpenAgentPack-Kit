import { z } from "zod";

export const RemoteSkillSourceSchema = z.enum(["official", "custom"]);
export type RemoteSkillSource = z.infer<typeof RemoteSkillSourceSchema>;
export const RemoteSkillIdSchema = z
	.string()
	.min(1)
	.max(256)
	.regex(/^[A-Za-z0-9_-]+$/, "Skill ID 格式无效");
export const RemoteSkillVersionIdSchema = z
	.string()
	.min(1, "请选择 Skill 版本")
	.max(128, "Skill 版本最多 128 个字符")
	.regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/, "Skill 版本格式无效")
	.refine((version) => version.toLowerCase() !== "latest", "请选择明确的 Skill 版本");
export const RemoteSkillReferenceSchema = z
	.object({
		type: RemoteSkillSourceSchema,
		skill_id: RemoteSkillIdSchema,
		version: RemoteSkillVersionIdSchema,
	})
	.strict();
export type RemoteSkillReference = z.infer<typeof RemoteSkillReferenceSchema>;

export const RemoteSkillsQuerySchema = z.object({ source: RemoteSkillSourceSchema.default("custom") }).strict();
export const RemoteSkillSchema = z.object({
	skill_id: RemoteSkillIdSchema,
	name: z.string(),
	description: z.string().optional(),
	source: RemoteSkillSourceSchema,
	status: z.enum(["checking", "active", "rejected", "deleted"]),
	latest_version: RemoteSkillVersionIdSchema.optional(),
	available: z.boolean(),
});
export type RemoteSkill = z.infer<typeof RemoteSkillSchema>;
/** 固定版本的内部安全投影，保存前复核使用，不返回原始属性或 Skill 正文。 */
export const RemoteSkillVersionSchema = z.object({
	skill_id: RemoteSkillIdSchema,
	name: z.string(),
	source: RemoteSkillSourceSchema,
	version: RemoteSkillVersionIdSchema,
	available: z.boolean(),
});
export type RemoteSkillVersion = z.infer<typeof RemoteSkillVersionSchema>;
