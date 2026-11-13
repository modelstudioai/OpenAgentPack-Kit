import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { eventsPageSchema, KitError, SessionThreadsResponseSchema } from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";

const query = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(50),
	page_token: z.string().optional(),
});
const errorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const errors = {
	400: { description: "invalid_request", content: { "application/json": { schema: errorBody } } },
	401: { description: "unauthorized", content: { "application/json": { schema: errorBody } } },
	404: { description: "not_found", content: { "application/json": { schema: errorBody } } },
	502: { description: "provider_error", content: { "application/json": { schema: errorBody } } },
};

/** Session 本地归属先于 Provider 查询；线程与事件正文只从 Provider 读取。 */
export function registerSessionThreadRoutes(app: OpenAPIHono<AppEnv>) {
	for (const scope of ["kit", "admin/debug"] as const) {
		app.openapi(
			createRoute({
				method: "get",
				path: `/api/${scope}/sessions/{sessionId}/threads`,
				tags: [scope === "kit" ? "kit" : "admin-debug"],
				request: { params: z.object({ sessionId: z.string() }), query },
				responses: {
					200: {
						description: "子 Agent 线程摘要分页",
						content: { "application/json": { schema: SessionThreadsResponseSchema } },
					},
					...errors,
				},
			}),
			async (c) => {
				const { sessionIndex, sessions } = c.get("services");
				const row =
					scope === "kit"
						? sessionIndex.getForSubject(c.req.param("sessionId"), c.get("identity").subjectId)
						: c.get("services").debug.requireSession(c.get("admin").subject, c.req.param("sessionId"));
				if (!row) throw new KitError("not_found", "会话不存在");
				const params = c.req.valid("query");
				return c.json(
					await sessions.threads(row.session_id, {
						limit: params.limit,
						...(params.page_token ? { pageToken: params.page_token } : {}),
						signal: c.req.raw.signal,
					}),
					200,
				);
			},
		);
		app.openapi(
			createRoute({
				method: "get",
				path: `/api/${scope}/sessions/{sessionId}/threads/{threadId}/events`,
				tags: [scope === "kit" ? "kit" : "admin-debug"],
				request: {
					params: z.object({ sessionId: z.string(), threadId: z.string().regex(/^sthr_[A-Za-z0-9_-]+$/) }),
					query,
				},
				responses: {
					200: {
						description: "子 Agent 完整快照事件分页，最新事件在前",
						content: { "application/json": { schema: eventsPageSchema() } },
					},
					...errors,
				},
			}),
			async (c) => {
				const { sessionIndex, sessions } = c.get("services");
				const params = c.req.valid("param");
				const row =
					scope === "kit"
						? sessionIndex.getForSubject(params.sessionId, c.get("identity").subjectId)
						: c.get("services").debug.requireSession(c.get("admin").subject, params.sessionId);
				if (!row) throw new KitError("not_found", "会话不存在");
				const page = c.req.valid("query");
				const result = await sessions.threadEvents(row.session_id, params.threadId, {
					limit: page.limit,
					...(page.page_token ? { pageToken: page.page_token } : {}),
					signal: c.req.raw.signal,
				});
				return c.json({ data: result.events, next_page_token: result.next_page_token }, 200);
			},
		);
	}
}
