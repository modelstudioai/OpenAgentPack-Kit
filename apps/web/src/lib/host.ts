import type { ArtifactHost } from "@openagentpack/kit-sdk/files";
/** 体验页使用的宿主能力：壳注入优先，缺失能力回退到浏览器实现。 */
export interface HostCapabilities {
	pickFiles?(options?: { multiple?: boolean; accept?: string }): Promise<File[] | null>;
	saveFile?(input: { filename: string; blob: Blob }): Promise<boolean>;
	copyText?(text: string): Promise<boolean>;
	preferredColorScheme?(): "light" | "dark" | null;
}

declare global {
	interface Window {
		__OPENAGENTPACK_KIT_BRIDGE__?: HostCapabilities;
	}
}

/** 浏览器下载兜底；宿主注入的 saveFile 返回 false 时也复用它。 */
export async function saveBlobInBrowser({ filename, blob }: { filename: string; blob: Blob }): Promise<boolean> {
	if (typeof document === "undefined") return false;
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 5000);
	return true;
}

async function copyTextInBrowser(text: string): Promise<boolean> {
	if (typeof navigator === "undefined" || !navigator.clipboard) return false;
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

/** 浏览器原生能力的完整实现；只负责 Web API，不包含业务请求。 */
export function createBrowserHostCapabilities(): HostCapabilities {
	return {
		async pickFiles(options = {}) {
			if (typeof document === "undefined" || typeof HTMLInputElement === "undefined") return null;
			return await new Promise<File[] | null>((resolve) => {
				const input = document.createElement("input");
				input.type = "file";
				input.multiple = options.multiple ?? false;
				if (options.accept) input.accept = options.accept;
				input.addEventListener("change", () => resolve(Array.from(input.files ?? [])), { once: true });
				input.click();
			});
		},
		saveFile: saveBlobInBrowser,
		copyText: copyTextInBrowser,
		preferredColorScheme() {
			if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
			return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
		},
	};
}

/** 注入能力逐项覆盖浏览器实现；主题偏好为 null 时继续使用浏览器偏好。 */
export function resolveHostCapabilities(): HostCapabilities {
	const browser = createBrowserHostCapabilities();
	if (typeof window === "undefined" || !window.__OPENAGENTPACK_KIT_BRIDGE__) return browser;
	const injected = window.__OPENAGENTPACK_KIT_BRIDGE__;
	return {
		pickFiles: injected.pickFiles ?? browser.pickFiles,
		saveFile: injected.saveFile ?? browser.saveFile,
		copyText: injected.copyText ?? browser.copyText,
		preferredColorScheme: () => injected.preferredColorScheme?.() ?? browser.preferredColorScheme?.() ?? null,
	};
}

/** Browser effects only; authentication, file types and download workflow belong to the public SDK. */
export function createArtifactHost(host: HostCapabilities): ArtifactHost {
	return {
		save: host.saveFile,
		fallbackSave: saveBlobInBrowser,
		reservePreview() {
			const target = window.open("about:blank", "_blank");
			if (!target) return null;
			target.opener = null;
			return {
				show(blob) {
					const url = URL.createObjectURL(blob);
					target.location.href = url;
					window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
					return true;
				},
				close: () => target.close(),
			};
		},
	};
}
