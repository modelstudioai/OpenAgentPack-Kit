import { randomUUID } from "node:crypto";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
	AgentDetailSchema,
	AgentSummarySchema,
	CreateQuotaRequestSchema,
	CreateSessionRequestSchema,
	KitError,
	PlazaQuerySchema,
	PlazaViewSchema,
	QuotaRequestViewSchema,
	QuotaViewSchema,
	SendMessageRequestSchema,
	SendMessageResponseSchema,
	SessionDetailSchema,
	type SessionEvent,
} from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";
import { mergeSessionFiles } from "../services/catalog-files.ts";
import { ProtocolVersionHeadersSchema } from "./protocol-header.ts";
import { registerSessionDirectoryRoutes } from "./session-directory.ts";
import { streamSession } from "./session-stream.ts";
import { registerSessionThreadRoutes } from "./session-threads.ts";
import { registerToolApprovalRoutes } from "./tool-approvals.ts";
import { dailyWindowQuery } from "./usage-limits.ts";

const data = (schema: z.ZodTypeAny) => z.object({ data: schema });
const errorBody = z.object({
	error: z.object({
		code: z.string(),
		message: z.string(),
		retryable: z.boolean().optional(),
		details: z.unknown().optional(),
	}),
});
const errors = {
	400: { description: "invalid_request", content: { "application/json": { schema: errorBody } } },
	401: { description: "unauthorized", content: { "application/json": { schema: errorBody } } },
	404: { description: "not_found", content: { "application/json": { schema: errorBody } } },
	403: { description: "forbidden / quota_exceeded", content: { "application/json": { schema: errorBody } } },
	409: { description: "conflict / request_pending", content: { "application/json": { schema: errorBody } } },
	428: { description: "confirmation_required", content: { "application/json": { schema: errorBody } } },
	502: { description: "provider_error", content: { "application/json": { schema: errorBody } } },
};

export function registerKitRoutes(app: OpenAPIHono<AppEnv>) {
	registerToolApprovalRoutes(app);
	registerSessionThreadRoutes(app);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/kit/agents",
			tags: ["kit"],
			responses: {
				200: {
					description: "已上架条目",
					content: { "application/json": { schema: data(z.array(AgentSummarySchema)) } },
				},
				...errors,
			},
		}),
		(c) => {
			const { catalog } = c.get("services");
			return c.json({ data: catalog.listed().map((entry) => AgentSummarySchema.parse(entry)) }, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/api/kit/agents/{slug}",
			tags: ["kit"],
			request: { params: z.object({ slug: z.string() }) },
			responses: {
				200: { description: "条目详情", content: { "application/json": { schema: data(AgentDetailSchema) } } },
				...errors,
			},
		}),
		async (c) => {
			const { catalog, gateway } = c.get("services");
			const entry = catalog.getBySlug(c.req.param("slug"));
			if (entry?.status !== "listed") throw new KitError("not_found", "agent 不存在或未上架");
			// 目录原始记忆配置（库 ID/权限/说明）不进成员响应：先剥离再 parse，由网关解析成名称/描述投影。
			const { memory_stores: catalogMemories, ...catalogEntry } = entry;
			const detail = AgentDetailSchema.parse(catalogEntry);
			// 资源是懒读取的远端投影：Provider 失败时降级省略，不影响详情可用性。
			try {
				const resources = await gateway.getRemoteAgentResources(entry.remote_agent_id);
				if (resources) detail.resources = resources;
			} catch {
				// 降级为无资源：资源面板按缺省渲染
			}
			if (catalogMemories?.length) {
				try {
					detail.memory_stores = await gateway.getAgentMemoryStores(catalogMemories);
				} catch {
					// 降级为无记忆库：资源面板按缺省渲染
				}
			}
			return c.json({ data: detail }, 200);
		},
	);

	registerSessionDirectoryRoutes(app);
	app.openapi(
		createRoute({
			method: "post",
			path: "/api/kit/sessions",
			tags: ["kit"],
			request: {
				body: { content: { "application/json": { schema: CreateSessionRequestSchema } } },
			},
			responses: {
				201: {
					description: "会话已创建（files 为已挂载进 sandbox 的附件）",
					content: { "application/json": { schema: data(SessionDetailSchema) } },
				},
				...errors,
			},
		}),
		async (c) => {
			const { catalog, sessions, files } = c.get("services");
			const body = c.req.valid("json");
			const entry = catalog.getBySlug(body.agent_slug);
			if (entry?.status !== "listed") throw new KitError("not_found", "agent 不存在或未上架");
			files.requireUploads(c.get("identity").subjectId, body.files ?? []);
			const sessionFiles = mergeSessionFiles(entry.files ?? [], body.files ?? []);
			const info = await sessions.create({
				subjectId: c.get("identity").subjectId,
				agentSlug: entry.slug,
				remoteAgentId: entry.remote_agent_id,
				...(entry.agent_version != null ? { remoteAgentVersion: entry.agent_version } : {}),
				memoryStores: entry.memory_stores,
				vaultIds: entry.vault_ids,
				...(entry.remote_environment_id ? { remoteEnvironmentId: entry.remote_environment_id } : {}),
				...(body.title ? { title: body.title } : {}),
				...(sessionFiles.length ? { files: sessionFiles } : {}),
			});
			return c.json(
				{
					data: {
						session_id: info.session_id,
						agent_slug: entry.slug,
						status: info.status,
						created_at: new Date().toISOString(),
						...(info.files?.length ? { files: info.files } : {}),
					},
				},
				201,
			);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/api/kit/sessions/{sessionId}",
			tags: ["kit"],
			request: { params: z.object({ sessionId: z.string() }) },
			responses: {
				200: { description: "会话详情", content: { "application/json": { schema: data(SessionDetailSchema) } } },
				...errors,
			},
		}),
		async (c) => {
			const { sessionIndex, gateway } = c.get("services");
			const row = sessionIndex.getForSubject(c.req.param("sessionId"), c.get("identity").subjectId);
			if (!row) throw new KitError("not_found", "会话不存在");
			const remote = await gateway.getSession(row.session_id);
			return c.json(
				{
					data: {
						...row.summary,
						...(remote?.status ? { remote_status: remote.status } : {}),
						...(remote?.usage ? { usage: remote.usage } : {}),
						...(remote?.stats ? { stats: remote.stats } : {}),
						...(row.files.length ? { files: row.files } : {}),
						...(row.messageFiles.length ? { message_files: row.messageFiles } : {}),
					},
				},
				200,
			);
		},
	);

	app.openapi(
		createRoute({
			method: "patch",
			path: "/api/kit/sessions/{sessionId}",
			tags: ["kit"],
			request: {
				params: z.object({ sessionId: z.string() }),
				body: { content: { "application/json": { schema: z.object({ title: z.string().min(1).max(120) }) } } },
			},
			responses: {
				200: { description: "已改名", content: { "application/json": { schema: data(SessionDetailSchema) } } },
				...errors,
			},
		}),
		(c) => {
			const { sessionIndex } = c.get("services");
			const row = sessionIndex.getForSubject(c.req.param("sessionId"), c.get("identity").subjectId);
			if (!row) throw new KitError("not_found", "会话不存在");
			sessionIndex.setTitle(row.session_id, c.req.valid("json").title);
			const updated = sessionIndex.get(row.session_id);
			if (!updated) throw new KitError("not_found", "会话不存在");
			return c.json({ data: updated.summary }, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/api/kit/sessions/{sessionId}/messages",
			tags: ["kit"],
			request: {
				headers: ProtocolVersionHeadersSchema,
				params: z.object({ sessionId: z.string() }),
				body: { content: { "application/json": { schema: SendMessageRequestSchema } } },
			},
			responses: {
				202: { description: "已受理", content: { "application/json": { schema: data(SendMessageResponseSchema) } } },
				...errors,
			},
		}),
		async (c) => {
			const { sessionIndex, sessions, files } = c.get("services");
			const row = sessionIndex.getForSubject(c.req.param("sessionId"), c.get("identity").subjectId);
			if (!row) throw new KitError("not_found", "会话不存在");
			const body = c.req.valid("json");
			// 附件随消息运行时挂载（POST /sessions/:id/resources，实测 2026-11-02）：
			// 归属校验与建会话同源；挂载→发送→失败自动卸载回滚由会话服务负责。
			if (body.attachments?.length) files.requireUploads(c.get("identity").subjectId, body.attachments);
			const { quota, usageLimits } = c.get("services");
			const result = await sessions.send(
				row.session_id,
				{
					text: body.text,
					...(body.client_message_id ? { clientMessageId: body.client_message_id } : {}),
					...(body.skills?.length ? { skills: body.skills } : {}),
					...(body.attachments?.length ? { attachments: body.attachments } : {}),
				},
				() => {
					// 本地成员由 Session 月度计量闸门限制；Turn 账本仍供广场与历史统计使用。
					// 匿名及外部身份继续遵守兼容 Credits 政策。
					quota.chargeTurn({
						enforceLimit: !usageLimits.isMember(c.get("identity").subjectId),
						subjectId: c.get("identity").subjectId,
						agentSlug: row.agent_slug,
						sessionId: row.session_id,
						...(body.client_message_id ? { clientMessageId: body.client_message_id } : {}),
					});
				},
			);
			return c.json({ data: { session_id: row.session_id, accepted: true, event_ids: result.event_ids } }, 202);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/api/kit/sessions/{sessionId}/interrupt",
			tags: ["kit"],
			request: { params: z.object({ sessionId: z.string() }) },
			responses: {
				200: {
					description: "已中断",
					content: { "application/json": { schema: data(z.object({ interrupted: z.boolean() })) } },
				},
				...errors,
			},
		}),
		async (c) => {
			const { sessionIndex, sessions } = c.get("services");
			const row = sessionIndex.getForSubject(c.req.param("sessionId"), c.get("identity").subjectId);
			if (!row) throw new KitError("not_found", "会话不存在");
			await sessions.interrupt(row.session_id);
			return c.json({ data: { interrupted: true } }, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/api/kit/sessions/{sessionId}/plan",
			tags: ["kit"],
			request: {
				params: z.object({ sessionId: z.string() }),
				body: { content: { "application/json": { schema: z.object({ action: z.enum(["archive", "delete"]) }) } } },
			},
			responses: {
				200: {
					description: "会话级破坏性动作的 plan + 一次性确认令牌",
					content: { "application/json": { schema: data(z.unknown()) } },
				},
				...errors,
			},
		}),
		async (c) => {
			const { sessionIndex, gate } = c.get("services");
			const sessionId = c.req.param("sessionId");
			const row = sessionIndex.getForSubject(sessionId, c.get("identity").subjectId);
			if (!row) throw new KitError("not_found", "会话不存在");
			const action = c.req.valid("json").action;
			const subject = c.get("identity").subjectId;
			// planId 必须每次唯一：闸门的「已消费」按 planId 记账，确定性 id 会让同一会话的
			// 第二次归档/删除被误判为重放（428）。
			const planId = `sessplan_${sessionId}_${action}_${randomUUID().slice(0, 8)}`;
			const issued = await gate.issue({ planId, action: `session.${action}`, subject });
			return c.json(
				{
					data: {
						plan_id: planId,
						confirm_token: issued.confirmToken,
						destructive: true,
						expires_at: issued.expiresAt,
						diff: [{ resource: `session:${sessionId}`, action, destructive: true }],
					},
				},
				200,
			);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/api/kit/sessions/{sessionId}/archive",
			tags: ["kit"],
			request: {
				params: z.object({ sessionId: z.string() }),
				body: {
					content: {
						"application/json": { schema: z.object({ plan_id: z.string().min(1), confirm_token: z.string().min(1) }) },
					},
				},
			},
			responses: {
				200: {
					description: "已归档",
					content: { "application/json": { schema: data(z.object({ archived: z.boolean() })) } },
				},
				...errors,
			},
		}),
		async (c) => {
			const { sessionIndex, sessions, gate, audit } = c.get("services");
			const sessionId = c.req.param("sessionId");
			const row = sessionIndex.getForSubject(sessionId, c.get("identity").subjectId);
			if (!row) throw new KitError("not_found", "会话不存在");
			const subject = c.get("identity").subjectId;
			const body = c.req.valid("json");
			await gate.consume({ planId: body.plan_id, action: "session.archive", subject, token: body.confirm_token });
			await sessions.archive(sessionId);
			audit.append({ subject, action: "session.archive", target: sessionId });
			return c.json({ data: { archived: true } }, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/api/kit/sessions/{sessionId}",
			tags: ["kit"],
			request: {
				params: z.object({ sessionId: z.string() }),
				body: {
					content: {
						"application/json": { schema: z.object({ plan_id: z.string().min(1), confirm_token: z.string().min(1) }) },
					},
				},
			},
			responses: {
				200: {
					description: "已删除",
					content: { "application/json": { schema: data(z.object({ deleted: z.boolean() })) } },
				},
				...errors,
			},
		}),
		async (c) => {
			const { sessionIndex, sessions, gate, audit } = c.get("services");
			const sessionId = c.req.param("sessionId");
			const row = sessionIndex.getForSubject(sessionId, c.get("identity").subjectId);
			if (!row) throw new KitError("not_found", "会话不存在");
			const subject = c.get("identity").subjectId;
			const body = c.req.valid("json");
			await gate.consume({ planId: body.plan_id, action: "session.delete", subject, token: body.confirm_token });
			await sessions.delete(sessionId);
			audit.append({ subject, action: "session.delete", target: sessionId });
			return c.json({ data: { deleted: true } }, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/api/kit/files",
			tags: ["kit"],
			// 二进制上传：@hono/zod-openapi 1.6 不认识 z.file()/z.instanceof()（会让整份文档生成失败），
			// 故用 z.any() + 显式 OpenAPI 元数据描述 binary；运行时校验仍在 handler 内做（file instanceof File）。
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
					description: "附件已上传并绑定当前身份，返回 file_id 供创建会话时挂载",
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
			const { files, audit, config } = c.get("services");
			const form = await c.req.formData();
			const file = form.get("file");
			if (!(file instanceof File)) throw new KitError("invalid_request", "缺少 multipart 文件字段 file");
			if (file.size > config.uploadMaxBytes) {
				throw new KitError(
					"invalid_request",
					`文件超过上限 ${config.uploadMaxBytes} 字节（可用 KIT_UPLOAD_MAX_BYTES 调整）`,
				);
			}
			const bytes = new Uint8Array(await file.arrayBuffer());
			const info = await files.upload(c.get("identity").subjectId, {
				filename: file.name,
				bytes,
				mimeType: file.type || undefined,
			});
			audit.append({
				subject: c.get("identity").subjectId,
				action: "file.upload",
				target: info.file_id,
				detail: { filename: file.name, size: info.size },
			});
			return c.json({ data: info }, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/api/kit/files/{fileId}",
			tags: ["kit"],
			request: {
				params: z.object({ fileId: z.string() }),
			},
			responses: {
				200: {
					description: "本人上传附件的安全扫描状态；available 前绑定会话会被 provider 拒绝",
					content: {
						"application/json": {
							schema: data(z.object({ file_id: z.string(), status: z.string().nullable(), available: z.boolean() })),
						},
					},
				},
				...errors,
			},
		}),
		async (c) => {
			const { files } = c.get("services");
			const info = await files.status(c.get("identity").subjectId, c.req.param("fileId"));
			return c.json({ data: info }, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/api/kit/sessions/{sessionId}/events",
			tags: ["kit"],
			request: {
				params: z.object({ sessionId: z.string() }),
				query: z.object({
					after_id: z.string().optional(),
					page_token: z.string().optional(),
					limit: z.coerce.number().min(1).max(100).optional(),
				}),
			},
			responses: {
				200: {
					description: "历史事件分页",
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
			const { sessionIndex, sessions } = c.get("services");
			const row = sessionIndex.getForSubject(c.req.param("sessionId"), c.get("identity").subjectId);
			if (!row) throw new KitError("not_found", "会话不存在");
			const query = c.req.valid("query");
			const page = await sessions.events(row.session_id, {
				...(query.after_id ? { afterId: query.after_id } : {}),
				...(query.page_token ? { pageToken: query.page_token } : {}),
				...(query.limit ? { limit: query.limit } : {}),
			});
			return c.json({ data: page.events as SessionEvent[], next_page_token: page.next_page_token }, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/api/kit/sessions/{sessionId}/stream",
			tags: ["kit"],
			request: {
				headers: ProtocolVersionHeadersSchema,
				params: z.object({ sessionId: z.string() }),
				query: z.object({ after: z.string().optional() }),
			},
			responses: {
				200: {
					description: "SSE 事件流（reset/ready/event/done/error/ping）",
					content: { "text/event-stream": { schema: z.string() } },
				},
				...errors,
			},
		}),
		async (c) => {
			const { sessionIndex } = c.get("services");
			const row = sessionIndex.getForSubject(c.req.param("sessionId"), c.get("identity").subjectId);
			if (!row) throw new KitError("not_found", "会话不存在");
			const after = c.req.valid("query").after;
			return streamSession(c, row.session_id, after);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/api/kit/files/{fileId}/download",
			tags: ["kit"],
			request: {
				params: z.object({ fileId: z.string() }),
				query: z.object({ session_id: z.string().min(1).optional() }),
			},
			responses: {
				200: {
					description: "本人上传的附件，或本人会话历史中已交付的文件（须携带 session_id）",
					content: { "application/octet-stream": { schema: z.string() } },
				},
				...errors,
			},
		}),
		async (c) => {
			const { files } = c.get("services");
			const file = await files.download(
				c.get("identity").subjectId,
				c.req.param("fileId"),
				c.req.valid("query").session_id,
			);
			// provider 文件名可能含非 ASCII，裸拼进响应头构造 Response 时会抛 ByteString 错误；
			// 引号内放 ASCII 兜底名，原名按 RFC 5987 编码进 filename*。
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

	app.openapi(
		createRoute({
			method: "get",
			path: "/api/kit/plaza",
			tags: ["kit"],
			request: { query: PlazaQuerySchema },
			responses: {
				200: {
					description: "广场视图（分类/精选/热门/我的）",
					content: { "application/json": { schema: data(PlazaViewSchema) } },
				},
				...errors,
			},
		}),
		(c) => {
			const { quota } = c.get("services");
			const query = c.req.valid("query");
			return c.json({ data: PlazaViewSchema.parse(quota.plazaView(c.get("identity").subjectId, query)) }, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/api/kit/quota",
			tags: ["kit"],
			request: {
				query: z.object({ days: dailyWindowQuery }),
			},
			responses: {
				200: {
					description: "当前身份的月度用量与余额（daily 为最近 days 天，缺省 30、最多 400）",
					content: { "application/json": { schema: data(QuotaViewSchema) } },
				},
				...errors,
			},
		}),
		(c) => {
			const { quota, usageLimits } = c.get("services");
			const subjectId = c.get("identity").subjectId;
			const view = quota.quotaView(subjectId, c.req.valid("query").days);
			// 本地成员已迁移到 Token/执行时长限额，兼容读接口只保留 Turn 统计。
			return c.json(
				{
					data: usageLimits.isMember(subjectId)
						? {
								...view,
								unlimited: true,
								base_limit: -1,
								override_limit: null,
								packs: [],
								limit: -1,
								remaining: -1,
								pending_request: null,
							}
						: view,
				},
				200,
			);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/api/kit/quota/requests",
			tags: ["kit"],
			request: { body: { content: { "application/json": { schema: CreateQuotaRequestSchema } } } },
			responses: {
				201: {
					description: "提额申请已提交",
					content: { "application/json": { schema: data(QuotaRequestViewSchema) } },
				},
				...errors,
			},
		}),
		(c) => {
			const { quota } = c.get("services");
			const body = c.req.valid("json");
			const view = quota.createRequest(c.get("identity").subjectId, {
				requestedCredits: body.requested_credits,
				...(body.reason ? { reason: body.reason } : {}),
			});
			return c.json({ data: view }, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/api/kit/quota/requests",
			tags: ["kit"],
			responses: {
				200: {
					description: "我的提额申请历史",
					content: { "application/json": { schema: data(z.array(QuotaRequestViewSchema)) } },
				},
				...errors,
			},
		}),
		(c) => {
			const { quota } = c.get("services");
			return c.json({ data: quota.myRequests(c.get("identity").subjectId) }, 200);
		},
	);
}
