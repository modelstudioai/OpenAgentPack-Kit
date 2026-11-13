import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { BRANDING_LOGO_PATH, PROTOCOL_VERSION } from "@openagentpack/kit-sdk/protocol";
import type { AppEnv } from "../app-env.ts";

export function registerMetaRoutes(app: OpenAPIHono<AppEnv>) {
	app.openapi(
		{
			method: "get",
			path: "/healthz",
			tags: ["meta"],
			responses: {
				200: {
					description: "存活探针",
					content: { "application/json": { schema: z.object({ ok: z.boolean(), gateway: z.string() }) } },
				},
			},
		},
		(c) => c.json({ ok: true, gateway: c.get("services").gateway.mode }, 200),
	);

	/** 运行时公开配置：所有端启动必读，禁止假设同源（docs/architecture.md）。 */
	app.openapi(
		{
			method: "get",
			path: "/api/config",
			tags: ["meta"],
			responses: {
				200: {
					description: "运行时公开配置",
					content: {
						"application/json": {
							schema: z.object({
								data: z.object({
									apiBaseUrl: z.string(),
									protocolVersion: z.string(),
									gateway: z.enum(["sdk", "mock"]),
									auth: z.object({ mode: z.enum(["member", "anonymous"]), passwordLogin: z.literal(true) }),
									capabilities: z.object({
										streaming: z.boolean(),
										fileUpload: z.boolean(),
										artifacts: z.boolean(),
										threads: z.boolean(),
									}),
									branding: z.object({
										productName: z.string(),
										logoUrl: z.string().optional(),
										accent: z.string().optional(),
									}),
								}),
							}),
						},
					},
				},
			},
		},
		(c) => {
			// 空串 = 与访问者同源（反代或自定义宿主场景）；仅 KIT_PUBLIC_BASE_URL 显式覆盖
			const services = c.get("services");
			const origin = services.config.publicBaseUrl;
			const branding = services.branding.get();
			const uploaded = services.branding.getLogoMeta();
			const logoUrl = uploaded ? `${BRANDING_LOGO_PATH}?v=${uploaded.hash}` : branding.logo_url;
			return c.json(
				{
					data: {
						apiBaseUrl: origin,
						protocolVersion: PROTOCOL_VERSION,
						gateway: services.gateway.mode,
						auth: { mode: services.config.authMode, passwordLogin: true as const },
						capabilities: { streaming: true, fileUpload: true, artifacts: true, threads: true },
						branding: {
							productName: branding.product_name,
							...(logoUrl ? { logoUrl } : {}),
						},
					},
				},
				200,
			);
		},
	);
}
