import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
	KitError,
	MemberUsageLimitViewSchema,
	TemplateUsageLimitViewSchema,
	UsageLimitConfigSchema,
	UsageLimitPolicySchema,
} from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";
import { requireAdminWrite } from "../services/identity.ts";

const errorBody = z.object({ error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }) });
const errors = {
	400: { description: "限额必须是非负有效数值或 null", content: { "application/json": { schema: errorBody } } },
	401: { description: "身份未认证", content: { "application/json": { schema: errorBody } } },
	403: { description: "无管理权限或只读身份不能修改", content: { "application/json": { schema: errorBody } } },
	404: { description: "成员不存在", content: { "application/json": { schema: errorBody } } },
};
const params = z.object({ memberId: z.string().min(1).max(128) });
const body = { required: true, content: { "application/json": { schema: UsageLimitConfigSchema } } } as const;
/** 每日用量窗口（天）：1..400（年维度热力一次查询近 53 周），缺省 30；两个 kit 读接口共用。 */
export const dailyWindowQuery = z.coerce.number().int().min(1).max(400).optional().default(30);
const policyResponse = {
	200: {
		description: "默认成员月度限额",
		content: { "application/json": { schema: z.object({ data: UsageLimitPolicySchema }) } },
	},
	...errors,
};
const memberResponse = {
	200: {
		description: "成员生效月度限额与增量计量状态",
		content: { "application/json": { schema: z.object({ data: MemberUsageLimitViewSchema }) } },
	},
	...errors,
};

function validate(result: { success: boolean }) {
	if (!result.success)
		throw new KitError("invalid_request", "Token 限额须为非负整数，运行时长须为非负秒数；null 表示不限量");
	return undefined;
}

export function registerUsageLimitRoutes(app: OpenAPIHono<AppEnv>) {
	app.use("/api/admin/usage-limits/*", async (c, next) => {
		c.header("Cache-Control", "no-store");
		await next();
	});
	app.use("/api/kit/usage-limits", async (c, next) => {
		c.header("Cache-Control", "no-store");
		await next();
	});
	app.openapi(
		createRoute({ method: "get", path: "/api/admin/usage-limits/policy", tags: ["admin"], responses: policyResponse }),
		(c) => c.json({ data: c.get("services").usageLimits.policy() }, 200),
	);
	app.openapi(
		createRoute({
			method: "put",
			path: "/api/admin/usage-limits/policy",
			tags: ["admin"],
			request: { body },
			responses: policyResponse,
		}),
		(c) => {
			const { usageLimits, config } = c.get("services");
			const { subject } = requireAdminWrite(c, config);
			return c.json({ data: usageLimits.setPolicy(c.req.valid("json"), subject) }, 200);
		},
		validate,
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/members/{memberId}/usage-limit",
			tags: ["admin"],
			request: { params },
			responses: memberResponse,
		}),
		async (c) => c.json({ data: await c.get("services").usageLimits.member(c.req.valid("param").memberId) }, 200),
	);
	app.openapi(
		createRoute({
			method: "put",
			path: "/api/admin/members/{memberId}/usage-limit",
			tags: ["admin"],
			request: { params, body },
			responses: memberResponse,
		}),
		async (c) => {
			const { usageLimits, config } = c.get("services");
			const { subject } = requireAdminWrite(c, config);
			return c.json(
				{ data: await usageLimits.setMember(c.req.valid("param").memberId, c.req.valid("json"), subject) },
				200,
			);
		},
		validate,
	);
	app.openapi(
		createRoute({
			method: "delete",
			path: "/api/admin/members/{memberId}/usage-limit",
			tags: ["admin"],
			request: { params },
			responses: memberResponse,
		}),
		async (c) => {
			const { usageLimits, config } = c.get("services");
			const { subject } = requireAdminWrite(c, config);
			return c.json({ data: await usageLimits.resetMember(c.req.valid("param").memberId, subject) }, 200);
		},
	);
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/kit/usage-limits",
			tags: ["kit"],
			request: {
				query: z.object({ days: dailyWindowQuery }),
			},
			responses: {
				200: {
					description: "当前本地成员月度额度（daily 为最近 days 天逐日增量，缺省 30、最多 400）；匿名与外部身份为 null",
					content: { "application/json": { schema: z.object({ data: MemberUsageLimitViewSchema.nullable() }) } },
				},
				...errors,
			},
		}),
		async (c) => {
			const { usageLimits } = c.get("services");
			const subjectId = c.get("identity").subjectId;
			const { days } = c.req.valid("query");
			return c.json(
				{ data: usageLimits.isMember(subjectId) ? await usageLimits.member(subjectId, { dailyDays: days }) : null },
				200,
			);
		},
	);
	const templateParams = z.object({ templateId: z.string().min(1).max(128) });
	const templateResponse = {
		200: {
			description: "模版生效月度限额与条目累计状态（未设置覆盖时不限量）",
			content: { "application/json": { schema: z.object({ data: TemplateUsageLimitViewSchema }) } },
		},
		...errors,
	};
	app.openapi(
		createRoute({
			method: "get",
			path: "/api/admin/usage/templates/{templateId}/usage-limit",
			tags: ["admin"],
			request: { params: templateParams },
			responses: templateResponse,
		}),
		(c) => {
			const { usageLimits, templates } = c.get("services");
			templates.get(c.req.valid("param").templateId);
			return c.json({ data: usageLimits.template(c.req.valid("param").templateId) }, 200);
		},
	);
	app.openapi(
		createRoute({
			method: "put",
			path: "/api/admin/usage/templates/{templateId}/usage-limit",
			tags: ["admin"],
			request: { params: templateParams, body },
			responses: templateResponse,
		}),
		(c) => {
			const { usageLimits, templates, config } = c.get("services");
			const { subject } = requireAdminWrite(c, config);
			templates.get(c.req.valid("param").templateId);
			return c.json(
				{ data: usageLimits.setTemplate(c.req.valid("param").templateId, c.req.valid("json"), subject) },
				200,
			);
		},
		validate,
	);
	app.openapi(
		createRoute({
			method: "delete",
			path: "/api/admin/usage/templates/{templateId}/usage-limit",
			tags: ["admin"],
			request: { params: templateParams },
			responses: templateResponse,
		}),
		(c) => {
			const { usageLimits, templates, config } = c.get("services");
			const { subject } = requireAdminWrite(c, config);
			templates.get(c.req.valid("param").templateId);
			return c.json({ data: usageLimits.resetTemplate(c.req.valid("param").templateId, subject) }, 200);
		},
	);
}
