import { resolveApiBaseUrl } from "@openagentpack/kit-sdk/config";
import { errorFromResponse } from "@openagentpack/kit-sdk/protocol";
import { createKitClient } from "@openagentpack/kit-sdk/providers/kit";
import { createRequest } from "@openagentpack/kit-sdk/request";
import { adminToken, bindAdminBackend, normalizeAdminBaseUrl } from "./auth.ts";

let request: ReturnType<typeof createRequest> | undefined;

/**
 * 宿主注入 > ?api= > /api/config > 当前 origin。
 * 公开配置不携带管理员令牌；协议校验成功后才允许管理请求。
 */
export async function bootstrapAdmin(fetchImpl?: typeof fetch) {
	request = undefined;
	bindAdminBackend(undefined);
	const explicit = new URLSearchParams(window.location.search).get("api") ?? undefined;
	const config = await createKitClient({
		baseUrl: normalizeAdminBaseUrl(resolveApiBaseUrl(explicit)),
		fetchImpl,
	}).config();
	const baseUrl = normalizeAdminBaseUrl(resolveApiBaseUrl(explicit, config));
	bindAdminBackend(baseUrl);
	request = createRequest({
		baseUrl,
		fetchImpl,
		headers: (): HeadersInit => {
			const token = adminToken(baseUrl);
			return token ? { authorization: `Bearer ${token}` } : {};
		},
		mapHttpError: errorFromResponse,
	});
	return { baseUrl, config };
}

export function adminRequest() {
	if (!request) throw new Error("管理端尚未完成服务配置初始化");
	return request;
}
