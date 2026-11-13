import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { KitError, RemoteVaultDetailSchema, RemoteVaultSchema } from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";

const errorBody = z.object({ error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }) });

export function registerAdminVaultRoutes(app: OpenAPIHono<AppEnv>) {
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/remote/vaults/{vaultId}",
			tags: ["admin"],
			request: { params: z.object({ vaultId: z.string().regex(/^[A-Za-z0-9_-]+$/) }) },
			responses: {
				200: {
					description: "密钥库详情，仅展示密钥名称、变量名和生效域名，不含密钥值",
					content: { "application/json": { schema: z.object({ data: RemoteVaultDetailSchema }) } },
				},
				400: { description: "密钥库 ID 无效" },
				401: { description: "管理端未认证" },
				403: { description: "无管理端读取权限" },
				404: { description: "密钥库不存在或已不可用" },
				502: { description: "密钥库详情查询失败" },
			},
		}),
		async (c) => {
			c.header("Cache-Control", "no-store");
			const detail = await c.get("services").gateway.getRemoteVaultDetail(c.req.valid("param").vaultId);
			if (!detail) throw new KitError("not_found", "密钥库不存在或已不可用");
			return c.json({ data: detail }, 200);
		},
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/remote/vaults",
			tags: ["admin"],
			responses: {
				200: {
					description: "Provider 未归档密钥库完整列表；仅 ID 与名称，不读取凭据",
					content: { "application/json": { schema: z.object({ data: z.array(RemoteVaultSchema) }) } },
				},
				401: { description: "管理端未认证", content: { "application/json": { schema: errorBody } } },
				403: { description: "管理端令牌无效", content: { "application/json": { schema: errorBody } } },
				502: { description: "Provider 密钥库查询失败", content: { "application/json": { schema: errorBody } } },
			},
		}),
		async (c) => c.json({ data: await c.get("services").gateway.listRemoteVaults() }, 200),
	);
}
