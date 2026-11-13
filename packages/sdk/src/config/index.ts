import type { KitRuntimeConfig } from "../protocol/index.ts";

export type HostKind = "browser" | "desktop" | "mobile-webview" | "node";

export interface InjectedKitConfig {
	apiBaseUrl?: string;
	[k: string]: unknown;
}

declare global {
	// 宿主（Electron，或其他自定义 WebView）注入的运行时配置；浏览器无此对象。
	interface Window {
		__OPENAGENTPACK_KIT__?: InjectedKitConfig;
		ReactNativeWebView?: { postMessage: (message: string) => void };
	}
}

function win(): Window | undefined {
	return typeof window === "undefined" ? undefined : window;
}

export function injectedKitConfig(): InjectedKitConfig | null {
	return win()?.__OPENAGENTPACK_KIT__ ?? null;
}

/** 宿主探测：WebView > Electron > 浏览器 > Node。UI 据此降级能力。 */
export function detectHost(): HostKind {
	const w = win();
	if (!w) return "node";
	if (w.ReactNativeWebView || /ReactNative|OpenAgentKitMobile/.test(w.navigator?.userAgent ?? ""))
		return "mobile-webview";
	if (/Electron\//.test(w.navigator?.userAgent ?? "")) return "desktop";
	return "browser";
}

/**
 * apiBaseUrl 解析优先级：宿主注入 > 显式传入 > `/api/config` 回填 > location.origin。
 * 任何端都不得假设同源（docs/architecture.md）。
 */
export function resolveApiBaseUrl(explicit?: string, remoteConfig?: KitRuntimeConfig | null): string {
	const injected = injectedKitConfig()?.apiBaseUrl;
	if (injected) return injected.replace(/\/+$/, "");
	if (explicit) return explicit.replace(/\/+$/, "");
	if (remoteConfig?.apiBaseUrl) return remoteConfig.apiBaseUrl.replace(/\/+$/, "");
	const w = win();
	if (w?.location?.origin && w.location.origin !== "null") return w.location.origin;
	throw new Error("kit-sdk: 无法解析 apiBaseUrl，请显式传入或注入 window.__OPENAGENTPACK_KIT__.apiBaseUrl");
}
