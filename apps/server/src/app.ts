import { OpenAPIHono } from "@hono/zod-openapi";
import {
	isProtocolCompatible,
	KitError,
	PROTOCOL_VERSION,
	PROTOCOL_VERSION_HEADER,
	RESOURCE_DRAFT_KEY_HEADER,
} from "@openagentpack/kit-sdk/protocol";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { AppEnv, KitServices } from "./app-env.ts";
import { redactSecrets } from "./config.ts";
import { registerAdminRoutes } from "./routes/admin.ts";
import { registerAdminFileRoutes } from "./routes/admin-files.ts";
import { registerAdminMemoryStoreRoutes } from "./routes/admin-memory-stores.ts";
import { registerAdminVaultRoutes } from "./routes/admin-vaults.ts";
import { registerDebugRoutes } from "./routes/debug.ts";
import { registerDraftResourceRoutes } from "./routes/draft-resources.ts";
import { registerGroupRoutes } from "./routes/groups.ts";
import { registerKitRoutes } from "./routes/kit.ts";
import { registerMemberAuthRoutes } from "./routes/member-auth.ts";
import { registerMemberRoutes } from "./routes/members.ts";
import { registerMetaRoutes } from "./routes/meta.ts";
import { registerPresetPackRoutes } from "./routes/preset-packs.ts";
import { registerResourceDraftRoutes } from "./routes/resource-drafts.ts";
import { registerTemplateRoutes } from "./routes/templates.ts";
import { registerUsageLimitRoutes } from "./routes/usage-limits.ts";
import { createOriginMatcher, DEFAULT_CORS_ORIGINS } from "./services/cors.ts";
import { resolveAdminIdentity, resolveIdentity } from "./services/identity.ts";

export function createApp(services: KitServices) {
	const app = new OpenAPIHono<AppEnv>();

	// 白名单支持 loopback 端口通配（`http://127.0.0.1:*`），兼容本地静态服务的动态端口。
	const matchOrigin = createOriginMatcher(
		services.config.corsOrigins.length ? services.config.corsOrigins : DEFAULT_CORS_ORIGINS,
	);
	app.use(
		"*",
		cors({
			origin: (origin) => matchOrigin(origin),
			allowHeaders: ["content-type", "authorization", PROTOCOL_VERSION_HEADER, RESOURCE_DRAFT_KEY_HEADER],
			exposeHeaders: ["Content-Disposition", "Retry-After"],
			credentials: true,
		}),
	);

	/** 不需要身份的路由（探针与运行时公开配置）。 */
	const isPublicPath = (path: string) =>
		path === "/healthz" ||
		path === "/api/config" ||
		path === "/api/branding/logo" ||
		path === "/openapi.json" ||
		path === "/docs" ||
		path === "/api/kit/auth/login" ||
		path === "/api/kit/auth/logout";
	const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

	app.use("*", async (c, next) => {
		c.set("services", services);
		if (c.req.path.startsWith("/api/kit/auth/")) c.header("Cache-Control", "no-store");
		if (isPublicPath(c.req.path)) {
			await next();
			return;
		}
		if (c.req.path.startsWith("/api/admin")) {
			// 管理端：解析主体 + 角色闸门。放在中间件是为了「新增路由不可能漏掉这条规则」。
			const admin = resolveAdminIdentity(c, services.config);
			const readOnly = READ_ONLY_METHODS.has(c.req.method);
			if (admin.role !== "admin" && !readOnly) {
				services.metrics.count("kit_admin_writes_total", { role: admin.role, status: 403 });
				throw new KitError("forbidden", "auditor 是只读角色，不能执行写操作");
			}
			c.set("admin", admin);
			c.set("identity", { subjectId: admin.subject, tier: admin.role });
			if (readOnly) {
				await next();
				return;
			}
			try {
				await next();
			} finally {
				services.metrics.count("kit_admin_writes_total", { role: admin.role, status: c.res?.status ?? 500 });
			}
			return;
		}
		c.set("identity", resolveIdentity(c, services.config));
		await next();
	});

	app.use("/api/*", async (c, next) => {
		if (
			(c.req.path.startsWith("/api/kit/sessions/") || c.req.path.startsWith("/api/admin/debug/sessions/")) &&
			/\/(stream|messages|tool-approvals)$/.test(c.req.path) &&
			!isProtocolCompatible(c.req.header(PROTOCOL_VERSION_HEADER) ?? "")
		) {
			throw new KitError("conflict", "Kit 协议版本不兼容，请刷新或升级客户端");
		}
		await next();
	});

	// 请求体上限：JSON 与上传分开（上传另有 KIT_UPLOAD_MAX_BYTES 的业务校验）
	const tooLarge = (c: Context<AppEnv>) =>
		c.json({ error: { code: "invalid_request", message: "请求体超过上限", retryable: false } }, 413);
	const jsonLimit = bodyLimit({ maxSize: services.config.bodyLimitBytes, onError: tooLarge });
	const uploadLimit = bodyLimit({ maxSize: services.config.uploadMaxBytes + 4096, onError: tooLarge });
	app.use("/api/*", (c, next) =>
		["/api/kit/files", "/api/admin/debug/files", "/api/admin/branding/logo"].includes(c.req.path) ||
		/^\/api\/admin\/resource-drafts\/[^/]+\/resources\/(?:file|skill)-uploads$/.test(c.req.path)
			? uploadLimit(c, next)
			: jsonLimit(c, next),
	);

	// 限流：按身份计令牌桶；超限 429 rate_limited（可重试）+ retry-after。
	// 公开路由（/api/config）没有身份，不参与限流：它是静态小响应，且被所有端启动时读取。
	app.use("/api/*", async (c, next) => {
		const subjectId = c.get("identity")?.subjectId;
		if (!subjectId) {
			await next();
			return;
		}
		const verdict = services.limiter.take(subjectId);
		if (!verdict.ok) {
			services.metrics.count("kit_rate_limited_total", { route: c.req.routePath ?? c.req.path });
			c.header("retry-after", String(verdict.retryAfterSeconds));
			throw new KitError("rate_limited", `请求过于频繁，请 ${verdict.retryAfterSeconds}s 后重试`, {
				retryable: true,
			});
		}
		await next();
	});

	// 指标：路由模板做 label（避免按具体 id 爆炸），错误单独计数
	app.use("*", async (c, next) => {
		try {
			await next();
		} finally {
			const route = c.req.routePath ?? c.req.path;
			const status = c.res?.status ?? 500;
			services.metrics.count("kit_http_requests_total", { route, method: c.req.method, status });
			if (status >= 400) services.metrics.count("kit_http_request_errors_total", { route, status });
		}
	});

	registerMetaRoutes(app);
	registerKitRoutes(app);
	registerMemberAuthRoutes(app);
	registerAdminRoutes(app);
	registerPresetPackRoutes(app);
	registerAdminFileRoutes(app);
	registerAdminMemoryStoreRoutes(app);
	registerAdminVaultRoutes(app);
	registerMemberRoutes(app);
	registerGroupRoutes(app);
	registerTemplateRoutes(app);
	registerUsageLimitRoutes(app);
	registerResourceDraftRoutes(app);
	registerDraftResourceRoutes(app);
	registerDebugRoutes(app);

	app.doc("/openapi.json", {
		openapi: "3.1.0",
		info: { title: "OpenAgentPack Kit Server", version: PROTOCOL_VERSION },
		// tag 描述会出现在文档站侧栏分组与页面头部（fumadocs-openapi 按 tag 分组）
		tags: [
			{ name: "meta", description: "探针与运行时公开配置（不需要身份）" },
			{ name: "kit", description: "数据面：终端用户的目录、会话、消息、流与文件" },
			{ name: "admin", description: "控制面：上架目录、审计与指标（ADMIN_TOKEN）" },
			{ name: "admin-debug", description: "控制面：已发布 Agent 的管理员调试会话与文件" },
		],
	});

	app.onError((error, c) => {
		if (error instanceof KitError) {
			return c.json(
				{
					error: {
						code: error.code,
						message: redactSecrets(error.message),
						// details 是结构化业务上下文（如 quota_exceeded 的余额），不含凭据与事件正文
						...(error.details !== undefined ? { details: error.details } : {}),
						retryable: error.retryable,
					},
				},
				error.status as 400,
			);
		}
		console.error("[kit-server]", redactSecrets(error instanceof Error ? error.message : String(error)));
		return c.json({ error: { code: "internal", message: "服务端内部错误", retryable: false } }, 500);
	});

	app.notFound((c) => c.json({ error: { code: "not_found", message: "路由不存在", retryable: false } }, 404));

	return app;
}

export type { AppEnv, KitServices };
