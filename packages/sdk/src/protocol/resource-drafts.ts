import { z } from "zod";
import { ProjectOverviewSchema } from "./api.ts";
import { ProjectDeclarationSchema } from "./project.ts";
import { ProjectAgentCreateResultSchema } from "./project-agents.ts";
import { ProjectEnvironmentCreateResultSchema } from "./project-environments.ts";
import { ProjectMemoryStoreCreateResultSchema } from "./project-memory-stores.ts";
import { ProjectResourceBindingSchema } from "./project-resource-bindings.ts";
import { ProjectVaultCreateResultSchema } from "./project-vaults.ts";

export const ResourceDraftDeclarationSchema = ProjectDeclarationSchema.omit({ source_path: true, owner_agent: true });
export type ResourceDraftDeclaration = z.infer<typeof ResourceDraftDeclarationSchema>;
export const ResourceDraftOverviewSchema = ProjectOverviewSchema.omit({ config_path: true, state_path: true });
export type ResourceDraftOverview = z.infer<typeof ResourceDraftOverviewSchema>;
export const ResourceDraftAgentCreateResultSchema = ProjectAgentCreateResultSchema.extend({
	agent: ProjectAgentCreateResultSchema.shape.agent.omit({ source_path: true }),
});
export type ResourceDraftAgentCreateResult = z.infer<typeof ResourceDraftAgentCreateResultSchema>;
export const ResourceDraftEnvironmentCreateResultSchema = ProjectEnvironmentCreateResultSchema.extend({
	environment: ProjectEnvironmentCreateResultSchema.shape.environment.omit({ source_path: true }),
});
export type ResourceDraftEnvironmentCreateResult = z.infer<typeof ResourceDraftEnvironmentCreateResultSchema>;
export const ResourceDraftMemoryStoreCreateResultSchema = ProjectMemoryStoreCreateResultSchema.extend({
	memory_store: ProjectMemoryStoreCreateResultSchema.shape.memory_store.omit({ source_path: true }),
});
export type ResourceDraftMemoryStoreCreateResult = z.infer<typeof ResourceDraftMemoryStoreCreateResultSchema>;
export const ResourceDraftVaultCreateResultSchema = ProjectVaultCreateResultSchema.extend({
	vault: ProjectVaultCreateResultSchema.shape.vault.omit({ source_path: true }),
});
export type ResourceDraftVaultCreateResult = z.infer<typeof ResourceDraftVaultCreateResultSchema>;

/** 浏览器持有的批次清理凭证；不放入 URL、回执或审计正文。 */
export const RESOURCE_DRAFT_KEY_HEADER = "x-kit-draft-key";
export const ResourceDraftOwnershipHeadersSchema = z.object({
	[RESOURCE_DRAFT_KEY_HEADER]: z.uuid().optional(),
});

export const ResourceDraftStatusSchema = z.enum(["draft", "publishing", "published", "failed"]);
export const ResourceDraftViewSchema = z.object({
	draft_id: z.string(),
	/** Compatibility alias; new clients use draft_id. */
	project_name: z.string(),
	status: ResourceDraftStatusSchema,
	resources: z.array(ProjectResourceBindingSchema),
	cleanup_pending: z.boolean(),
	/** 仅服务端持久阶段/成功证明决定；报告成功不能代替完整成功证明。 */
	recovery_action: z.enum(["replan", "read_result", "finalize", "none"]).optional(),
	operation_id: z.string().optional(),
	created_at: z.string(),
	updated_at: z.string(),
});
export type ResourceDraftView = z.infer<typeof ResourceDraftViewSchema>;

export const ResourceDraftDiscardResultSchema = z.object({ discarded: z.boolean() });
export type ResourceDraftDiscardResult = z.infer<typeof ResourceDraftDiscardResultSchema>;
