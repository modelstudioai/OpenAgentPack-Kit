import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
	AdminMembersPageSchema,
	CreateMemberRequestSchema,
	CreateMemberResponseSchema,
	KitError,
	MemberSessionsPageSchema,
	MemberSessionsQuerySchema,
	MembersQuerySchema,
	MemberUsageQuerySchema,
	MemberUsageResponseSchema,
	MemberViewSchema,
} from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";
import { requireAdmin } from "../services/identity.ts";

const errorBody = z.object({ error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }) });
const errors = {
	400: { description: "成员参数或分页游标无效", content: { "application/json": { schema: errorBody } } },
	401: { description: "管理端未认证", content: { "application/json": { schema: errorBody } } },
	403: { description: "管理端令牌无效或 auditor 写入被拒绝", content: { "application/json": { schema: errorBody } } },
	404: { description: "成员不存在", content: { "application/json": { schema: errorBody } } },
	409: { description: "用户名已存在（不区分大小写）", content: { "application/json": { schema: errorBody } } },
};

export function registerMemberRoutes(app: OpenAPIHono<AppEnv>) {
	// 包含一次性密码的响应及校验错误均不可缓存。
	app.use("/api/admin/members", async (c, next) => {
		c.header("Cache-Control", "no-store");
		await next();
	});
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/members",
			tags: ["admin"],
			request: { query: MembersQuerySchema },
			responses: {
				200: { description: "成员目录", content: { "application/json": { schema: AdminMembersPageSchema } } },
				...errors,
			},
		}),
		(c) => {
			const { members, memberUsage, groups } = c.get("services");
			const page = members.list(c.req.valid("query"));
			const groupSummaries = groups.summaries(page.data.map((member) => member.member_id));
			return c.json(
				{
					...page,
					data: page.data.map((member) => ({
						...member,
						groups: groupSummaries.get(member.member_id) ?? [],
						usage_summary: memberUsage.summary(member.member_id),
					})),
				},
				200,
			);
		},
		(result) => {
			if (!result.success) throw new KitError("invalid_request", "成员查询参数无效");
			return undefined;
		},
	);
	app.openapi(
		createRoute({
			method: "post",
			path: "/api/admin/members",
			tags: ["admin"],
			request: { body: { required: true, content: { "application/json": { schema: CreateMemberRequestSchema } } } },
			responses: {
				201: {
					description: "已创建；仅自动生成模式返回一次初始密码",
					content: { "application/json": { schema: CreateMemberResponseSchema } },
				},
				...errors,
			},
		}),
		async (c) => {
			const { members, config } = c.get("services");
			const { subject } = requireAdmin(c, config);
			return c.json({ data: await members.create(c.req.valid("json"), subject) }, 201);
		},
		(result) => {
			// Zod 的默认错误对象可能带原始 data；只保留 schema 固定文案，不返回值或 details。
			if (!result.success) throw new KitError("invalid_request", result.error.issues[0]?.message ?? "成员参数无效");
			return undefined;
		},
	);
	app.use("/api/admin/members/*", async (c, next) => {
		c.header("Cache-Control", "no-store");
		await next();
	});
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/members/{memberId}",
			tags: ["admin"],
			request: { params: z.object({ memberId: z.string().min(1) }) },
			responses: {
				200: {
					description: "成员公开资料，不含凭据",
					content: { "application/json": { schema: z.object({ data: MemberViewSchema }) } },
				},
				...errors,
			},
		}),
		(c) => c.json({ data: c.get("services").members.get(c.req.valid("param").memberId) }, 200),
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/members/{memberId}/usage",
			tags: ["admin"],
			request: { params: z.object({ memberId: z.string().min(1) }), query: MemberUsageQuerySchema },
			responses: {
				200: {
					description: "成员累计会话用量；刷新在后台进行",
					content: { "application/json": { schema: MemberUsageResponseSchema } },
				},
				...errors,
			},
		}),
		(c) =>
			c.json({ data: c.get("services").memberUsage.summary(c.req.valid("param").memberId, c.req.valid("query")) }, 200),
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/members/{memberId}/sessions",
			tags: ["admin"],
			request: { params: z.object({ memberId: z.string().min(1) }), query: MemberSessionsQuerySchema },
			responses: {
				200: {
					description: "成员会话用量明细，含已删除快照",
					content: { "application/json": { schema: MemberSessionsPageSchema } },
				},
				...errors,
			},
		}),
		(c) => c.json(c.get("services").memberUsage.list(c.req.valid("param").memberId, c.req.valid("query")), 200),
	);
}
