import { createHash, randomUUID } from "node:crypto";
import { KitError, type ProjectFileUpload } from "@openagentpack/kit-sdk/protocol";
import { assertProjectFileName } from "../gateway/project-file-sources.ts";
import type { ProjectSourceFileUpload } from "../gateway/types.ts";

const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 32;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;

export interface ProjectUploadScope {
	subject: string;
	name: string;
}
export interface ProjectUploadOwner extends ProjectUploadScope {
	baseRevision: string;
}
interface Entry {
	owner: ProjectUploadOwner;
	upload: ProjectSourceFileUpload;
	expiresAt: number;
	claimed: boolean;
}

function sameScope(left: ProjectUploadScope, right: ProjectUploadScope): boolean {
	return left.subject === right.subject && left.name === right.name;
}

function descriptor(upload: ProjectSourceFileUpload): ProjectFileUpload {
	return {
		upload_id: upload.upload_id,
		file_key: upload.file_key,
		filename: upload.filename,
		size: upload.size,
		sha256: upload.sha256,
	};
}

/** 暂存仅驻内存，不写项目/SQLite/Provider；重启后旧 token 失效，用户可重新选择文件。 */
export function createProjectFileUploads(maxFileBytes: number, now: () => number = Date.now) {
	const entries = new Map<string, Entry>();
	let totalBytes = 0;
	function remove(id: string): boolean {
		const entry = entries.get(id);
		if (!entry) return false;
		totalBytes -= entry.upload.size;
		return entries.delete(id);
	}
	function sweep() {
		for (const [id, entry] of entries) if (!entry.claimed && entry.expiresAt <= now()) remove(id);
	}
	function selected(owner: ProjectUploadOwner, ids: string[]): Entry[] {
		sweep();
		if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length)
			throw new KitError("invalid_request", "每次最多保存 20 个文件，上传标识不能重复");
		return ids.map((id) => {
			const entry = entries.get(id);
			if (!entry || !sameScope(entry.owner, owner))
				throw new KitError("not_found", "暂存文件不存在或已过期，请重新选择文件");
			if (entry.owner.baseRevision !== owner.baseRevision)
				throw new KitError("conflict", "暂存文件对应的项目版本已变化，请重新加载后选择文件");
			if (entry.claimed) throw new KitError("conflict", "暂存文件正在保存，请等待当前操作完成");
			return entry;
		});
	}
	return {
		clear() {
			entries.clear();
			totalBytes = 0;
		},
		stage(owner: ProjectUploadOwner, filename: string, bytes: Uint8Array): ProjectFileUpload {
			assertProjectFileName(filename);
			if (bytes.byteLength === 0) throw new KitError("invalid_request", "不能上传空文件，请选择有内容的文件");
			if (bytes.byteLength > maxFileBytes) throw new KitError("invalid_request", "文件大小超过上传上限");
			sweep();
			if (entries.size >= MAX_ENTRIES || totalBytes + bytes.byteLength > MAX_TOTAL_BYTES)
				throw new KitError("conflict", "暂存文件已达到 32 项或 128 MiB 上限，请先移除暂存文件，或等待 30 分钟后重试");
			const upload: ProjectSourceFileUpload = {
				upload_id: `upload-${randomUUID()}`,
				file_key: `file-${randomUUID()}`,
				filename,
				size: bytes.byteLength,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				bytes: bytes.slice(),
			};
			entries.set(upload.upload_id, { owner: { ...owner }, upload, expiresAt: now() + TTL_MS, claimed: false });
			totalBytes += upload.size;
			return descriptor(upload);
		},
		resolve(owner: ProjectUploadOwner, ids: string[]): ProjectSourceFileUpload[] {
			return selected(owner, ids).map((entry) => entry.upload);
		},
		claim(owner: ProjectUploadOwner, ids: string[]) {
			const chosen = selected(owner, ids);
			for (const entry of chosen) entry.claimed = true;
			let finished = false;
			return {
				uploads: chosen.map((entry) => entry.upload),
				finish(committed: boolean) {
					if (finished) return;
					finished = true;
					for (const entry of chosen) {
						if (committed) remove(entry.upload.upload_id);
						else {
							entry.claimed = false;
							entry.expiresAt = now() + TTL_MS;
						}
					}
				},
			};
		},
		cancel(scope: ProjectUploadScope, id: string): { deleted: boolean } {
			sweep();
			const entry = entries.get(id);
			if (!entry) return { deleted: false };
			if (!sameScope(entry.owner, scope)) throw new KitError("not_found", "暂存文件不存在");
			if (entry.claimed) throw new KitError("conflict", "暂存文件正在保存，暂时不能移除");
			return { deleted: remove(id) };
		},
	};
}
