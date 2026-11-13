import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
	KitError,
	ProjectSkillUploadCommitSchema,
	ProjectSkillUploadInputSchema,
	ProjectSkillUploadPreviewSchema,
	ProjectSkillUploadSchema,
} from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";
import { requireAdmin } from "../services/identity.ts";

const params = z.object({ name: z.string().min(1) });
const errorBody = z.object({
	error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean().optional() }),
});
const error = (description: string) => ({ description, content: { "application/json": { schema: errorBody } } });
const errors = {
	400: error("invalid_request"),
	401: error("unauthorized"),
	403: error("forbidden"),
	404: error("not_found"),
	409: error("conflict"),
	413: error("文件超过上传上限"),
};

/** Skill 模块独立暂存、预览和保存共享 Skill，不写入 Agent 引用。 */
export function registerDraftSkillUploadRoutes(app: OpenAPIHono<AppEnv>, basePath: string) {
	app.openapi(
		createRoute({
			method: "post",
			path: `${basePath}/skill-uploads`,
			tags: ["admin-resource-draft"],
			request: {
				params,
				body: {
					content: {
						"multipart/form-data": {
							schema: z.object({
								file: z.any().openapi({ type: "string", format: "binary" }),
								base_revision: z.string().min(1).max(256),
							}),
						},
					},
				},
			},
			responses: {
				201: {
					description: "Skill 包已暂存，尚未修改源码或上传 Provider",
					content: { "application/json": { schema: z.object({ data: ProjectSkillUploadSchema }) } },
				},
				...errors,
			},
		}),
		async (c) => {
			const { config } = c.get("services");
			const project = c.get("draftResources");
			const { subject } = requireAdmin(c, config);
			const { name } = c.req.valid("param");
			const form = await c.req.formData();
			const file = form.get("file");
			const revision = form.get("base_revision");
			if (!(file instanceof File) || form.getAll("file").length !== 1 || typeof revision !== "string")
				throw new KitError("invalid_request", "请提供一个 Skill ZIP 或 SKILL.md 和对应的批次修订号");
			if (file.size > config.uploadMaxBytes)
				return c.json(
					{
						error: { code: "invalid_request", message: `文件超过上限 ${config.uploadMaxBytes} 字节`, retryable: false },
					},
					413,
				);
			const upload = await project.stageSkillUpload(name, revision, subject, {
				filename: file.name,
				bytes: new Uint8Array(await file.arrayBuffer()),
			});
			return c.json({ data: upload }, 201);
		},
	);
	app.openapi(
		createRoute({
			method: "delete",
			path: `${basePath}/skill-uploads/{uploadId}`,
			tags: ["admin-resource-draft"],
			request: { params: params.extend({ uploadId: z.string().min(1).max(128) }) },
			responses: {
				200: {
					description: "取消暂存；已过期或已取消时 deleted=false",
					content: { "application/json": { schema: z.object({ data: z.object({ deleted: z.boolean() }) }) } },
				},
				...errors,
			},
		}),
		(c) => {
			const { config } = c.get("services");
			const project = c.get("draftResources");
			const { subject } = requireAdmin(c, config);
			const { name, uploadId } = c.req.valid("param");
			return c.json({ data: project.cancelSkillUpload(name, uploadId, subject) }, 200);
		},
	);
	app.openapi(
		createRoute({
			method: "post",
			path: `${basePath}/skill-uploads/preview`,
			tags: ["admin-resource-draft"],
			request: { params, body: { content: { "application/json": { schema: ProjectSkillUploadInputSchema } } } },
			responses: {
				200: {
					description: "共享 Skill 批量创建预览，源码未改变",
					content: { "application/json": { schema: z.object({ data: ProjectSkillUploadPreviewSchema }) } },
				},
				...errors,
			},
		}),
		async (c) => {
			const { config } = c.get("services");
			const project = c.get("draftResources");
			const { subject } = requireAdmin(c, config);
			return c.json(
				{ data: await project.previewSkillUploads(c.req.valid("param").name, c.req.valid("json"), subject) },
				200,
			);
		},
	);
	app.openapi(
		createRoute({
			method: "post",
			path: `${basePath}/skill-uploads/commit`,
			tags: ["admin-resource-draft"],
			request: { params, body: { content: { "application/json": { schema: ProjectSkillUploadInputSchema } } } },
			responses: {
				200: {
					description: "共享 Skill 已保存，未修改 Agent 或上传 Provider",
					content: { "application/json": { schema: z.object({ data: ProjectSkillUploadCommitSchema }) } },
				},
				...errors,
			},
		}),
		async (c) => {
			const { config } = c.get("services");
			const project = c.get("draftResources");
			const { subject } = requireAdmin(c, config);
			return c.json(
				{ data: await project.commitSkillUploads(c.req.valid("param").name, c.req.valid("json"), subject) },
				200,
			);
		},
	);
}
