import { KitError, type ProjectFileUpload, type ProjectFileUploadCommit } from "@openagentpack/kit-sdk/protocol";
import type { AdminClient } from "../../lib/admin/index.ts";
import { type TemplateFileDraft, type TemplateFileReference, validateTemplateFiles } from "./template-file-draft.ts";

type Api = Pick<
	AdminClient["draftResources"],
	"uploadFile" | "discardFileUpload" | "previewFileUploads" | "commitFileUploads"
>;
interface Upload {
	file: File;
	projectName: string;
	revision: string;
	staged: ProjectFileUpload;
	committed?: boolean;
	saved?: TemplateFileReference;
}
interface Options {
	api: Api;
	prepare: () => Promise<{
		draft_id: string;
		overview: { project_revision: string; active_mutation?: string | null };
	}>;
	onCommitted: (files: ProjectFileUploadCommit["files"], name: string) => TemplateFileReference[];
}

/** 只在下一步保存变化项；暂存重试复用，替换/移除/离页释放未提交上传。 */
export function createTemplateFileUploadOwner({ api, prepare, onCommitted }: Options) {
	const uploads = new Map<string, Upload>();
	let active = true;
	let uncertain = false;
	const assertActive = () => {
		if (!active) throw new Error("文件保存已取消");
	};
	async function discard(upload: Upload) {
		if (!upload.committed) await api.discardFileUpload(upload.projectName, upload.staged.upload_id).catch(() => {});
	}
	async function stage(row: TemplateFileDraft, name: string, revision: string) {
		const file = row.pending!.file;
		const cached = uploads.get(row.file_id);
		if (cached && cached.file === file && cached.projectName === name && (cached.saved || cached.revision === revision))
			return cached;
		if (cached) {
			uploads.delete(row.file_id);
			await discard(cached);
		}
		assertActive();
		const staged = await api.uploadFile(name, revision, file, file.name);
		const upload = { file, projectName: name, revision, staged };
		if (!active) {
			await discard(upload);
			assertActive();
		}
		uploads.set(row.file_id, upload);
		return upload;
	}
	function recordSaved(entries: Upload[], references: TemplateFileReference[]) {
		for (const entry of entries) {
			const saved = references.find((file) => file.local?.id === entry.staged.file_key);
			if (!saved) {
				uncertain = true;
				throw new Error("文件保存结果不完整，请退出当前页面后重新操作。");
			}
			entry.saved = saved;
		}
	}
	async function commit(name: string, revision: string, entries: Upload[]) {
		const ids = entries.map((entry) => entry.staged.upload_id);
		const input = { base_revision: revision, upload_ids: ids };
		const preview = await api.previewFileUploads(name, input);
		assertActive();
		if (!preview.can_commit) throw new Error(preview.diagnostics.join("；") || "文件声明校验未通过，请检查后重试。");
		let result: ProjectFileUploadCommit;
		try {
			result = await api.commitFileUploads(name, input);
		} catch (error) {
			if (
				error instanceof KitError &&
				["conflict", "invalid_request", "not_found", "forbidden", "unauthorized"].includes(error.code)
			)
				throw error;
			uncertain = true;
			throw new Error("文件保存结果尚未确认，请退出当前页面后重新操作，避免重复创建。");
		}
		// commit 成功后暂存已消费；即使页面离开也不再把它当作待清理上传。
		for (const entry of entries) entry.committed = true;
		assertActive();
		const references = onCommitted(result.files, name);
		recordSaved(entries, references);
		assertActive();
	}
	return {
		activate() {
			active = true;
		},
		retain(rows: TemplateFileDraft[]) {
			for (const [id, upload] of uploads) {
				if (rows.some((row) => row.file_id === id && row.pending?.file === upload.file)) continue;
				uploads.delete(id);
				void discard(upload);
			}
		},
		dispose() {
			active = false;
			for (const upload of uploads.values()) void discard(upload);
			uploads.clear();
		},
		async save(rows: TemplateFileDraft[]) {
			assertActive();
			const error = validateTemplateFiles(rows);
			if (error) throw new Error(error);
			const pending = rows.filter((file) => file.pending);
			if (!pending.length) return rows;
			if (uncertain) throw new Error("文件保存结果尚未确认，请退出当前页面后重新操作。");
			const current = await prepare();
			assertActive();
			if (current.overview.active_mutation) throw new Error("项目正在修改，请稍后重试。");
			const entries: Upload[] = [];
			for (const row of pending) entries.push(await stage(row, current.draft_id, current.overview.project_revision));
			const unsaved = entries.filter((entry) => !entry.saved);
			if (unsaved.length) await commit(current.draft_id, current.overview.project_revision, unsaved);
			return rows.map((row) =>
				row.pending ? { ...uploads.get(row.file_id)!.saved!, mount_path: row.mount_path } : row,
			);
		},
	};
}
