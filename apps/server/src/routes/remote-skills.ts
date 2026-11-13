import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { RemoteSkillSchema, RemoteSkillsQuerySchema } from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";
import { listRemoteSkillCandidates } from "../services/remote-skills.ts";

/** admin/auditor 共用的 Skill 候选只读入口；浏览器只接收安全元数据。 */
export function registerRemoteSkillRoutes(app: OpenAPIHono<AppEnv>) {
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/remote/skills",
			tags: ["admin"],
			request: { query: RemoteSkillsQuerySchema },
			responses: {
				200: {
					description: "指定来源的完整 Skill 候选列表",
					content: { "application/json": { schema: z.object({ data: z.array(RemoteSkillSchema) }) } },
				},
				400: { description: "Skill 来源无效" },
				401: { description: "管理端未认证" },
				403: { description: "无管理端读取权限" },
				502: { description: "Skill 列表查询失败" },
			},
		}),
		async (c) => {
			c.header("Cache-Control", "no-store");
			return c.json(
				{ data: await listRemoteSkillCandidates(c.get("services").gateway, c.req.valid("query").source) },
				200,
			);
		},
	);
}
