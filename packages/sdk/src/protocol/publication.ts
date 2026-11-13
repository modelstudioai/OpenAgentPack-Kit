import { z } from "zod";

/** 发布错误的安全投影；不含 Provider 原文、声明、快照或凭据。 */
export const PublicationErrorDetailsSchema = z.object({
	code: z.string(),
	phase: z.enum(["plan", "prepare", "execute", "persist_state", "bindings", "receipt", "cleanup", "interrupted"]),
	retryable: z.boolean(),
	mutation_started: z.boolean(),
	http_status: z.number().int().optional(),
});
export type PublicationErrorDetails = z.infer<typeof PublicationErrorDetailsSchema>;

export const PublicationReportSchema = z.object({
	outcome: z.enum(["succeeded", "failed", "partial", "unknown"]),
	mutation_started: z.boolean(),
	resources: z.array(
		z.object({
			type: z.enum(["agent", "environment", "skill", "file", "memory_store", "vault"]),
			id: z.string(),
			status: z.enum(["succeeded", "failed", "skipped", "unknown"]),
			remote_id: z.string().optional(),
			version: z.number().int().positive().optional(),
			error_details: PublicationErrorDetailsSchema.optional(),
		}),
	),
});
export type PublicationReport = z.infer<typeof PublicationReportSchema>;
