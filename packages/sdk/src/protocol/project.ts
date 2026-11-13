import { z } from "zod";
import { PlanResponseSchema } from "./api.ts";

export const DeclarationTypeSchema = z.enum(["agent", "environment", "skill", "vault", "memory_store", "file"]);
export type DeclarationType = z.infer<typeof DeclarationTypeSchema>;
export const DeclarationReferenceSchema = z.object({ type: z.string(), id: z.string(), path: z.string() });
export const ProjectDeclarationSchema = z.object({
	type: DeclarationTypeSchema,
	id: z.string(),
	base_revision: z.string(),
	source_path: z.string(),
	owner_agent: z.string().optional(),
	name: z.string().optional(),
	model: z.string().optional(),
	declaration: z.record(z.string(), z.unknown()),
	read_only_paths: z.array(z.array(z.string())),
	references: z.array(DeclarationReferenceSchema),
});
export type ProjectDeclaration = z.infer<typeof ProjectDeclarationSchema>;
export const ProjectFileUploadSchema = z.object({
	upload_id: z.string().min(1),
	file_key: z.string().min(1),
	filename: z.string().min(1),
	size: z.number().int().positive(),
	sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ProjectFileUpload = z.infer<typeof ProjectFileUploadSchema>;
export const ProjectFileUploadInputSchema = z.object({
	base_revision: z.string().min(1),
	upload_ids: z.array(z.string().min(1).max(128)).min(1).max(20),
});
export type ProjectFileUploadInput = z.infer<typeof ProjectFileUploadInputSchema>;
export const ProjectFileUploadPreviewSchema = z.object({
	base_revision: z.string(),
	before: z.string(),
	after: z.string(),
	diagnostics: z.array(z.string()),
	can_commit: z.boolean(),
	file_uploads: z.array(ProjectFileUploadSchema),
});
export type ProjectFileUploadPreview = z.infer<typeof ProjectFileUploadPreviewSchema>;
export const ProjectFileUploadCommitSchema = z.object({
	new_revision: z.string(),
	files: z.array(ProjectFileUploadSchema),
});
export type ProjectFileUploadCommit = z.infer<typeof ProjectFileUploadCommitSchema>;
export const ProjectSkillUploadSchema = z.object({
	upload_id: z.string().min(1),
	skill_key: z.string().min(1),
	filename: z.string().min(1),
	name: z.string().min(1),
	size: z.number().int().positive(),
	sha256: z.string().regex(/^[a-f0-9]{64}$/),
	file_count: z.number().int().positive(),
	expanded_size: z.number().int().positive(),
});
export type ProjectSkillUpload = z.infer<typeof ProjectSkillUploadSchema>;
export const ProjectSkillUploadInputSchema = z.object({
	base_revision: z.string().min(1),
	upload_ids: z.array(z.string().min(1).max(128)).min(1).max(20),
});
export type ProjectSkillUploadInput = z.infer<typeof ProjectSkillUploadInputSchema>;
export const ProjectSkillUploadPreviewSchema = z.object({
	base_revision: z.string(),
	before: z.string(),
	after: z.string(),
	diagnostics: z.array(z.string()),
	can_commit: z.boolean(),
	skill_uploads: z.array(ProjectSkillUploadSchema),
});
export type ProjectSkillUploadPreview = z.infer<typeof ProjectSkillUploadPreviewSchema>;
export const ProjectSkillUploadCommitSchema = z.object({
	new_revision: z.string(),
	skills: z.array(ProjectSkillUploadSchema),
});
export type ProjectSkillUploadCommit = z.infer<typeof ProjectSkillUploadCommitSchema>;
export const DeclarationWriteSchema = z.object({
	base_revision: z.string().min(1),
	declaration: z.record(z.string(), z.unknown()),
});
export const DeclarationDeleteSchema = z.object({ base_revision: z.string().min(1) });
export const DeclarationPreviewInputSchema = DeclarationDeleteSchema.extend({
	action: z.enum(["update", "delete"]),
	declaration: z.record(z.string(), z.unknown()).optional(),
});
export type DeclarationPreviewInput = z.infer<typeof DeclarationPreviewInputSchema>;
export const DeclarationPreviewSchema = z.object({
	type: DeclarationTypeSchema,
	id: z.string(),
	base_revision: z.string(),
	action: z.enum(["update", "delete"]),
	before: z.string(),
	after: z.string(),
	diagnostics: z.array(z.string()),
	references: z.array(DeclarationReferenceSchema),
	can_commit: z.boolean(),
});
export type DeclarationPreview = z.infer<typeof DeclarationPreviewSchema>;
export const ProjectPlanSchema = PlanResponseSchema.extend({
	project_revision: z.string(),
	yaml_hash: z.string().optional(),
	fingerprint: z.string(),
});
export type ProjectPlan = z.infer<typeof ProjectPlanSchema>;
