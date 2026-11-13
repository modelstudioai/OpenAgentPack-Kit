import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
	ApplyRequestSchema,
	CatalogAgentViewSchema,
	KitError,
	PlanResponseSchema,
	TemplateInputSchema,
	TemplateListingInputSchema,
	TemplateListingRequestSchema,
	TemplatesPageSchema,
	TemplatesQuerySchema,
	TemplateUpdateInputSchema,
	TemplateViewSchema,
} from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";
import { requireAdmin } from "../services/identity.ts";
import { registerTemplateVersionRoutes } from "./template-versions.ts";

const errorBody = z.object({ error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }) });
const errors = {
	400: { description: "模版配置、资源或分页游标无效", content: { "application/json": { schema: errorBody } } },
	401: { description: "管理端未认证", content: { "application/json": { schema: errorBody } } },
	403: { description: "令牌无效或 auditor 写入被拒绝", content: { "application/json": { schema: errorBody } } },
	404: { description: "模版不存在", content: { "application/json": { schema: errorBody } } },
	409: {
		description: "模版版本或名称冲突、目录名称冲突或所选文件尚不可用",
		content: { "application/json": { schema: errorBody } },
	},
	428: { description: "上架或删除需要有效且未使用的确认令牌", content: { "application/json": { schema: errorBody } } },
};
const response = {
	description: "模版最新配置、版本与资源名称快照",
	content: { "application/json": { schema: z.object({ data: TemplateViewSchema }) } },
};
function rejectInvalid(result: { success: boolean; error?: { issues: { message: string }[] } }): undefined {
	if (!result.success) throw new KitError("invalid_request", result.error?.issues[0]?.message ?? "模版参数无效");
	return undefined;
}

export function registerTemplateRoutes(app: OpenAPIHono<AppEnv>) {
	for (const path of ["/api/admin/templates", "/api/admin/templates/*"]) {
		app.use(path, async (c, next) => {
			c.header("Cache-Control", "no-store");
			await next();
		});
	}
	registerTemplateVersionRoutes(app);
	app.openapi(
		createRoute({
			method: "post",
			path: "/api/admin/templates/{templateId}/delete/plan",
			tags: ["admin"],
			request: { params: z.object({ templateId: z.string().min(1) }) },
			responses: {
				200: {
					description: "模版及关联条目的只读删除计划",
					content: { "application/json": { schema: z.object({ data: PlanResponseSchema }) } },
				},
				...errors,
			},
		}),
		async (c) => {
			const services = c.get("services");
			return c.json(
				{
					data: await services.templates.planDelete(
						c.req.valid("param").templateId,
						requireAdmin(c, services.config).subject,
					),
				},
				200,
			);
		},
		rejectInvalid,
	);
	app.openapi(
		createRoute({
			method: "delete",
			path: "/api/admin/templates/{templateId}",
			tags: ["admin"],
			request: {
				params: z.object({ templateId: z.string().min(1) }),
				body: { content: { "application/json": { schema: ApplyRequestSchema.partial().default({}) } } },
			},
			responses: {
				200: {
					description: "已删除模版全部版本及关联条目，既有会话和远端资源保留",
					content: { "application/json": { schema: z.object({ data: z.object({ deleted: z.literal(true) }) }) } },
				},
				...errors,
			},
		}),
		async (c) => {
			const services = c.get("services");
			return c.json(
				{
					data: await services.templates.remove(
						c.req.valid("param").templateId,
						c.req.valid("json"),
						requireAdmin(c, services.config).subject,
					),
				},
				200,
			);
		},
		rejectInvalid,
	);
	app.openapi(
		createRoute({
			method: "put",
			path: "/api/admin/templates/{templateId}",
			tags: ["admin"],
			request: {
				params: z.object({ templateId: z.string().min(1) }),
				body: { required: true, content: { "application/json": { schema: TemplateUpdateInputSchema } } },
			},
			responses: { 200: response, ...errors },
		}),
		async (c) => {
			const services = c.get("services");
			return c.json(
				{
					data: await services.templates.update(
						c.req.valid("param").templateId,
						c.req.valid("json"),
						requireAdmin(c, services.config).subject,
					),
				},
				200,
			);
		},
		rejectInvalid,
	);
	app.openapi(
		createRoute({
			method: "post",
			path: "/api/admin/templates/{templateId}/listing/plan",
			tags: ["admin"],
			request: {
				params: z.object({ templateId: z.string().min(1) }),
				body: { required: true, content: { "application/json": { schema: TemplateListingInputSchema } } },
			},
			responses: {
				200: {
					description: "只读上架计划",
					content: { "application/json": { schema: z.object({ data: PlanResponseSchema }) } },
				},
				...errors,
			},
		}),
		async (c) => {
			const services = c.get("services");
			return c.json(
				{
					data: await services.templates.planListing(
						c.req.valid("param").templateId,
						c.req.valid("json"),
						requireAdmin(c, services.config).subject,
					),
				},
				200,
			);
		},
		rejectInvalid,
	);
	app.openapi(
		createRoute({
			method: "post",
			path: "/api/admin/templates/{templateId}/listing",
			tags: ["admin"],
			request: {
				params: z.object({ templateId: z.string().min(1) }),
				body: { required: true, content: { "application/json": { schema: TemplateListingRequestSchema } } },
			},
			responses: {
				200: {
					description: "已上架的模版条目",
					content: { "application/json": { schema: z.object({ data: CatalogAgentViewSchema }) } },
				},
				...errors,
			},
		}),
		async (c) => {
			const services = c.get("services");
			return c.json(
				{
					data: await services.templates.listing(
						c.req.valid("param").templateId,
						c.req.valid("json"),
						requireAdmin(c, services.config).subject,
					),
				},
				200,
			);
		},
		rejectInvalid,
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/templates",
			tags: ["admin"],
			request: { query: TemplatesQuerySchema },
			responses: {
				200: { description: "模版分页列表", content: { "application/json": { schema: TemplatesPageSchema } } },
				...errors,
			},
		}),
		(c) => c.json(c.get("services").templates.list(c.req.valid("query")), 200),
		rejectInvalid,
	);
	app.openapi(
		createRoute({
			method: "post",
			path: "/api/admin/templates",
			tags: ["admin"],
			request: { body: { required: true, content: { "application/json": { schema: TemplateInputSchema } } } },
			responses: { 201: response, ...errors },
		}),
		async (c) => {
			const services = c.get("services");
			return c.json(
				{ data: await services.templates.create(c.req.valid("json"), requireAdmin(c, services.config).subject) },
				201,
			);
		},
		rejectInvalid,
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/templates/{templateId}",
			tags: ["admin"],
			request: { params: z.object({ templateId: z.string().min(1) }) },
			responses: { 200: response, ...errors },
		}),
		(c) => c.json({ data: c.get("services").templates.get(c.req.valid("param").templateId) }, 200),
		rejectInvalid,
	);
}
