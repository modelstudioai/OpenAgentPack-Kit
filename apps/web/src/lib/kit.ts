import { createMemberAuthController } from "@openagentpack/kit-sdk/auth";
import { resolveApiBaseUrl } from "@openagentpack/kit-sdk/config";
import { errorFromResponse, isProtocolCompatible, KitError } from "@openagentpack/kit-sdk/protocol";
import { createRequest } from "@openagentpack/kit-sdk/request";
import { createMemberSessionStorage, normalizeMemberApiBaseUrl } from "../features/auth/member-session-storage.ts";
import { createExampleClient } from "./backend.ts";
import { createExampleChatProvider } from "./chat-backend.ts";

/** 宿主注入 > ?api= > /api/config；启动先校验服务端协议，禁止静默混用版本。 */
export async function bootstrapClient(fetchImpl?: typeof fetch) {
	const queryApi = new URLSearchParams(window.location.search).get("api") ?? undefined;
	const probeBase = normalizeMemberApiBaseUrl(resolveApiBaseUrl(queryApi), window.location.origin);
	const config = await createExampleClient(
		createRequest({ baseUrl: probeBase, fetchImpl, mapHttpError: errorFromResponse }),
	).config();
	if (!isProtocolCompatible(config.protocolVersion))
		throw new KitError("conflict", "客户端与服务端协议版本不兼容，请同步升级");
	const baseUrl = normalizeMemberApiBaseUrl(resolveApiBaseUrl(queryApi, config), window.location.origin);
	const controller = createMemberAuthController({
		baseUrl,
		mode: config.auth?.mode ?? "member",
		storage: createMemberSessionStorage(baseUrl),
		fetchImpl,
		createChatProvider: createExampleChatProvider,
		createClient: createExampleClient,
	});
	return { controller, config, baseUrl };
}
