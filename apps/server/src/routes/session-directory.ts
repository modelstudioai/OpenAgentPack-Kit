import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { SessionAgentsPageSchema, SessionListQuerySchema, SessionPageSchema } from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";

const errorBody = z.object({ error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }) });
const errors = {
	400: { description: "查询参数或游标无效", content: { "application/json": { schema: errorBody } } },
	401: { description: "未认证", content: { "application/json": { schema: errorBody } } },
};

export function registerSessionDirectoryRoutes(app: OpenAPIHono<AppEnv>) {
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/kit/session-agents",
			tags: ["kit"],
			responses: {
				200: {
					description: "本人未归档体验会话关联的全部智能体 slug",
					content: { "application/json": { schema: SessionAgentsPageSchema } },
				},
				...errors,
			},
		}),
		(c) => c.json({ data: c.get("services").sessions.listAgents(c.get("identity").subjectId) }, 200),
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/kit/sessions",
			tags: ["kit"],
			request: { query: SessionListQuerySchema },
			responses: {
				200: {
					description: "本人体验会话索引，按最近活动和会话 ID 倒序分页",
					content: { "application/json": { schema: SessionPageSchema } },
				},
				...errors,
			},
		}),
		async (c) => {
			const query = c.req.valid("query");
			const q = query.q?.toLowerCase();
			const agentSlugs = q
				? c
						.get("services")
						.catalog.list()
						.filter((agent) => agent.slug.toLowerCase().includes(q) || agent.display_name.toLowerCase().includes(q))
						.map((agent) => agent.slug)
				: undefined;
			return c.json(
				await c.get("services").sessions.listPage(c.get("identity").subjectId, {
					agentSlug: query.agent_slug,
					limit: query.limit,
					pageToken: query.page_token,
					includeArchived: query.include_archived !== "false",
					...(query.q ? { q: query.q, agentSlugs } : {}),
				}),
				200,
			);
		},
	);
}
