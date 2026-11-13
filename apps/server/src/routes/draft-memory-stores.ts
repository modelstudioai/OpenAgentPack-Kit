import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
	MemoryStoreConfigurationSchema,
	ProjectMemoryStoreCreateInputSchema,
	ResourceDraftMemoryStoreCreateResultSchema,
} from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";
import { requireAdmin } from "../services/identity.ts";

const errorBody = z.object({
	error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean().optional() }),
});
const error = (description: string) => ({ description, content: { "application/json": { schema: errorBody } } });

/** 仅保存本地声明，写权限由统一管理端中间件保护。 */
export function registerDraftMemoryStoreRoutes(app: OpenAPIHono<AppEnv>, basePath: string) {
	app.openapi(
		createRoute({
			method: "get",
			path: `${basePath}/memory-stores/{storeId}`,
			tags: ["admin-resource-draft"],
			request: { params: z.object({ name: z.string().min(1), storeId: z.string().regex(/^[A-Za-z0-9_-]+$/) }) },
			responses: {
				200: {
					description: "本地记忆库配置及已解析条目正文",
					content: { "application/json": { schema: z.object({ data: MemoryStoreConfigurationSchema }) } },
				},
				400: error("记忆库参数无效"),
				401: error("管理端未认证"),
				403: error("无读取权限"),
				404: error("项目或记忆库不存在"),
				409: error("项目正在修改"),
			},
		}),
		async (c) => {
			c.header("Cache-Control", "no-store");
			const { name, storeId } = c.req.valid("param");
			return c.json({ data: await c.get("draftResources").memoryStoreConfiguration(name, storeId) }, 200);
		},
	);
	app.openapi(
		createRoute({
			method: "post",
			path: `${basePath}/memory-stores`,
			tags: ["admin-resource-draft"],
			request: {
				params: z.object({ name: z.string().min(1) }),
				body: { required: true, content: { "application/json": { schema: ProjectMemoryStoreCreateInputSchema } } },
			},
			responses: {
				201: {
					description: "记忆库声明已保存到批次声明，尚未发布",
					content: {
						"application/json": {
							schema: z.object({
								data: ResourceDraftMemoryStoreCreateResultSchema,
							}),
						},
					},
				},
				400: error("记忆库参数无效"),
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
				{ data: await project.createMemoryStore(c.req.valid("param").name, c.req.valid("json"), subject) },
				201,
			);
		},
	);
}
