import type { RemoteFile } from "@openagentpack/kit-sdk/protocol";
import type { ProviderFileInfo } from "@openagentpack/sdk";
import { enrichFileMetadata } from "@openagentpack/sdk/file-lifecycle";

/**
 * 只选择工作空间普通上传文件：官方 File API 规定普通上传无 scope 且 downloadable=false，
 * Session 挂载副本也不可下载，但有 scope，必须排除。详见 docs/research/catalog-uploaded-files.md。
 */
export function toUploadedRemoteFile(info: ProviderFileInfo): RemoteFile | null {
	if (info.scope != null) return null;
	const origin = info.attributes?.origin;
	const uploaded = origin === undefined ? info.downloadable === false : origin === "user_upload";
	if (!uploaded) return null;
	const metadata = enrichFileMetadata("bailian", info);
	return {
		file_id: info.id,
		filename: info.filename || info.id,
		...(Number.isFinite(info.size_bytes) && info.size_bytes >= 0 ? { size: info.size_bytes } : {}),
		...(metadata.status ? { status: metadata.status } : {}),
		// 目录共享必须已完成扫描；无明确可用状态的记录不能被选中。
		available: metadata.available && metadata.status === "available",
	};
}
