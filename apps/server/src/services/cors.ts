/**
 * CORS 白名单匹配（纯函数，单测覆盖）。
 *
 * 端口通配用于本地静态服务的动态端口，避免每次启动都修改白名单。
 *
 * 安全边界：`:*` 只对 **loopback 主机**生效（127.0.0.1 / localhost / [::1]）。
 * 给任意域名开端口通配等于把跨站请求面放大到整站，因此非 loopback 的通配条目会被忽略。
 */
const LOOPBACK_WILDCARD = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])$/;

export type OriginMatcher = (origin: string) => string | undefined;

export function createOriginMatcher(allowed: string[]): OriginMatcher {
	const exact = new Set<string>();
	const loopbackBases: string[] = [];
	for (const entry of allowed) {
		const value = entry.trim();
		if (!value) continue;
		if (!value.endsWith(":*")) {
			exact.add(value);
			continue;
		}
		const base = value.slice(0, -2);
		if (LOOPBACK_WILDCARD.test(base)) loopbackBases.push(base);
	}
	return (origin) => {
		if (!origin) return undefined;
		if (exact.has(origin)) return origin;
		for (const base of loopbackBases) {
			if (!origin.startsWith(`${base}:`)) continue;
			const port = origin.slice(base.length + 1);
			if (/^\d{1,5}$/.test(port)) return origin;
		}
		return undefined;
	};
}

/** 未显式配置白名单时的默认值：本机开发（vite）与 loopback 动态端口。 */
export const DEFAULT_CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://127.0.0.1:*"];
