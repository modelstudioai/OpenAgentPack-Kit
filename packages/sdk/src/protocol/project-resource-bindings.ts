import { z } from "zod";

export const ProjectResourceBindingTypeSchema = z.enum(["agent", "environment", "file", "memory_store", "vault"]);
export type ProjectResourceBindingType = z.infer<typeof ProjectResourceBindingTypeSchema>;

const reference = z.object({
	type: ProjectResourceBindingTypeSchema,
	id: z
		.string()
		.min(1)
		.max(128)
		.regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/, "本地资源标识无效"),
});
/** 仅解析已存在的发布绑定，不创建、发布或按名称猜测远端资源。 */
export const ProjectResourceBindingInputSchema = z
	.object({
		resources: z
			.array(reference.strict())
			.min(1)
			.max(30)
			.refine((items) => new Set(items.map((item) => `${item.type}:${item.id}`)).size === items.length, "资源不能重复"),
	})
	.strict();
export type ProjectResourceBindingInput = z.infer<typeof ProjectResourceBindingInputSchema>;

export const ProjectResourceBindingSchema = reference.extend({
	remote_id: z.string().min(1),
	version: z.number().int().positive().optional(),
});
export type ProjectResourceBinding = z.infer<typeof ProjectResourceBindingSchema>;
export const ProjectResourceBindingsSchema = z.object({ resources: z.array(ProjectResourceBindingSchema) });
export type ProjectResourceBindings = z.infer<typeof ProjectResourceBindingsSchema>;
