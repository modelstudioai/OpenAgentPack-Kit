const LEGACY_TOKEN_KEY = "kit_admin_token";
let activeBaseUrl: string | undefined;

/** 请求和凭据使用同一个规范地址，路径前缀也属于后端身份。 */
export function normalizeAdminBaseUrl(value: string): string {
	const url = new URL(value, window.location.origin);
	if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash)
		throw new Error("管理端服务地址必须是无凭据、查询参数和片段的 HTTP(S) 地址");
	return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

const tokenKey = (baseUrl: string) => `${LEGACY_TOKEN_KEY}:${baseUrl}`;

/** 只有公开配置完成后才能绑定；初始化或失败时传 undefined 清除绑定。 */
export function bindAdminBackend(baseUrl: string | undefined) {
	activeBaseUrl = undefined;
	if (!baseUrl) return;
	const target = normalizeAdminBaseUrl(baseUrl);
	// 旧版本仅向页面同源根地址发请求，不能把它的无目标令牌迁移到任意新后端。
	if (target === window.location.origin) {
		const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
		if (legacy !== null) {
			if (localStorage.getItem(tokenKey(target)) === null) localStorage.setItem(tokenKey(target), legacy);
			localStorage.removeItem(LEGACY_TOKEN_KEY);
		}
	}
	activeBaseUrl = target;
}

export function adminBaseUrl(): string {
	if (!activeBaseUrl) throw new Error("管理端尚未完成服务配置初始化");
	return activeBaseUrl;
}

/** Request 显式传入其目标，避免旧客户端读取后续选中后端的令牌。 */
export function adminToken(baseUrl = activeBaseUrl): string {
	return baseUrl ? (localStorage.getItem(tokenKey(baseUrl)) ?? "") : "";
}

export function setAdminToken(token: string) {
	localStorage.setItem(tokenKey(adminBaseUrl()), token);
}
