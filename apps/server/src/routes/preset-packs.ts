import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
	KitError,
	PresetPackAgentResourcesSchema,
	PresetPackCreateInputSchema,
	PresetPackPreviewSchema,
	PresetPacksPageSchema,
	PresetPacksQuerySchema,
	PresetPackViewSchema,
} from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";

/** 发现与保存资源引用，不提供会话事件或资源内容，也不发布 Provider 资源。 */
export function registerPresetPackRoutes(app: OpenAPIHono<AppEnv>) {
	for (const path of ["/api/admin/preset-packs", "/api/admin/preset-packs/*"]) {
		app.use(path, async (c, next) => {
			c.header("Cache-Control", "no-store");
			await next();
		});
	}
	const savedResponse = {
		description: "已保存的智能体版本与资源引用，可在创建页重新读取",
		content: { "application/json": { schema: z.object({ data: PresetPackViewSchema }) } },
	};
	app.openapi(
		createRoute({
			method: "post",
			path: "/api/admin/preset-packs/preview",
			tags: ["admin"],
			request: { body: { required: true, content: { "application/json": { schema: PresetPackCreateInputSchema } } } },
			responses: {
				200: {
					description: "核验所选智能体与资源并返回可回填配置，不保存预设包",
					content: { "application/json": { schema: z.object({ data: PresetPackPreviewSchema }) } },
				},
				400: { description: "选择或创建页配置无效" },
				401: { description: "管理端未认证" },
				403: { description: "审计员不可准备创建配置" },
				404: { description: "智能体不可访问" },
				409: { description: "资源已变化或不可用" },
				502: { description: "Provider 核验失败" },
			},
		}),
		async (c) =>
			c.json({ data: await c.get("services").presetPacks.preview(c.req.valid("json"), c.req.raw.signal) }, 200),
		(result) => {
			if (!result.success) throw new KitError("invalid_request", "预设包参数无效");
			return undefined;
		},
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/preset-packs",
			tags: ["admin"],
			request: { query: PresetPacksQuerySchema },
			responses: {
				200: {
					description: "已保存预设包的分页摘要，仅查询本地配置目录",
					content: { "application/json": { schema: PresetPacksPageSchema } },
				},
				400: { description: "分页或搜索参数无效" },
				401: { description: "管理端未认证" },
			},
		}),
		(c) => c.json(c.get("services").presetPacks.list(c.req.valid("query")), 200),
		(result) => {
			if (!result.success) throw new KitError("invalid_request", "预设包查询参数无效");
			return undefined;
		},
	);
	app.openapi(
		createRoute({
			method: "post",
			path: "/api/admin/preset-packs",
			tags: ["admin"],
			request: { body: { required: true, content: { "application/json": { schema: PresetPackCreateInputSchema } } } },
			responses: {
				201: savedResponse,
				400: { description: "参数、资源数量或创建页不支持的配置" },
				401: { description: "管理端未认证" },
				403: { description: "审计员不可保存预设包" },
				404: { description: "智能体不存在或不可访问" },
				409: { description: "所选资源已变化或不再可用" },
				502: { description: "Provider 资源核验失败" },
			},
		}),
		async (c) =>
			c.json({ data: await c.get("services").presetPacks.create(c.req.valid("json"), c.req.raw.signal) }, 201),
		(result) => {
			if (!result.success) throw new KitError("invalid_request", "预设包参数无效");
			return undefined;
		},
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/preset-packs/{presetId}",
			tags: ["admin"],
			request: { params: z.object({ presetId: z.string().regex(/^preset_[0-9a-f-]{36}$/) }) },
			responses: {
				200: savedResponse,
				400: { description: "预设包 ID 无效" },
				401: { description: "管理端未认证" },
				404: { description: "预设包不存在" },
			},
		}),
		(c) => c.json({ data: c.get("services").presetPacks.get(c.req.valid("param").presetId) }, 200),
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/preset-packs/agents/{agentId}/resources",
			tags: ["admin"],
			request: { params: z.object({ agentId: z.string().regex(/^[A-Za-z0-9_-]+$/) }) },
			responses: {
				200: {
					description: "指定智能体的全部可见会话及资源引用；complete 标记是否全部读取成功",
					content: { "application/json": { schema: z.object({ data: PresetPackAgentResourcesSchema }) } },
				},
				400: { description: "智能体 ID 无效" },
				401: { description: "管理端未认证" },
				404: { description: "智能体不存在或不可访问" },
				502: { description: "会话列表读取失败" },
			},
		}),
		async (c) => {
			c.header("Cache-Control", "no-store");
			const { agentId } = c.req.valid("param");
			return c.json(
				{ data: await c.get("services").gateway.getPresetPackAgentResources(agentId, c.req.raw.signal) },
				200,
			);
		},
	);
}
