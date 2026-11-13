import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { KitError, type ProjectFileUpload, type ProjectFileUploadInput } from "@openagentpack/kit-sdk/protocol";
import type { ProjectSourceFileUpload } from "./types.ts";

/** 只接受服务端暂存的全新共享 File，独立保存，不修改任何 Agent。 */
export function validateProjectFileUploads(
	input: ProjectFileUploadInput,
	uploads: ProjectSourceFileUpload[],
	existingKeys: Set<string>,
): ProjectFileUpload[] {
	const ids = input.upload_ids;
	if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length || ids.length !== uploads.length)
		throw new KitError("invalid_request", "暂存文件列表无效");
	const seen = new Set<string>();
	const keys = new Set<string>();
	for (const upload of uploads) {
		validateUploadIdentity(upload, ids, seen, keys, existingKeys);
		validateFileContent(upload);
	}
	return uploads.map(({ upload_id, file_key, filename, size, sha256 }) => ({
		upload_id,
		file_key,
		filename,
		size,
		sha256,
	}));
}

function validateUploadIdentity(
	upload: ProjectSourceFileUpload,
	ids: string[],
	seen: Set<string>,
	keys: Set<string>,
	existingKeys: Set<string>,
) {
	if (
		!upload.upload_id ||
		!ids.includes(upload.upload_id) ||
		seen.has(upload.upload_id) ||
		upload.upload_id.length > 128
	)
		throw new KitError("invalid_request", "暂存文件与提交列表不一致");
	seen.add(upload.upload_id);
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(upload.file_key) || keys.has(upload.file_key))
		throw new KitError("invalid_request", "文件声明标识无效");
	keys.add(upload.file_key);
	if (existingKeys.has(upload.file_key)) throw new KitError("conflict", "资源声明标识已存在，请重新上传");
}

export function assertProjectFileName(filename: string) {
	const controlCharacter = /\p{Cc}/u.test(filename);
	if (
		!filename ||
		Buffer.byteLength(filename, "utf8") > 240 ||
		/[\\/]/.test(filename) ||
		controlCharacter ||
		filename.startsWith(".") ||
		filename.endsWith(".") ||
		filename.includes("${") ||
		filename.trim() !== filename
	)
		throw new KitError("invalid_request", "文件名无效，请使用普通文件名");
}

function validateFileContent(upload: ProjectSourceFileUpload) {
	assertProjectFileName(upload.filename);
	if (
		upload.size !== upload.bytes.byteLength ||
		!Number.isSafeInteger(upload.size) ||
		upload.size <= 0 ||
		createHash("sha256").update(upload.bytes).digest("hex") !== upload.sha256
	)
		throw new KitError("invalid_request", "暂存文件内容校验失败，请重新上传");
}

export function referencesProjectFile(value: unknown, key: string): boolean {
	return (
		Array.isArray(value) &&
		value.some((entry) => entry === key || (entry && typeof entry === "object" && entry.file === key))
	);
}

export function projectFileMetadata(upload: ProjectFileUpload) {
	return { id: upload.file_key, name: upload.filename, source: `./content/${upload.filename}` };
}

/** Build 的 source 相对 .openagentpack/build，预览只扩充内存配置。 */
export function projectFileBuildDeclaration(upload: ProjectFileUpload) {
	return {
		name: upload.filename,
		source: `../../resources/files/${upload.file_key}/content/${upload.filename}`,
	};
}

/** SDK 的 mutation lock 也写在内部目录，必须在申请锁前拒绝该目录的符号链接。 */
export async function assertProjectFileStorage(root: string) {
	for (const segments of [[".openagentpack"], ["resources", "files"]]) {
		let path = resolve(root);
		for (const segment of segments) {
			path = resolve(path, segment);
			const details = await lstat(path).catch((error: NodeJS.ErrnoException) => {
				if (error.code === "ENOENT") return null;
				throw error;
			});
			if (!details) break;
			if (!details.isDirectory() || details.isSymbolicLink())
				throw new KitError("invalid_request", "文件目标必须是项目内普通目录");
		}
	}
}

/** 父目录只能是项目内普通目录，防止将上传写到符号链接目标。 */
async function ensureSourceDirectory(root: string, parts: string[]) {
	let directory = resolve(root);
	for (const part of parts) {
		directory = resolve(directory, part);
		await mkdir(directory).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "EEXIST") throw error;
		});
		const details = await lstat(directory);
		if (!details.isDirectory() || details.isSymbolicLink())
			throw new KitError("invalid_request", "文件目标必须是项目内普通目录");
	}
}

/** 只创建全新的 shared File 目录；失败撤回，未保存草稿不会被 Build 自动关联。 */
export async function writeProjectFileSources(root: string, uploads: ProjectSourceFileUpload[]) {
	const destinations: string[] = [];
	const cleanup = async () => {
		const results = await Promise.allSettled(destinations.map((path) => rm(path, { recursive: true, force: true })));
		if (results.some((result) => result.status === "rejected"))
			throw new KitError("internal", "文件保存失败且恢复未完成，请检查项目源码后重试");
	};
	if (!uploads.length) return cleanup;
	await ensureSourceDirectory(root, [".openagentpack"]);
	await ensureSourceDirectory(root, ["resources", "files"]);
	const staging = resolve(root, ".openagentpack", `kit-file-write-${randomUUID()}`);
	await mkdir(staging);
	try {
		for (const upload of uploads) {
			const temporary = resolve(staging, upload.file_key);
			await mkdir(resolve(temporary, "content"), { recursive: true });
			await writeFile(resolve(temporary, "content", upload.filename), upload.bytes, { mode: 0o600 });
			await writeFile(resolve(temporary, "file.json"), `${JSON.stringify(projectFileMetadata(upload), null, 2)}\n`, {
				mode: 0o600,
			});
			const destination = resolve(root, "resources", "files", upload.file_key);
			await mkdir(destination).catch((error: NodeJS.ErrnoException) => {
				if (error.code === "EEXIST") throw new KitError("conflict", "文件目标已存在，请重新上传");
				throw error;
			});
			destinations.push(destination);
			await rename(temporary, destination);
		}
		return cleanup;
	} catch (error) {
		await cleanup();
		throw error;
	} finally {
		await rm(staging, { recursive: true, force: true }).catch(() => undefined);
	}
}
