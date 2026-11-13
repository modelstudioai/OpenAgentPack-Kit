import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
	DeclarationDeleteSchema,
	DeclarationPreviewInputSchema,
	DeclarationPreviewSchema,
	DeclarationWriteSchema,
	encodeFrame,
	KitError,
	OperationViewSchema,
	ProjectPlanSchema,
	ResourceDraftDeclarationSchema,
	ResourceDraftOverviewSchema,
} from "@openagentpack/kit-sdk/protocol";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../app-env.ts";
import { requireAdmin } from "../services/identity.ts";
import { registerDraftAgentRoutes } from "./draft-agents.ts";
import { registerDraftEnvironmentRoutes } from "./draft-environments.ts";
import { registerDraftFileUploadRoutes } from "./draft-file-uploads.ts";
import { registerDraftMemoryStoreRoutes } from "./draft-memory-stores.ts";
import { registerDraftResourceBindingRoutes } from "./draft-resource-bindings.ts";
import { registerDraftSkillUploadRoutes } from "./draft-skill-uploads.ts";
import { registerDraftVaultRoutes } from "./draft-vaults.ts";

const errorBody = z.object({
	error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean().optional() }),
});
const errors = {
	400: { description: "invalid_request", content: { "application/json": { schema: errorBody } } },
	409: { description: "conflict", content: { "application/json": { schema: errorBody } } },
	401: { description: "unauthorized", content: { "application/json": { schema: errorBody } } },
	404: { description: "not_found", content: { "application/json": { schema: errorBody } } },
	428: { description: "confirmation_required", content: { "application/json": { schema: errorBody } } },
};
const data = (schema: z.ZodTypeAny) => z.object({ data: schema });
const params = z.object({ name: z.string() });
const execBody = z.object({ plan_id: z.string().min(1), confirm_token: z.string().min(1) });

export function registerDraftResourceRoutes(app: OpenAPIHono<AppEnv>) {
	const basePath = "/api/admin/resource-drafts/{name}/resources";
	registerDraftAgentRoutes(app, basePath);
	registerDraftEnvironmentRoutes(app, basePath);
	registerDraftVaultRoutes(app, basePath);
	registerDraftMemoryStoreRoutes(app, basePath);
	registerDraftResourceBindingRoutes(app, basePath);
	registerDraftFileUploadRoutes(app, basePath);
	registerDraftSkillUploadRoutes(app, basePath);
	app.openapi(
		createRoute({
			method: "get",
			path: `${basePath}`,
			tags: ["admin-resource-draft"],
			request: { params },
			responses: {
				200: {
					description: "三源概览与 drift",
					content: {
						"application/json": { schema: data(ResourceDraftOverviewSchema) },
					},
				},
				...errors,
			},
		}),
		async (c) => c.json({ data: await c.get("draftResources").overview(c.req.valid("param").name) }, 200),
	);
	app.openapi(
		createRoute({
			method: "get",
			path: `${basePath}/declarations`,
			tags: ["admin-resource-draft"],
			request: { params },
			responses: {
				200: {
					description: "声明清单",
					content: {
						"application/json": {
							schema: data(z.array(ResourceDraftDeclarationSchema)),
						},
					},
				},
				...errors,
			},
		}),
		async (c) => c.json({ data: await c.get("draftResources").declarations(c.req.valid("param").name) }, 200),
	);
	app.openapi(
		createRoute({
			method: "get",
			path: `${basePath}/declarations/{type}/{id}`,
			tags: ["admin-resource-draft"],
			request: { params: params.extend({ type: z.string(), id: z.string() }) },
			responses: {
				200: {
					description: "单个声明（vault 脱敏）",
					content: {
						"application/json": { schema: data(ResourceDraftDeclarationSchema) },
					},
				},
				...errors,
			},
		}),
		async (c) => {
			const p = c.req.valid("param");
			return c.json({ data: await c.get("draftResources").declaration(p.name, p.type, p.id) }, 200);
		},
	);
	app.openapi(
		createRoute({
			method: "post",
			path: `${basePath}/validate`,
			tags: ["admin-resource-draft"],
			request: { params },
			responses: {
				200: {
					description: "离线校验结果：阻塞诊断与非阻塞警告",
					content: {
						"application/json": {
							schema: data(z.object({ diagnostics: z.array(z.string()), warnings: z.array(z.string()).optional() })),
						},
					},
				},
				...errors,
			},
		}),
		async (c) => c.json({ data: await c.get("draftResources").validate(c.req.valid("param").name) }, 200),
	);
	app.openapi(
		createRoute({
			method: "post",
			path: `${basePath}/plan`,
			tags: ["admin-resource-draft"],
			request: {
				params,
				body: {
					content: {
						"application/json": {
							schema: z.object({
								action: z.literal("publish"),
								version_id: z.string().optional(),
							}),
						},
					},
				},
			},
			responses: {
				200: {
					description: "plan + 一次性确认令牌",
					content: { "application/json": { schema: data(ProjectPlanSchema) } },
				},
				...errors,
			},
		}),
		async (c) => {
			const { subject } = requireAdmin(c, c.get("services").config);
			const _body = c.req.valid("json");
			return c.json(
				{
					data: await c.get("draftResources").plan(c.req.valid("param").name, subject),
				},
				200,
			);
		},
	);
	app.openapi(
		createRoute({
			method: "post",
			path: `${basePath}/publish`,
			tags: ["admin-resource-draft"],
			request: { params, body: { content: { "application/json": { schema: execBody } } } },
			responses: {
				202: {
					description: "已受理为 Operation",
					content: { "application/json": { schema: data(z.object({ operation_id: z.string() })) } },
				},
				...errors,
			},
		}),
		async (c) => {
			const { subject } = requireAdmin(c, c.get("services").config);
			const body = c.req.valid("json");
			const result = await c.get("draftResources").execute(c.req.valid("param").name, body, subject);
			return c.json({ data: result }, 202);
		},
	);
	app.openapi(
		createRoute({
			method: "post",
			path: `${basePath}/declarations/{type}/{id}/preview`,
			tags: ["admin-resource-draft"],
			request: {
				params: params.extend({ type: z.string(), id: z.string() }),
				body: { content: { "application/json": { schema: DeclarationPreviewInputSchema } } },
			},
			responses: {
				200: {
					description: "已有声明修改或删除的 SDK 校验与差异预览",
					content: { "application/json": { schema: data(DeclarationPreviewSchema) } },
				},
				...errors,
			},
		}),
		async (context) => {
			const input = context.req.valid("param");
			return context.json(
				{
					data: await context
						.get("draftResources")
						.declarationPreview(input.name, input.type, input.id, context.req.valid("json")),
				},
				200,
			);
		},
	);
	app.openapi(
		createRoute({
			method: "put",
			path: `${basePath}/declarations/{type}/{id}`,
			tags: ["admin-resource-draft"],
			request: {
				params: params.extend({ type: z.string(), id: z.string() }),
				body: { content: { "application/json": { schema: DeclarationWriteSchema } } },
			},
			responses: {
				200: {
					description: "声明已更新",
					content: { "application/json": { schema: data(z.object({ new_revision: z.string() })) } },
				},
				...errors,
			},
		}),
		async (context) => {
			const { subject } = requireAdmin(context, context.get("services").config);
			const input = context.req.valid("param");
			return context.json(
				{
					data: await context
						.get("draftResources")
						.declarationPut(input.name, input.type, input.id, context.req.valid("json"), subject),
				},
				200,
			);
		},
	);
	app.openapi(
		createRoute({
			method: "delete",
			path: `${basePath}/declarations/{type}/{id}`,
			tags: ["admin-resource-draft"],
			request: {
				params: params.extend({ type: z.string(), id: z.string() }),
				body: { content: { "application/json": { schema: DeclarationDeleteSchema } } },
			},
			responses: {
				200: {
					description: "声明已删除（仅当前批次）",
					content: { "application/json": { schema: data(z.object({ new_revision: z.string() })) } },
				},
				...errors,
			},
		}),
		async (context) => {
			const { subject } = requireAdmin(context, context.get("services").config);
			const input = context.req.valid("param");
			return context.json(
				{
					data: await context
						.get("draftResources")
						.declarationDelete(input.name, input.type, input.id, context.req.valid("json").base_revision, subject),
				},
				200,
			);
		},
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/operations/{operationId}/events",
			tags: ["admin"],
			request: { params: z.object({ operationId: z.string() }) },
			responses: {
				200: {
					description: "Operation 进度 SSE（operation/done 帧）",
					content: { "text/event-stream": { schema: z.string() } },
				},
				...errors,
			},
		}),
		async (c) => {
			requireAdmin(c, c.get("services").config);
			const operationId = c.req.param("operationId");
			const operations = c.get("services").operations;
			if (!operations.get(operationId)) throw new KitError("not_found", "operation 不存在");
			return streamSSE(c, async (stream) => {
				const isTerminal = (view: { status: string } | null) =>
					view !== null && (view.status === "succeeded" || view.status === "failed" || view.status === "cancelled");
				const writeFrame = (view: unknown) => stream.write(encodeFrame({ type: "operation", data: view as never }));
				await new Promise<void>((resolve) => {
					let unsubscribe: (() => void) | null = null;
					const settle = async (view: unknown) => {
						await writeFrame(view);
						await stream.write(
							encodeFrame({
								type: "done",
								data: {
									session_id: operationId,
									status: (view as { status: string }).status,
									last_event_id: null,
									reason: "operation_closed",
								},
							}),
						);
						unsubscribe?.();
						resolve();
					};
					const current = operations.get(operationId);
					if (isTerminal(current)) {
						void settle(current);
						return;
					}
					void writeFrame(current);
					unsubscribe = operations.subscribe(operationId, (view) => {
						if (isTerminal(view)) void settle(view);
						else void writeFrame(view);
					});
					c.req.raw.signal.addEventListener(
						"abort",
						() => {
							unsubscribe?.();
							resolve();
						},
						{ once: true },
					);
				});
			});
		},
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/operations/{operationId}",
			tags: ["admin"],
			request: { params: z.object({ operationId: z.string() }) },
			responses: {
				200: { description: "Operation 详情", content: { "application/json": { schema: data(OperationViewSchema) } } },
				...errors,
			},
		}),
		(c) => {
			const view = c.get("services").operations.get(c.req.param("operationId"));
			if (!view) return c.json({ error: { code: "not_found", message: "operation 不存在" } }, 404);
			return c.json({ data: view }, 200);
		},
	);
}
