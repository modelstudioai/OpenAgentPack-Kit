import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
	ProjectAgentCreateInputSchema,
	ProjectAgentOptionsSchema,
	ResourceDraftAgentCreateResultSchema,
} from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";
import { requireAdmin } from "../services/identity.ts";

const errorBody = z.object({
	error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean().optional() }),
});
const error = (description: string) => ({ description, content: { "application/json": { schema: errorBody } } });

/** 仅保存 Agent YAML 声明，写权限由统一管理端中间件保护。 */
export function registerDraftAgentRoutes(app: OpenAPIHono<AppEnv>, basePath: string) {
	app.openapi(
		createRoute({
			method: "get",
			path: `${basePath}/agent-options`,
			tags: ["admin-resource-draft"],
			request: { params: z.object({ name: z.string().min(1) }) },
			responses: {
				200: {
					description: "可选择的本地共享 Skill 与官方 MCP 名称",
					content: { "application/json": { schema: z.object({ data: ProjectAgentOptionsSchema }) } },
				},
				400: error("项目声明无效"),
				401: error("管理端未认证"),
				404: error("资源批次不存在"),
			},
		}),
		async (c) => {
			c.header("Cache-Control", "no-store");
			return c.json({ data: await c.get("draftResources").agentOptions(c.req.valid("param").name) }, 200);
		},
	);
	app.openapi(
		createRoute({
			method: "post",
			path: `${basePath}/agents`,
			tags: ["admin-resource-draft"],
			request: {
				params: z.object({ name: z.string().min(1) }),
				body: { required: true, content: { "application/json": { schema: ProjectAgentCreateInputSchema } } },
			},
			responses: {
				201: {
					description: "智能体声明已保存到批次声明，尚未发布",
					content: {
						"application/json": {
							schema: z.object({
								data: ResourceDraftAgentCreateResultSchema,
							}),
						},
					},
				},
				400: error("智能体参数无效"),
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
			return c.json({ data: await project.createAgent(c.req.valid("param").name, c.req.valid("json"), subject) }, 201);
		},
	);
}
