import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { KitError, MemoryStoreConfigurationSchema, RemoteMemoryStoreSchema } from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";

const errorBody = z.object({ error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }) });

export function registerAdminMemoryStoreRoutes(app: OpenAPIHono<AppEnv>) {
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/remote/memory-stores/{storeId}",
			tags: ["admin"],
			request: { params: z.object({ storeId: z.string().regex(/^[A-Za-z0-9_-]+$/) }) },
			responses: {
				200: {
					description: "完整记忆库配置及条目正文，仅用于管理员导入",
					content: { "application/json": { schema: z.object({ data: MemoryStoreConfigurationSchema }) } },
				},
				400: { description: "记忆库 ID 无效" },
				401: { description: "管理端未认证" },
				403: { description: "无读取权限" },
				404: { description: "记忆库不存在或已归档" },
				502: { description: "条目未完整读取或超出可编辑范围" },
			},
		}),
		async (c) => {
			c.header("Cache-Control", "no-store");
			const data = await c.get("services").gateway.getRemoteMemoryStoreConfiguration(c.req.valid("param").storeId);
			if (!data) throw new KitError("not_found", "记忆库不存在或已归档");
			return c.json({ data }, 200);
		},
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/remote/memory-stores",
			tags: ["admin"],
			responses: {
				200: {
					description: "Provider 未归档记忆库完整列表；只返回 ID 与名称，不读取记忆内容",
					content: { "application/json": { schema: z.object({ data: z.array(RemoteMemoryStoreSchema) }) } },
				},
				401: { description: "管理端未认证", content: { "application/json": { schema: errorBody } } },
				403: { description: "管理端令牌无效", content: { "application/json": { schema: errorBody } } },
				502: { description: "Provider 记忆库查询失败", content: { "application/json": { schema: errorBody } } },
			},
		}),
		async (c) => c.json({ data: await c.get("services").gateway.listRemoteMemoryStores() }, 200),
	);
}
