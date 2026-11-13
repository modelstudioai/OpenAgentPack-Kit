import { createHash, randomUUID } from "node:crypto";
import { KitError, type ProjectSkillUpload } from "@openagentpack/kit-sdk/protocol";
import { prepareProjectSkillUpload } from "../gateway/project-skill-sources.ts";
import type { ProjectSourceSkillUpload } from "../gateway/types.ts";
import type { ProjectUploadOwner, ProjectUploadScope } from "./project-file-uploads.ts";

const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 32;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
interface Entry {
	owner: ProjectUploadOwner;
	upload: ProjectSourceSkillUpload;
	expiresAt: number;
	claimed: boolean;
}

function sameScope(left: ProjectUploadScope, right: ProjectUploadScope): boolean {
	return left.subject === right.subject && left.name === right.name;
}

function descriptor(upload: ProjectSourceSkillUpload): ProjectSkillUpload {
	return {
		upload_id: upload.upload_id,
		skill_key: upload.skill_key,
		filename: upload.filename,
		name: upload.name,
		size: upload.size,
		sha256: upload.sha256,
		file_count: upload.file_count,
		expanded_size: upload.expanded_size,
	};
}

/** 仅驻内存；原始包和展开后的文件一并计费。解析中的请求预留展开上限，避免并发解压越界。 */
export function createProjectSkillUploads(maxFileBytes: number, now: () => number = Date.now) {
	const entries = new Map<string, Entry>();
	let totalBytes = 0;
	let pending = 0;
	function remove(id: string): boolean {
		const entry = entries.get(id);
		if (!entry) return false;
		totalBytes -= entry.upload.size + entry.upload.expanded_size;
		return entries.delete(id);
	}
	function sweep() {
		for (const [id, entry] of entries) if (!entry.claimed && entry.expiresAt <= now()) remove(id);
	}
	function selected(owner: ProjectUploadOwner, ids: string[]): Entry[] {
		sweep();
		if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length)
			throw new KitError("invalid_request", "每次最多保存 20 个 Skill，上传标识不能重复");
		return ids.map((id) => {
			const entry = entries.get(id);
			if (!entry || !sameScope(entry.owner, owner))
				throw new KitError("not_found", "暂存 Skill 不存在或已过期，请重新选择文件");
			if (entry.owner.baseRevision !== owner.baseRevision)
				throw new KitError("conflict", "暂存 Skill 对应的项目版本已变化，请重新加载后选择文件");
			if (entry.claimed) throw new KitError("conflict", "暂存 Skill 正在保存，请等待当前操作完成");
			return entry;
		});
	}
	return {
		clear() {
			entries.clear();
			totalBytes = 0;
		},
		async stage(owner: ProjectUploadOwner, filename: string, input: Uint8Array): Promise<ProjectSkillUpload> {
			if (input.byteLength === 0) throw new KitError("invalid_request", "不能上传空文件，请选择有内容的 Skill 包");
			if (input.byteLength > maxFileBytes) throw new KitError("invalid_request", "Skill 包大小超过上传上限");
			sweep();
			const reservation = input.byteLength + MAX_EXPANDED_BYTES;
			if (entries.size + pending >= MAX_ENTRIES || totalBytes + reservation > MAX_TOTAL_BYTES)
				throw new KitError("conflict", "暂存 Skill 已达到 32 项或 128 MiB 上限，请移除暂存包或稍后重试");
			pending++;
			totalBytes += reservation;
			try {
				const bytes = input.slice();
				const prepared = await prepareProjectSkillUpload(filename, bytes);
				const upload: ProjectSourceSkillUpload = {
					upload_id: `upload-${randomUUID()}`,
					skill_key: `skill-${randomUUID()}`,
					filename,
					name: prepared.name,
					size: bytes.byteLength,
					sha256: createHash("sha256").update(bytes).digest("hex"),
					file_count: prepared.files.length,
					expanded_size: prepared.files.reduce((sum, file) => sum + file.bytes.byteLength, 0),
					bytes,
					files: prepared.files,
				};
				entries.set(upload.upload_id, { owner: { ...owner }, upload, expiresAt: now() + TTL_MS, claimed: false });
				totalBytes += upload.size + upload.expanded_size;
				return descriptor(upload);
			} finally {
				pending--;
				totalBytes -= reservation;
			}
		},
		resolve(owner: ProjectUploadOwner, ids: string[]): ProjectSourceSkillUpload[] {
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
			if (!sameScope(entry.owner, scope)) throw new KitError("not_found", "暂存 Skill 不存在");
			if (entry.claimed) throw new KitError("conflict", "暂存 Skill 正在保存，暂时不能移除");
			return { deleted: remove(id) };
		},
	};
}
