import type { RemoteFile } from "@openagentpack/kit-sdk/protocol";
import { defaultMountPath, normalizedMountPath } from "../catalog/file-mounts.ts";
import type { TemplateLocalResource } from "./template-local-resources.tsx";

export const MAX_TEMPLATE_FILES = 10;
export type TemplateFileReference = RemoteFile & TemplateLocalResource & { mount_path?: string };
export type TemplateFileDraft = TemplateFileReference & { pending?: { file: File; original?: TemplateFileReference } };

export function withFileMountPaths(files: TemplateFileDraft[]): TemplateFileDraft[] {
	const used = new Set(files.flatMap((file) => (file.mount_path ? [normalizedMountPath(file.mount_path)] : [])));
	return files.map((file, index) => {
		if (file.mount_path) return file;
		const mount_path = defaultMountPath(file.filename, `file_${index + 1}`, used);
		used.add(mount_path);
		return { ...file, mount_path };
	});
}

export function pendingTemplateFile(file: File, original?: TemplateFileDraft): TemplateFileDraft {
	const reference = original?.pending ? original.pending.original : original;
	return {
		file_id: original?.file_id ?? `pending:${crypto.randomUUID()}`,
		filename: file.name,
		size: file.size,
		available: true,
		mount_path: original?.mount_path,
		pending: { file, original: reference },
	};
}

/** 导入确认保留已有项的顺序、替换草稿与挂载路径，未上传的新文件独立保留。 */
export function mergeImportedFiles(current: TemplateFileDraft[], imported: TemplateFileDraft[]) {
	const ids = new Set(imported.map((file) => file.file_id));
	const retained = current.filter((file) => ids.has(file.file_id) || (file.pending && !file.pending.original));
	const existing = new Set(retained.map((file) => file.file_id));
	// 抽屉预选时没有主表单的新文件；确认后重新避让完整表单的挂载位置。
	const added = imported
		.filter((file) => !existing.has(file.file_id))
		.map((file) => ({ ...file, mount_path: undefined }));
	return withFileMountPaths([...retained, ...added]);
}

export const hasPendingFiles = (files: TemplateFileDraft[]) => files.some((file) => Boolean(file.pending));

export function validateTemplateFiles(files: TemplateFileDraft[]): string | null {
	if (files.length > MAX_TEMPLATE_FILES) return `最多选择 ${MAX_TEMPLATE_FILES} 个文件`;
	if (new Set(files.map((file) => file.file_id)).size !== files.length) return "同一个文件只能选择一次";
	const paths = files.flatMap((file) => (file.mount_path ? [normalizedMountPath(file.mount_path)] : []));
	if (new Set(paths).size !== paths.length) return "文件挂载路径不能重复";
	if (files.some((file) => file.pending && !file.pending.file.size)) return "不能上传空文件，请选择有内容的文件";
	return null;
}
