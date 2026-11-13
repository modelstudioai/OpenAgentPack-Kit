import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
	ApplyRequestSchema,
	GroupInputSchema,
	GroupMembershipQuerySchema,
	GroupMembersPageSchema,
	GroupMembersPatchSchema,
	GroupsPageSchema,
	GroupsQuerySchema,
	GroupViewSchema,
	KitError,
	MemberGroupsPageSchema,
	MemberGroupsPatchSchema,
	PlanResponseSchema,
} from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";
import { requireAdmin } from "../services/identity.ts";

const errorBody = z.object({ error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }) });
const errors = {
	400: { description: "用户组参数或分页游标无效", content: { "application/json": { schema: errorBody } } },
	401: { description: "管理端未认证", content: { "application/json": { schema: errorBody } } },
	403: { description: "管理端令牌无效或 auditor 写入被拒绝", content: { "application/json": { schema: errorBody } } },
	404: { description: "用户组或成员不存在", content: { "application/json": { schema: errorBody } } },
	409: {
		description: "名称已存在或删除计划的组与成员关系已变化",
		content: { "application/json": { schema: errorBody } },
	},
	428: { description: "缺少有效的一次性删除确认令牌", content: { "application/json": { schema: errorBody } } },
};
const groupParams = z.object({ groupId: z.string().min(1) });
const memberParams = z.object({ memberId: z.string().min(1) });
const groupResponse = {
	description: "用户组资料",
	content: { "application/json": { schema: z.object({ data: GroupViewSchema }) } },
};
const body = <T extends z.ZodType>(schema: T) => ({ required: true, content: { "application/json": { schema } } });
const tags = ["admin"];
function rejectInvalid(result: { success: boolean; error?: { issues: { message: string }[] } }): undefined {
	if (!result.success)
		throw new KitError("invalid_request", result.error?.issues[0]?.message ?? "用户组参数或分页游标无效");
	return undefined;
}

export function registerGroupRoutes(app: OpenAPIHono<AppEnv>) {
	app.use("/api/admin/members/:memberId/groups", async (c, next) => {
		c.header("Cache-Control", "no-store");
		await next();
	});
	app.use("/api/admin/groups", async (c, next) => {
		c.header("Cache-Control", "no-store");
		await next();
	});
	app.use("/api/admin/groups/*", async (c, next) => {
		c.header("Cache-Control", "no-store");
		await next();
	});
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/groups",
			tags,
			request: { query: GroupsQuerySchema },
			responses: {
				200: { description: "用户组分页列表", content: { "application/json": { schema: GroupsPageSchema } } },
				...errors,
			},
		}),
		(c) => c.json(c.get("services").groups.list(c.req.valid("query")), 200),
		rejectInvalid,
	);
	app.openapi(
		createRoute({
			method: "post",
			path: "/api/admin/groups",
			tags,
			request: { body: body(GroupInputSchema) },
			responses: { 201: groupResponse, ...errors },
		}),
		(c) => {
			const services = c.get("services");
			return c.json(
				{ data: services.groups.create(c.req.valid("json"), requireAdmin(c, services.config).subject) },
				201,
			);
		},
		rejectInvalid,
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/groups/{groupId}",
			tags,
			request: { params: groupParams },
			responses: { 200: groupResponse, ...errors },
		}),
		(c) => c.json({ data: c.get("services").groups.get(c.req.valid("param").groupId) }, 200),
		rejectInvalid,
	);
	app.openapi(
		createRoute({
			method: "patch",
			path: "/api/admin/groups/{groupId}",
			tags,
			request: { params: groupParams, body: body(GroupInputSchema) },
			responses: { 200: groupResponse, ...errors },
		}),
		(c) => {
			const services = c.get("services");
			return c.json(
				{
					data: services.groups.update(
						c.req.valid("param").groupId,
						c.req.valid("json"),
						requireAdmin(c, services.config).subject,
					),
				},
				200,
			);
		},
		rejectInvalid,
	);
	app.openapi(
		createRoute({
			method: "post",
			path: "/api/admin/groups/{groupId}/plan",
			tags,
			request: { params: groupParams, body: body(z.object({ action: z.literal("delete") })) },
			responses: {
				200: {
					description: "删除影响与一次性确认令牌",
					content: { "application/json": { schema: z.object({ data: PlanResponseSchema }) } },
				},
				...errors,
			},
		}),
		async (c) => {
			const services = c.get("services");
			return c.json(
				{
					data: await services.groups.planDelete(
						c.req.valid("param").groupId,
						requireAdmin(c, services.config).subject,
					),
				},
				200,
			);
		},
		rejectInvalid,
	);
	app.openapi(
		createRoute({
			method: "delete",
			path: "/api/admin/groups/{groupId}",
			tags,
			request: {
				params: groupParams,
				body: { content: { "application/json": { schema: ApplyRequestSchema.partial().default({}) } } },
			},
			responses: {
				200: {
					description: "仅删除用户组及成员关联",
					content: { "application/json": { schema: z.object({ data: z.object({ deleted: z.literal(true) }) }) } },
				},
				...errors,
			},
		}),
		async (c) => {
			const services = c.get("services");
			return c.json(
				{
					data: await services.groups.remove(
						c.req.valid("param").groupId,
						c.req.valid("json"),
						requireAdmin(c, services.config).subject,
					),
				},
				200,
			);
		},
		rejectInvalid,
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/groups/{groupId}/members",
			tags,
			request: { params: groupParams, query: GroupMembershipQuerySchema },
			responses: {
				200: {
					description: "已加入、未加入或全部成员候选的分页列表",
					content: { "application/json": { schema: GroupMembersPageSchema } },
				},
				...errors,
			},
		}),
		(c) => c.json(c.get("services").groups.groupMembers(c.req.valid("param").groupId, c.req.valid("query")), 200),
		rejectInvalid,
	);
	app.openapi(
		createRoute({
			method: "patch",
			path: "/api/admin/groups/{groupId}/members",
			tags,
			request: { params: groupParams, body: body(GroupMembersPatchSchema) },
			responses: { 200: groupResponse, ...errors },
		}),
		(c) => {
			const services = c.get("services");
			return c.json(
				{
					data: services.groups.updateGroupMembers(
						c.req.valid("param").groupId,
						c.req.valid("json"),
						requireAdmin(c, services.config).subject,
					),
				},
				200,
			);
		},
		rejectInvalid,
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/members/{memberId}/groups",
			tags,
			request: { params: memberParams, query: GroupMembershipQuerySchema },
			responses: {
				200: {
					description: "用户所属或候选用户组的分页列表",
					content: { "application/json": { schema: MemberGroupsPageSchema } },
				},
				...errors,
			},
		}),
		(c) => c.json(c.get("services").groups.memberGroups(c.req.valid("param").memberId, c.req.valid("query")), 200),
		rejectInvalid,
	);
	app.openapi(
		createRoute({
			method: "patch",
			path: "/api/admin/members/{memberId}/groups",
			tags,
			request: { params: memberParams, body: body(MemberGroupsPatchSchema) },
			responses: {
				200: {
					description: "用户的组关联已更新",
					content: { "application/json": { schema: z.object({ data: z.object({ updated: z.literal(true) }) }) } },
				},
				...errors,
			},
		}),
		(c) => {
			const services = c.get("services");
			return c.json(
				{
					data: services.groups.updateMemberGroups(
						c.req.valid("param").memberId,
						c.req.valid("json"),
						requireAdmin(c, services.config).subject,
					),
				},
				200,
			);
		},
		rejectInvalid,
	);
}
