import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { RemoteEnvironmentDetailSchema } from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";
import { readEnvironmentDetail } from "../services/environments.ts";

/** admin/auditor 共用的环境详情只读入口；敏感配置在网关中按白名单投影。 */
export function registerEnvironmentRoutes(app: OpenAPIHono<AppEnv>) {
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/remote/environments/{environmentId}",
			tags: ["admin"],
			request: { params: z.object({ environmentId: z.string().regex(/^[A-Za-z0-9_-]+$/) }) },
			responses: {
				200: {
					description: "环境基本信息与脱敏后的运行配置",
					content: { "application/json": { schema: z.object({ data: RemoteEnvironmentDetailSchema }) } },
				},
				400: { description: "环境 ID 无效" },
				401: { description: "管理端未认证" },
				403: { description: "无管理端读取权限" },
				404: { description: "环境不存在或已不可用" },
			},
		}),
		async (c) => {
			c.header("Cache-Control", "no-store");
			return c.json(
				{ data: await readEnvironmentDetail(c.get("services").gateway, c.req.valid("param").environmentId) },
				200,
			);
		},
	);
}
