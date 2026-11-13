import { ProjectResourceBindingSchema } from "@openagentpack/kit-sdk/protocol";
import { z } from "zod";
export const ResourceDraftProofSchema = z
	.object({
		draft_id: z.string(),
		owner: z.string(),
		project_revision: z.string(),
		cleanup_started: z.boolean().optional(),
		required: z
			.array(
				ProjectResourceBindingSchema.pick({ id: true }).extend({
					type: z.enum(["agent", "environment", "file", "memory_store", "vault", "skill"]),
				}),
			)
			.min(1),
		resources: z
			.array(
				z.union([
					ProjectResourceBindingSchema,
					z.object({ type: z.literal("skill"), id: z.string(), remote_id: z.string(), version: z.string().optional() }),
				]),
			)
			.optional(),
	})
	.strict();
export type ResourceDraftProof = z.infer<typeof ResourceDraftProofSchema>;
