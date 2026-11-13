import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { AuditLogsPageSchema, AuditLogsQuerySchema } from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export function registerAuditRoutes(app: OpenAPIHono<AppEnv>) {
	app.openapi(
		{
			method: "get",
			path: "/api/admin/audit",
			tags: ["admin"],
			request: { query: AuditLogsQuerySchema },
			responses: {
				200: {
					description: "当前管理身份的操作审计日志",
					content: { "application/json": { schema: AuditLogsPageSchema } },
				},
				400: { description: "查询参数无效", content: { "application/json": { schema: errorSchema } } },
				401: { description: "管理端未认证", content: { "application/json": { schema: errorSchema } } },
				403: { description: "令牌无效", content: { "application/json": { schema: errorSchema } } },
			},
		},
		(c) => {
			c.header("Cache-Control", "no-store");
			return c.json(c.get("services").audit.page(c.get("admin").subject, c.req.valid("query")), 200);
		},
	);
}
