import { createMemberAuthController } from "@openagentpack/kit-sdk/auth";
import { injectedKitConfig } from "@openagentpack/kit-sdk/config";
import { createKitClient } from "@openagentpack/kit-sdk/providers/kit";
import { createMemberSessionStorage, normalizeMemberApiBaseUrl } from "../features/auth/member-session-storage.ts";

/** 宿主注入 > ?api= > /api/config；启动先校验服务端协议，禁止静默混用版本。 */
export async function bootstrapClient(fetchImpl?: typeof fetch) {
	const queryApi = new URLSearchParams(window.location.search).get("api") ?? undefined;
	const injected = injectedKitConfig()?.apiBaseUrl;
	const probeBase = normalizeMemberApiBaseUrl(injected ?? queryApi ?? window.location.origin, window.location.origin);
	const config = await createKitClient({ baseUrl: probeBase, fetchImpl }).config();
	const baseUrl = normalizeMemberApiBaseUrl(
		injected ?? queryApi ?? (config.apiBaseUrl || window.location.origin),
		window.location.origin,
	);
	const controller = createMemberAuthController({
		baseUrl,
		mode: config.auth?.mode ?? "member",
		storage: createMemberSessionStorage(baseUrl),
		fetchImpl,
	});
	return { controller, config, baseUrl };
}
