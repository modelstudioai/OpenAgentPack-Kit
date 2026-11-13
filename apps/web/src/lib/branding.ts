import { BRANDING_LOGO_PATH, DEFAULT_BRAND_PRODUCT_NAME } from "@openagentpack/kit-sdk/protocol";

export interface Branding {
	productName: string;
	logoUrl?: string;
}

export interface BrandingConfigInput {
	productName?: string;
	logoUrl?: string;
}

export { DEFAULT_BRAND_PRODUCT_NAME };

/** 员工端品牌来自服务端 `/api/config`；上传 Logo 按 API base 解析，在线 URL 与本站路径原样使用。 */
export function brandingFromConfig(input?: BrandingConfigInput | null, baseUrl?: string): Branding {
	const productName = (input?.productName ?? "").trim() || DEFAULT_BRAND_PRODUCT_NAME;
	const configured = (input?.logoUrl ?? "").trim();
	// 上传 Logo 是 API 资产，按后端地址解析；用户填写的本站路径仍相对员工端站点。
	const logoUrl = configured.startsWith(BRANDING_LOGO_PATH)
		? `${(baseUrl || window.location.origin).replace(/\/+$/, "")}${configured}`
		: configured;
	return { productName, ...(logoUrl ? { logoUrl } : {}) };
}
