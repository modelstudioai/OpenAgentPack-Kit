import { createMemberSessionStorage as createStorage, normalizeMemberApiBaseUrl } from "@openagentpack/kit-sdk/auth";

export { normalizeMemberApiBaseUrl };
export function createMemberSessionStorage(
	baseUrl: string,
	getStorage: Parameters<typeof createStorage>[1] = () => window.sessionStorage,
) {
	return createStorage(baseUrl, getStorage);
}
