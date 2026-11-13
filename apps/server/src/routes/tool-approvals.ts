import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
	KitError,
	SendMessageResponseSchema,
	ToolApprovalDecisionSchema,
	ToolApprovalsResponseSchema,
} from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";
import { ProtocolVersionHeadersSchema } from "./protocol-header.ts";

const error = {
	description: "审批或归属校验失败",
	content: {
		"application/json": {
			schema: z.object({ error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }) }),
		},
	},
};
const responses = { 400: error, 401: error, 404: error, 409: error, 502: error };
export function registerToolApprovalRoutes(app: OpenAPIHono<AppEnv>) {
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/kit/sessions/{sessionId}/tool-approvals",
			tags: ["kit"],
			request: { headers: ProtocolVersionHeadersSchema, params: z.object({ sessionId: z.string() }) },
			responses: {
				200: {
					description: "当前批次的工具审批请求",
					content: { "application/json": { schema: z.object({ data: ToolApprovalsResponseSchema }) } },
				},
				...responses,
			},
		}),
		async (c) => {
			const { sessionIndex, sessions } = c.get("services");
			const row = sessionIndex.getForSubject(c.req.param("sessionId"), c.get("identity").subjectId);
			if (!row) throw new KitError("not_found", "会话不存在");
			return c.json({ data: await sessions.toolApprovals(row.session_id) }, 200);
		},
	);
	app.openapi(
		createRoute({
			method: "post",
			path: "/api/kit/sessions/{sessionId}/tool-approvals",
			tags: ["kit"],
			request: {
				headers: ProtocolVersionHeadersSchema,
				params: z.object({ sessionId: z.string() }),
				body: { content: { "application/json": { schema: ToolApprovalDecisionSchema } } },
			},
			responses: {
				202: {
					description: "决定已提交，执行结果由 Provider 事件确认",
					content: { "application/json": { schema: z.object({ data: SendMessageResponseSchema }) } },
				},
				...responses,
			},
		}),
		async (c) => {
			const { sessionIndex, sessions, audit } = c.get("services");
			const subject = c.get("identity").subjectId;
			const row = sessionIndex.getForSubject(c.req.param("sessionId"), subject);
			if (!row) throw new KitError("not_found", "会话不存在");
			const decision = c.req.valid("json");
			const result = await sessions.respondToolApproval(row.session_id, decision);
			audit.append({
				subject,
				action: "session.tool_approval",
				target: row.session_id,
				detail: { batch_id: decision.batch_id, call_id: decision.call_id, result: decision.result },
			});
			return c.json({ data: { session_id: row.session_id, accepted: true, event_ids: result.event_ids } }, 202);
		},
	);
}
