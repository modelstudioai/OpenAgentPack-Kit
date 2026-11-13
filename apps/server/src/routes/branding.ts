import { createHash } from "node:crypto";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import {
	BRANDING_LOGO_MAX_BYTES,
	BRANDING_LOGO_PATH,
	BRANDING_LOGO_TYPES,
	BrandingUpdateSchema,
	type BrandingView,
	BrandingViewSchema,
	KitError,
} from "@openagentpack/kit-sdk/protocol";
import type { AppEnv, KitServices } from "../app-env.ts";
import { requireAdmin } from "../services/identity.ts";
import type { BrandingLogoMeta } from "../store/branding.ts";

const errorBody = z.object({
	error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean().optional() }),
});
const errors = {
	400: { description: "invalid_request", content: { "application/json": { schema: errorBody } } },
	401: { description: "管理端未认证", content: { "application/json": { schema: errorBody } } },
	403: { description: "forbidden", content: { "application/json": { schema: errorBody } } },
	413: { description: "Logo 超过上传上限", content: { "application/json": { schema: errorBody } } },
};

function logoUrl(logo: BrandingLogoMeta | null, fallback: string | null): string | undefined {
	if (logo) return `${BRANDING_LOGO_PATH}?v=${logo.hash}`;
	return fallback ?? undefined;
}

function viewOf(services: KitServices): BrandingView {
	const row = services.branding.get();
	const uploaded = services.branding.getLogoMeta();
	const url = logoUrl(uploaded, row.logo_url);
	return {
		productName: row.product_name,
		...(url ? { logoUrl: url } : {}),
		updatedAt: row.updated_at,
		...(row.updated_by ? { updatedBy: row.updated_by } : {}),
	};
}

/** 管理端维护员工端品牌；公开读取仍走 `/api/config`，上传图片由 `/api/branding/logo` 提供。 */
export function registerBrandingRoutes(app: OpenAPIHono<AppEnv>) {
	app.openapi(
		{
			method: "get",
			path: "/api/admin/branding",
			tags: ["admin"],
			responses: {
				200: {
					description: "员工端品牌配置",
					content: { "application/json": { schema: z.object({ data: BrandingViewSchema }) } },
				},
				...errors,
			},
		},
		(c) => c.json({ data: viewOf(c.get("services")) }, 200),
	);

	app.openapi(
		{
			method: "post",
			path: "/api/admin/branding/logo",
			tags: ["admin"],
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
					description: "Logo 已上传；员工端下次读取 `/api/config` 时生效",
					content: { "application/json": { schema: z.object({ data: BrandingViewSchema }) } },
				},
				...errors,
			},
		},
		async (c) => {
			const services = c.get("services");
			const { subject } = requireAdmin(c, services.config);
			const form = await c.req.formData();
			const file = form.get("file");
			if (!(file instanceof File) || form.getAll("file").length !== 1)
				throw new KitError("invalid_request", "请提供一个 Logo 图片文件");
			if (file.size > BRANDING_LOGO_MAX_BYTES)
				return c.json(
					{
						error: {
							code: "invalid_request",
							message: `Logo 不能超过 ${Math.floor(BRANDING_LOGO_MAX_BYTES / 1024)}KB`,
							retryable: false,
						},
					},
					413,
				);
			if (!(BRANDING_LOGO_TYPES as readonly string[]).includes(file.type))
				throw new KitError("invalid_request", "Logo 仅支持 PNG、JPEG、WebP 或 SVG");
			const bytes = new Uint8Array(await file.arrayBuffer());
			const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
			services.branding.saveLogo({ contentType: file.type, bytes, hash, updatedBy: subject });
			services.audit.append({
				subject,
				action: "branding.update",
				target: "employee-web",
				detail: { logoUploaded: true, contentType: file.type, bytes: file.size },
			});
			return c.json({ data: viewOf(services) }, 201);
		},
	);

	app.openapi(
		{
			method: "put",
			path: "/api/admin/branding",
			tags: ["admin"],
			request: {
				body: { content: { "application/json": { schema: BrandingUpdateSchema } } },
			},
			responses: {
				200: {
					description: "已保存；员工端下次读取 `/api/config` 时生效",
					content: { "application/json": { schema: z.object({ data: BrandingViewSchema }) } },
				},
				...errors,
			},
		},
		(c) => {
			const services = c.get("services");
			const { subject } = requireAdmin(c, services.config);
			const body = c.req.valid("json");
			services.branding.update({
				productName: body.productName,
				...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
				updatedBy: subject,
			});
			services.audit.append({
				subject,
				action: "branding.update",
				target: "employee-web",
				detail: { productName: body.productName, logoUrlChanged: body.logoUrl !== undefined },
			});
			return c.json({ data: viewOf(services) }, 200);
		},
	);

	// 上传图片是未受信任内容；直接打开 SVG 也必须禁止脚本、外链与同源权限。
	app.openapi(
		{
			method: "get",
			path: BRANDING_LOGO_PATH,
			tags: ["meta"],
			responses: {
				200: {
					description: "上传的 Logo 图片",
					content: { "image/*": { schema: z.string().openapi({ format: "binary" }) } },
				},
				404: { description: "Logo 不存在", content: { "application/json": { schema: errorBody } } },
			},
		},
		(c) => {
			const logo = c.get("services").branding.getLogo();
			if (!logo) return c.json({ error: { code: "not_found", message: "Logo 不存在", retryable: false } }, 404);
			return new Response(new Uint8Array(logo.bytes), {
				status: 200,
				headers: {
					"content-type": logo.content_type,
					"content-security-policy":
						"sandbox; default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
					"x-content-type-options": "nosniff",
					"cache-control": "public, max-age=31536000, immutable",
				},
			});
		},
	);
}
