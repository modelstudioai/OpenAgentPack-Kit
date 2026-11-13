import { z } from "zod";

/** 员工端默认产品名；服务端首次启动与前端兜底共用，避免两处常量漂移。 */
export const DEFAULT_BRAND_PRODUCT_NAME = "OpenAgentPack Kit";

/** Logo 只允许 Web 本地路径（以 `/` 开头）或 http(s) 在线地址。 */
export const BrandLogoUrlSchema = z
	.string()
	.trim()
	.max(2048)
	.refine((value) => (value.startsWith("/") && !value.startsWith("//")) || /^https?:\/\//i.test(value), {
		message: "Logo 只支持以单个 / 开头的本站路径或 http(s) 在线地址",
	});

export const BRANDING_LOGO_MAX_BYTES = 512 * 1024;
export const BRANDING_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
export const BRANDING_LOGO_PATH = "/api/branding/logo";

export const BrandingUpdateSchema = z.object({
	productName: z.string().trim().min(1, "产品名称不能为空").max(60, "产品名称不能超过 60 个字符"),
	/** undefined 保持现有 Logo；null 清除；字符串切换到外部/本站 URL。 */
	logoUrl: BrandLogoUrlSchema.nullable().optional(),
});
export type BrandingUpdate = z.infer<typeof BrandingUpdateSchema>;

export const BrandingViewSchema = z.object({
	productName: z.string(),
	logoUrl: z.string().optional(),
	updatedAt: z.string(),
	updatedBy: z.string().optional(),
});
export type BrandingView = z.infer<typeof BrandingViewSchema>;
