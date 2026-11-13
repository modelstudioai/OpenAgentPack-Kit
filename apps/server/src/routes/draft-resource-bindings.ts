import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ProjectResourceBindingInputSchema, ProjectResourceBindingsSchema } from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";

const errorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const error = (description: string) => ({ description, content: { "application/json": { schema: errorBody } } });

/** 只读查询沿用管理端统一权限规则，不执行项目写操作。 */
export function registerDraftResourceBindingRoutes(app: OpenAPIHono<AppEnv>, basePath: string) {
	app.openapi(
		createRoute({
			method: "get",
			path: `${basePath}/resource-bindings`,
			tags: ["admin-resource-draft"],
			request: { params: z.object({ name: z.string().min(1) }) },
			responses: {
				200: {
					description: "当前源码内已发布且绑定完整的资源标识与 Agent 具体版本",
					content: { "application/json": { schema: z.object({ data: ProjectResourceBindingsSchema }) } },
				},
				401: error("管理端未认证"),
				404: error("项目不存在"),
				409: error("批次声明变化或正在修改"),
			},
		}),
		async (c) => {
			c.header("Cache-Control", "no-store");
			return c.json({ data: await c.get("draftResources").resourceBindings(c.req.valid("param").name) }, 200);
		},
	);
	app.openapi(
		createRoute({
			method: "post",
			path: `${basePath}/resource-bindings/resolve`,
			tags: ["admin-resource-draft"],
			request: {
				params: z.object({ name: z.string().min(1) }),
				body: { required: true, content: { "application/json": { schema: ProjectResourceBindingInputSchema } } },
			},
			responses: {
				200: {
					description: "本地声明已发布的远端标识与 Agent 具体版本",
					content: { "application/json": { schema: z.object({ data: ProjectResourceBindingsSchema }) } },
				},
				400: error("资源引用参数无效"),
				401: error("管理端未认证"),
				403: error("当前角色不能使用 POST 查询"),
				404: error("项目或声明不存在"),
				409: error("尚未发布、绑定不完整或项目正在修改"),
			},
		}),
		async (c) => {
			c.header("Cache-Control", "no-store");
			return c.json(
				{
					data: await c.get("draftResources").resolveResourceBindings(c.req.valid("param").name, c.req.valid("json")),
				},
				200,
			);
		},
	);
}
