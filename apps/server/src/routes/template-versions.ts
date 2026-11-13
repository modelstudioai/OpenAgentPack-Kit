import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
	KitError,
	TemplateVersionsPageSchema,
	TemplateVersionsQuerySchema,
	TemplateVersionViewSchema,
} from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";

const errorBody = z.object({ error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }) });
const errors = {
	400: { description: "版本号或分页游标无效", content: { "application/json": { schema: errorBody } } },
	401: { description: "管理端未认证", content: { "application/json": { schema: errorBody } } },
	403: { description: "无管理端读取权限", content: { "application/json": { schema: errorBody } } },
	404: { description: "模版或版本不存在", content: { "application/json": { schema: errorBody } } },
};
function rejectInvalid(result: { success: boolean; error?: { issues: { message: string }[] } }): undefined {
	if (!result.success) throw new KitError("invalid_request", result.error?.issues[0]?.message ?? "模版版本参数无效");
	return undefined;
}

/** 仅读取已保存的版本记录，沿用统一 admin/auditor 身份校验，不查询 Provider。 */
export function registerTemplateVersionRoutes(app: OpenAPIHono<AppEnv>) {
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/templates/{templateId}/versions",
			tags: ["admin"],
			request: {
				params: z.object({ templateId: z.string().min(1) }),
				query: TemplateVersionsQuerySchema,
			},
			responses: {
				200: {
					description: "模版版本摘要按版本号倒序分页，包含当前版本",
					content: { "application/json": { schema: TemplateVersionsPageSchema } },
				},
				...errors,
			},
		}),
		async (c) =>
			c.json(c.get("services").templates.versions(c.req.valid("param").templateId, c.req.valid("query")), 200),
		rejectInvalid,
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/templates/{templateId}/versions/{version}",
			tags: ["admin"],
			request: {
				params: z.object({ templateId: z.string().min(1), version: z.coerce.number().int().positive() }),
			},
			responses: {
				200: {
					description: "指定版本的不可变完整配置，created_at 为该版本保存时间",
					content: { "application/json": { schema: z.object({ data: TemplateVersionViewSchema }) } },
				},
				...errors,
			},
		}),
		async (c) => {
			const { templateId, version } = c.req.valid("param");
			return c.json({ data: c.get("services").templates.version(templateId, version) }, 200);
		},
		rejectInvalid,
	);
}
