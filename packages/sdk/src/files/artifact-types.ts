/** 顶层文档渲染下 HTML/SVG 会执行脚本并能读本源存储（登录令牌在 sessionStorage），
 * 声明为这些类型的产物不做预览尝试，直接下载。 */
export const DANGEROUS_PREVIEW_TYPES = new Set(["text/html", "application/xhtml+xml", "image/svg+xml"]);

const ARTIFACT_EXTENSION_TYPES: Record<string, string> = {
	pdf: "application/pdf",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	mp4: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	txt: "text/plain",
	md: "text/plain",
};

export function mimeOfType(value: string | undefined): string {
	return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

/** 产物类型解析：事件声明 → 文件名扩展 → 下载响应头。事件里的 content_type 常缺省，
 * SDK 网关下载又固定返回 octet-stream（视为未声明），文件名扩展是最可靠的后备来源。 */
export function resolveArtifactType(declared: string | undefined, filename: string, delivered: string): string {
	const explicit = (value: string | undefined) => {
		const type = mimeOfType(value);
		return type && type !== "application/octet-stream" ? type : "";
	};
	const extension = filename.includes(".") ? (filename.split(".").pop()?.toLowerCase() ?? "") : "";
	return explicit(declared) || ARTIFACT_EXTENSION_TYPES[extension] || explicit(delivered);
}

/** 可在新窗口安全预览的惰性类型：只放行图片/音视频/PDF/纯文本，导航前会把 blob
 * 重建为解析出的类型，浏览器按该类型渲染、不会执行脚本；其余点击回退为直接下载。 */
export function previewableArtifactType(type: string): boolean {
	return (
		(/^image\//.test(type) && type !== "image/svg+xml") ||
		/^video\//.test(type) ||
		/^audio\//.test(type) ||
		type === "application/pdf" ||
		type === "text/plain"
	);
}

/** 纯文本预览统一以 UTF-8 重建：blob URL 缺 charset 时，中文环境浏览器会按遗留编码
 * （GBK）解码出乱码。优先按 UTF-8 严格解码，失败回退 GBK 兜住中文遗留编码的文件。 */
async function utf8PreviewBlob(blob: Blob): Promise<Blob> {
	const buffer = await blob.arrayBuffer();
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
	} catch {
		text = new TextDecoder("gbk").decode(buffer);
	}
	return new Blob([text], { type: "text/plain; charset=utf-8" });
}

/** 预览用 blob 重建：下载响应多为 octet-stream，按解析类型重贴 MIME 保证新窗口正确渲染；
 * 纯文本走 UTF-8 规范化（见 utf8PreviewBlob）。 */
export async function previewBlobOf(blob: Blob, type: string): Promise<Blob> {
	if (type === "text/plain") return utf8PreviewBlob(blob);
	return blob.type === type ? blob : new Blob([blob], { type });
}
