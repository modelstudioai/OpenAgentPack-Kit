import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { RemoteAgentVersionDetailSchema, RemoteAgentVersionSchema } from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";
import { readAgentVersionDetail } from "../services/agent-versions.ts";

/** 版本读取沿用统一管理员认证，返回元数据投影；不触发发布或修改远端 Agent。 */
export function registerAgentVersionRoutes(app: OpenAPIHono<AppEnv>) {
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/remote/agents/{agentId}/versions",
			tags: ["admin"],
			request: { params: z.object({ agentId: z.string().regex(/^[A-Za-z0-9_-]+$/) }) },
			responses: {
				200: {
					description: "可选择的远端 Agent 版本，按版本号降序排列",
					content: { "application/json": { schema: z.object({ data: z.array(RemoteAgentVersionSchema) }) } },
				},
				400: { description: "Agent ID 无效" },
				401: { description: "管理端未认证" },
				403: { description: "无管理端读取权限" },
				404: { description: "Agent 不存在" },
			},
		}),
		async (c) =>
			c.json({ data: await c.get("services").gateway.listRemoteAgentVersions(c.req.valid("param").agentId) }, 200),
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/remote/agents/{agentId}/versions/{version}",
			tags: ["admin"],
			request: {
				params: z.object({
					agentId: z.string().regex(/^[A-Za-z0-9_-]+$/),
					version: z.coerce.number().int().positive(),
				}),
			},
			responses: {
				200: {
					description: "指定远端 Agent 版本的安全配置投影",
					content: { "application/json": { schema: z.object({ data: RemoteAgentVersionDetailSchema }) } },
				},
				400: { description: "Agent ID 或版本无效" },
				401: { description: "管理端未认证" },
				403: { description: "无管理端读取权限" },
				404: { description: "Agent 或版本不存在、已不可用" },
			},
		}),
		async (c) => {
			const { agentId, version } = c.req.valid("param");
			return c.json({ data: await readAgentVersionDetail(c.get("services").gateway, agentId, version) }, 200);
		},
	);
}
