import { posix } from "node:path";
import { type AttachmentRef, KitError } from "@openagentpack/kit-sdk/protocol";
import type { ProviderGateway } from "../gateway/types.ts";
import { resolveMounts } from "./attachments.ts";

function explicitMountPath(value: string | undefined): string | undefined {
	const path = value?.trim();
	if (!path) return undefined;
	const hasControl = /\p{Cc}/u.test(path);
	if (!path.startsWith("/") || path.endsWith("/") || hasControl || path.split("/").includes("..")) {
		throw new KitError("invalid_request", "挂载路径必须是绝对文件路径，且不能包含 .. 或控制字符");
	}
	const normalized = posix.normalize(path);
	if (normalized === "/") throw new KitError("invalid_request", "挂载路径必须包含文件名");
	return normalized;
}

/** 管理员提交 ID 与路径，文件名和大小由 Provider 校准；目录配置是共享挂载的服务端白名单。 */
export async function prepareCatalogFiles(gateway: ProviderGateway, input: AttachmentRef[]): Promise<AttachmentRef[]> {
	if (input.length > 10) throw new KitError("invalid_request", "最多选择 10 个文件");
	const ids = new Set<string>();
	const paths = new Set<string>();
	const files: AttachmentRef[] = [];
	for (const file of input) {
		if (!file.file_id.trim()) throw new KitError("invalid_request", "请选择已上传文件");
		if (ids.has(file.file_id)) throw new KitError("invalid_request", "同一文件不能重复选择");
		ids.add(file.file_id);
		const remote = await gateway.getRemoteFile(file.file_id);
		if (!remote) throw new KitError("invalid_request", "所选文件不存在或不是已上传文件，请重新选择");
		if (!remote.available) throw new KitError("conflict", "所选文件尚不可用，请刷新文件列表后重试");
		const canonical: AttachmentRef = { file_id: remote.file_id, filename: remote.filename, size: remote.size };
		const mountPath = explicitMountPath(file.mount_path) ?? resolveMounts([canonical])[0]?.mount_path;
		if (!mountPath) throw new KitError("invalid_request", "无法确定文件挂载路径");
		if (paths.has(mountPath)) throw new KitError("invalid_request", "文件挂载路径不能重复");
		paths.add(mountPath);
		files.push({ ...canonical, mount_path: mountPath });
	}
	return files;
}

/** 只接受服务端读取的目录文件；调用前必须独立校验所有成员附件的本人归属。 */
export function mergeSessionFiles(catalogFiles: AttachmentRef[], memberFiles: AttachmentRef[]): AttachmentRef[] {
	const merged = new Map(catalogFiles.map((file) => [file.file_id, file]));
	for (const file of memberFiles) {
		if (merged.has(file.file_id)) continue;
		const path = file.mount_path?.trim();
		merged.set(file.file_id, path?.startsWith("/") ? { ...file, mount_path: explicitMountPath(path) } : file);
	}
	if (merged.size > 10) throw new KitError("invalid_request", "目录文件与本次附件合计不能超过 10 个");
	// 目录挂载在前保留配置路径；成员同名文件由既有路径解析加后缀，不覆盖目录文件。
	return [...merged.values()];
}
