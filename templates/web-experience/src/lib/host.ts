/** 壳注入的保存能力；模板不依赖独立宿主桥包。 */
interface InjectedHost {
	saveFile?(input: { filename: string; blob: Blob }): Promise<boolean>;
}

declare global {
	interface Window {
		__OPENAGENTPACK_KIT_BRIDGE__?: InjectedHost;
	}
}

/** 优先使用宿主注入的保存能力，失败或缺失时回退浏览器下载。 */
export async function saveFileWithHost(input: { filename: string; blob: Blob }): Promise<boolean> {
	const injected = typeof window === "undefined" ? undefined : window.__OPENAGENTPACK_KIT_BRIDGE__;
	if (await injected?.saveFile?.(input)) return true;
	if (typeof document === "undefined") return false;
	const url = URL.createObjectURL(input.blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = input.filename;
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 5000);
	return true;
}
