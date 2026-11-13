import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { RemoteFileSchema } from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";

const errorBody = z.object({ error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }) });

export function registerAdminFileRoutes(app: OpenAPIHono<AppEnv>) {
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/remote/files",
			tags: ["admin"],
			responses: {
				200: {
					description: "Provider 已上传文件完整列表；保留扫描状态供选择器禁用不可用项",
					content: { "application/json": { schema: z.object({ data: z.array(RemoteFileSchema) }) } },
				},
				401: { description: "管理端未认证", content: { "application/json": { schema: errorBody } } },
				403: { description: "管理端令牌无效", content: { "application/json": { schema: errorBody } } },
				502: { description: "Provider 文件列表查询失败", content: { "application/json": { schema: errorBody } } },
			},
		}),
		async (c) => c.json({ data: await c.get("services").gateway.listRemoteFiles() }, 200),
	);
}
