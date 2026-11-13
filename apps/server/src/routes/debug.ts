import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
	AdminIdentityViewSchema,
	ApplyRequestSchema,
	CreateTemplateDebugSessionRequestSchema,
	DebugSessionDetailSchema,
	KitError,
	PlanResponseSchema,
	SendMessageRequestSchema,
	SendMessageResponseSchema,
	ToolApprovalDecisionSchema,
	ToolApprovalsResponseSchema,
} from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";
import { ProtocolVersionHeadersSchema } from "./protocol-header.ts";
import { streamSession } from "./session-stream.ts";

const params = z.object({ sessionId: z.string().min(1) });
const _targetParams = z.object({ name: z.string().min(1), agentKey: z.string().min(1) });
const data = (schema: z.ZodTypeAny) => z.object({ data: schema });
const error = {
	description: "身份、用途归属、目标状态或确认校验失败",
	content: {
		"application/json": {
			schema: z.object({
				error: z.object({
					code: z.string(),
					message: z.string(),
					retryable: z.boolean().optional(),
				}),
			}),
		},
	},
};
const errors = { 400: error, 401: error, 403: error, 404: error, 409: error, 413: error, 428: error, 502: error };
const tags = ["admin-debug"];

export function registerDebugRoutes(app: OpenAPIHono<AppEnv>) {
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/identity",
			tags: ["admin"],
			responses: {
				200: {
					description: "当前管理员角色与令牌指纹",
					content: { "application/json": { schema: data(AdminIdentityViewSchema) } },
				},
				...errors,
			},
		}),
		(c) => c.json({ data: c.get("admin") }, 200),
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/api/admin/debug/sessions",
			tags,
			request: { body: { content: { "application/json": { schema: CreateTemplateDebugSessionRequestSchema } } } },
			responses: {
				201: {
					description: "校验远端智能体与运行时资源后创建模版调试会话",
					content: { "application/json": { schema: data(DebugSessionDetailSchema) } },
				},
				...errors,
			},
		}),
		async (c) =>
			c.json({ data: await c.get("services").debug.createTemplate(c.get("admin").subject, c.req.valid("json")) }, 201),
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/debug/sessions/{sessionId}",
			tags,
			request: { params },
			responses: {
				200: {
					description: "调试会话及其实际远端目标",
					content: { "application/json": { schema: data(DebugSessionDetailSchema) } },
				},
				...errors,
			},
		}),
		async (c) =>
			c.json(
				{ data: await c.get("services").debug.detail(c.get("admin").subject, c.req.valid("param").sessionId) },
				200,
			),
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/api/admin/debug/sessions/{sessionId}/messages",
			tags,
			request: {
				headers: ProtocolVersionHeadersSchema,
				params,
				body: { content: { "application/json": { schema: SendMessageRequestSchema } } },
			},
			responses: {
				202: {
					description: "消息已受理；管理员调试不扣员工 Credits",
					content: { "application/json": { schema: data(SendMessageResponseSchema) } },
				},
				...errors,
			},
		}),
		async (c) =>
			c.json(
				{
					data: await c
						.get("services")
						.debug.send(c.get("admin").subject, c.req.valid("param").sessionId, c.req.valid("json")),
				},
				202,
			),
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/debug/sessions/{sessionId}/stream",
			tags,
			request: { headers: ProtocolVersionHeadersSchema, params, query: z.object({ after: z.string().optional() }) },
			responses: {
				200: {
					description: "复用 Kit Session SSE 协议与 after 游标",
					content: { "text/event-stream": { schema: z.string() } },
				},
				...errors,
			},
		}),
		(c) => {
			const { sessionId } = c.req.valid("param");
			const { debug, audit } = c.get("services");
			const subject = c.get("admin").subject;
			debug.requireSession(subject, sessionId);
			audit.append({ subject, action: "debug.session.stream", target: sessionId });
			return streamSession(c, sessionId, c.req.valid("query").after);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/debug/sessions/{sessionId}/events",
			tags,
			request: {
				params,
				query: z.object({
					after_id: z.string().optional(),
					page_token: z.string().optional(),
					limit: z.coerce.number().int().min(1).max(100).optional(),
				}),
			},
			responses: {
				200: {
					description: "Provider 历史事件分页，正文不落库",
					content: {
						"application/json": {
							schema: z.object({ data: z.array(z.unknown()), next_page_token: z.string().nullable() }),
						},
					},
				},
				...errors,
			},
		}),
		async (c) => {
			const { debug, sessions, audit } = c.get("services");
			const { sessionId } = c.req.valid("param");
			const subject = c.get("admin").subject;
			debug.requireSession(subject, sessionId);
			const query = c.req.valid("query");
			const page = await sessions.events(sessionId, {
				afterId: query.after_id,
				pageToken: query.page_token,
				limit: query.limit,
			});
			audit.append({ subject, action: "debug.session.events", target: sessionId });
			return c.json({ data: page.events, next_page_token: page.next_page_token }, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/api/admin/debug/sessions/{sessionId}/interrupt",
			tags,
			request: { params },
			responses: {
				200: {
					description: "停止当前执行",
					content: { "application/json": { schema: data(z.object({ interrupted: z.boolean() })) } },
				},
				...errors,
			},
		}),
		async (c) =>
			c.json(
				{ data: await c.get("services").debug.interrupt(c.get("admin").subject, c.req.valid("param").sessionId) },
				200,
			),
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/debug/sessions/{sessionId}/tool-approvals",
			tags,
			request: { headers: ProtocolVersionHeadersSchema, params },
			responses: {
				200: {
					description: "当前 Provider 工具审批集合",
					content: { "application/json": { schema: data(ToolApprovalsResponseSchema) } },
				},
				...errors,
			},
		}),
		async (c) =>
			c.json(
				{ data: await c.get("services").debug.approvals(c.get("admin").subject, c.req.valid("param").sessionId) },
				200,
			),
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/api/admin/debug/sessions/{sessionId}/tool-approvals",
			tags,
			request: {
				headers: ProtocolVersionHeadersSchema,
				params,
				body: { content: { "application/json": { schema: ToolApprovalDecisionSchema } } },
			},
			responses: {
				202: {
					description: "审批已提交，等待 Provider 事件确认",
					content: { "application/json": { schema: data(SendMessageResponseSchema) } },
				},
				...errors,
			},
		}),
		async (c) =>
			c.json(
				{
					data: await c
						.get("services")
						.debug.approve(c.get("admin").subject, c.req.valid("param").sessionId, c.req.valid("json")),
				},
				202,
			),
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/api/admin/debug/sessions/{sessionId}/plan",
			tags,
			request: {
				params,
				body: { content: { "application/json": { schema: z.object({ action: z.literal("delete") }) } } },
			},
			responses: {
				200: {
					description: "删除调试会话的影响面与一次性确认令牌",
					content: { "application/json": { schema: data(PlanResponseSchema) } },
				},
				...errors,
			},
		}),
		async (c) =>
			c.json(
				{ data: await c.get("services").debug.planDelete(c.get("admin").subject, c.req.valid("param").sessionId) },
				200,
			),
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/api/admin/debug/sessions/{sessionId}",
			tags,
			request: { params, body: { content: { "application/json": { schema: ApplyRequestSchema } } } },
			responses: {
				200: {
					description: "已删除调试会话",
					content: { "application/json": { schema: data(z.object({ deleted: z.boolean() })) } },
				},
				...errors,
			},
		}),
		async (c) =>
			c.json(
				{
					data: await c
						.get("services")
						.debug.remove(c.get("admin").subject, c.req.valid("param").sessionId, c.req.valid("json")),
				},
				200,
			),
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/api/admin/debug/files",
			tags,
			request: {
				body: {
					content: {
						"multipart/form-data": {
							schema: z.object({ file: z.any().openapi({ type: "string", format: "binary" }) }),
						},
					},
				},
			},
			responses: {
				201: {
					description: "管理员调试附件，仅允许挂载到新调试会话",
					content: {
						"application/json": {
							schema: data(z.object({ file_id: z.string(), filename: z.string(), size: z.number() })),
						},
					},
				},
				...errors,
			},
		}),
		async (c) => {
			const { files, config, audit } = c.get("services");
			const form = await c.req.formData();
			const file = form.get("file");
			if (!(file instanceof File)) throw new KitError("invalid_request", "缺少 multipart 文件字段 file");
			if (file.size > config.uploadMaxBytes)
				throw new KitError("invalid_request", `文件超过上限 ${config.uploadMaxBytes} 字节`);
			const subject = c.get("admin").subject;
			const info = await files.upload(
				subject,
				{ filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type || undefined },
				"admin_debug",
			);
			audit.append({
				subject,
				action: "debug.file.upload",
				target: info.file_id,
				detail: { filename: file.name, size: info.size },
			});
			return c.json({ data: info }, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/debug/files/{fileId}/download",
			tags,
			request: {
				params: z.object({ fileId: z.string().min(1) }),
				query: z.object({ session_id: z.string().min(1).optional() }),
			},
			responses: {
				200: {
					description: "本人调试上传或调试会话已交付文件；校验用途、归属与 Provider 历史",
					content: { "application/octet-stream": { schema: z.string() } },
				},
				...errors,
			},
		}),
		async (c) => {
			const file = await c
				.get("services")
				.files.download(
					c.get("admin").subject,
					c.req.valid("param").fileId,
					c.req.valid("query").session_id,
					"admin_debug",
				);
			// 同 kit 下载路由：非 ASCII 文件名按 RFC 5987 编码，避免响应头构造失败。
			const asciiName = file.filename.replace(/[^\x20-\x7e]|["\\]/g, "_") || "download";
			return new Response(file.body, {
				headers: {
					"Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
					"Content-Type": file.contentType,
					"Cache-Control": "private, no-store",
				},
			});
		},
	);
}
