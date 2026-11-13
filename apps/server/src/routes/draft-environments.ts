import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
	ProjectEnvironmentCreateInputSchema,
	ResourceDraftEnvironmentCreateResultSchema,
} from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";
import { requireAdmin } from "../services/identity.ts";

const errorBody = z.object({
	error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean().optional() }),
});
const error = (description: string) => ({ description, content: { "application/json": { schema: errorBody } } });

/** 管理员显式保存本地共享环境；角色权限由统一管理端中间件保护。 */
export function registerDraftEnvironmentRoutes(app: OpenAPIHono<AppEnv>, basePath: string) {
	app.openapi(
		createRoute({
			method: "post",
			path: `${basePath}/environments`,
			tags: ["admin-resource-draft"],
			request: {
				params: z.object({ name: z.string().min(1) }),
				body: { required: true, content: { "application/json": { schema: ProjectEnvironmentCreateInputSchema } } },
			},
			responses: {
				201: {
					description: "共享环境声明已保存到批次声明，尚未发布",
					content: {
						"application/json": {
							schema: z.object({
								data: ResourceDraftEnvironmentCreateResultSchema,
							}),
						},
					},
				},
				400: error("环境参数无效"),
				401: error("管理端未认证"),
				403: error("auditor 不可写"),
				404: error("资源批次不存在"),
				409: error("项目被修改或操作进行中"),
			},
		}),
		async (c) => {
			const { config } = c.get("services");
			const project = c.get("draftResources");
			const { subject } = requireAdmin(c, config);
			c.header("Cache-Control", "no-store");
			return c.json(
				{ data: await project.createEnvironment(c.req.valid("param").name, c.req.valid("json"), subject) },
				201,
			);
		},
	);
}
