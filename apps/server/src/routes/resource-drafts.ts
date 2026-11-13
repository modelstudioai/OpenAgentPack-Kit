import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
	KitError,
	RESOURCE_DRAFT_KEY_HEADER,
	ResourceDraftDiscardResultSchema,
	ResourceDraftOwnershipHeadersSchema,
	ResourceDraftViewSchema,
} from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";

const errorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const errors = Object.fromEntries(
	[400, 401, 403, 404, 409].map((code) => [
		code,
		{
			description: "参数、身份、批次归属或发布状态不满足要求",
			content: { "application/json": { schema: errorBody } },
		},
	]),
);
const response = {
	description: "一次性资源发布批次",
	content: { "application/json": { schema: z.object({ data: ResourceDraftViewSchema }) } },
};
const params = z.object({ draftId: z.string() });

function draftResponseData(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(draftResponseData);
	if (!value || typeof value !== "object") return value;
	const result = { ...value } as Record<string, unknown>;
	for (const key of ["source_path", "owner_agent", "config_path", "state_path", "project_root"]) delete result[key];
	for (const key of ["agent", "environment", "memory_store", "vault"]) {
		if (result[key] && typeof result[key] === "object") result[key] = draftResponseData(result[key]);
	}
	return result;
}

async function filterDraftResponse(context: { res: Response }) {
	if (!context.res.ok || !context.res.headers.get("content-type")?.includes("application/json")) return;
	const body = (await context.res.clone().json()) as { data?: unknown };
	const headers = new Headers(context.res.headers);
	headers.delete("content-length");
	context.res = new Response(JSON.stringify({ ...body, data: draftResponseData(body.data) }), {
		status: context.res.status,
		headers,
	});
}

export function registerResourceDraftRoutes(app: OpenAPIHono<AppEnv>) {
	app.use("/api/admin/operations/*", async (c, next) => {
		const id = c.req.path.split("/")[4];
		if (id && !c.get("services").resourceDrafts.canReadOperation(id, c.get("admin").subject))
			throw new KitError("not_found", "operation 不存在");
		await next();
	});
	// 统一身份/角色鉴权后，为当前请求绑定独立的 YAML 批次资源服务。
	app.use("/api/admin/*", async (c, next) => {
		const match = /^\/api\/admin\/resource-drafts\/([^/]+)\/resources(.*)$/.exec(c.req.path);
		if (match) {
			const name = decodeURIComponent(match[1]!);
			if (!name.startsWith("draft_")) throw new KitError("not_found", "资源发布批次不存在");
			const services = c.get("services");
			const scoped = await services.resourceDrafts.resourcesFor(name, c.get("admin").subject, c.req.method, match[2]!);
			if ("published" in scoped) return c.json({ data: scoped.published }, 200);
			c.set("draftResources", scoped);
		}
		await next();
		if (match) await filterDraftResponse(c);
	});
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/resource-drafts/active",
			tags: ["admin-resource-draft"],
			request: { headers: ResourceDraftOwnershipHeadersSchema },
			responses: {
				200: {
					description: "本人未完成或待清理批次",
					content: { "application/json": { schema: z.object({ data: ResourceDraftViewSchema.nullable() }) } },
				},
				...errors,
			},
		}),
		(c) => {
			c.header("Cache-Control", "no-store");
			return c.json(
				{
					data: c
						.get("services")
						.resourceDrafts.active(c.get("admin").subject, c.req.valid("header")[RESOURCE_DRAFT_KEY_HEADER]),
				},
				200,
			);
		},
	);
	app.openapi(
		createRoute({
			method: "post",
			path: "/api/admin/resource-drafts",
			tags: ["admin-resource-draft"],
			request: { headers: ResourceDraftOwnershipHeadersSchema },
			responses: { 200: response, ...errors },
		}),
		async (c) => {
			c.header("Cache-Control", "no-store");
			return c.json(
				{
					data: await c
						.get("services")
						.resourceDrafts.create(c.get("admin").subject, c.req.valid("header")[RESOURCE_DRAFT_KEY_HEADER]),
				},
				200,
			);
		},
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/resource-drafts/{draftId}",
			tags: ["admin-resource-draft"],
			request: { params },
			responses: { 200: response, ...errors },
		}),
		(c) => {
			c.header("Cache-Control", "no-store");
			return c.json(
				{ data: c.get("services").resourceDrafts.get(c.req.valid("param").draftId, c.get("admin").subject) },
				200,
			);
		},
	);
	app.openapi(
		createRoute({
			method: "post",
			path: "/api/admin/resource-drafts/{draftId}/discard",
			tags: ["admin-resource-draft"],
			request: { params, headers: ResourceDraftOwnershipHeadersSchema },
			responses: {
				200: {
					description: "丢弃本人尚未开始远端发布的本地批次",
					content: { "application/json": { schema: z.object({ data: ResourceDraftDiscardResultSchema }) } },
				},
				...errors,
			},
		}),
		async (c) => {
			c.header("Cache-Control", "no-store");
			return c.json(
				{
					data: await c
						.get("services")
						.resourceDrafts.discard(
							c.req.valid("param").draftId,
							c.get("admin").subject,
							c.req.valid("header")[RESOURCE_DRAFT_KEY_HEADER],
						),
				},
				200,
			);
		},
	);
	app.openapi(
		createRoute({
			method: "post",
			path: "/api/admin/resource-drafts/{draftId}/finalize",
			tags: ["admin-resource-draft"],
			request: { params },
			responses: { 200: response, ...errors },
		}),
		async (c) => {
			c.header("Cache-Control", "no-store");
			return c.json(
				{ data: await c.get("services").resourceDrafts.finalize(c.req.valid("param").draftId, c.get("admin").subject) },
				200,
			);
		},
	);
}
