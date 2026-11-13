import { KitError, type ProjectFileUpload, type ProjectFileUploadInput } from "@openagentpack/kit-sdk/protocol";
import { describe, expect, it, vi } from "vitest";
import {
	mergeImportedFiles,
	pendingTemplateFile,
	type TemplateFileDraft,
	withFileMountPaths,
} from "./template-file-draft.ts";
import { createTemplateFileUploadOwner } from "./template-file-upload-owner.ts";

const cloud: TemplateFileDraft = {
	file_id: "cloud-file",
	filename: "guide.txt",
	size: 1,
	available: true,
	mount_path: "/mnt/session/uploads/guide.txt",
};
function fixture() {
	const staged: ProjectFileUpload[] = [];
	const api = {
		uploadFile: vi.fn(async (_name: string, _revision: string, file: Blob, filename: string) => {
			const next = {
				upload_id: `upload-${staged.length + 1}`,
				file_key: `file-${staged.length + 1}`,
				filename,
				size: file.size,
				sha256: "a".repeat(64),
			};
			staged.push(next);
			return next;
		}),
		discardFileUpload: vi.fn(async () => ({ deleted: true })),
		previewFileUploads: vi.fn(async () => ({
			base_revision: "r1",
			before: "{}",
			after: "{}",
			diagnostics: [] as string[],
			can_commit: true,
			file_uploads: staged,
		})),
		commitFileUploads: vi.fn(async (_name: string, input: ProjectFileUploadInput) => ({
			new_revision: "r2",
			files: staged.filter((file) => input.upload_ids.includes(file.upload_id)),
		})),
	};
	const prepare = vi.fn(async () => ({ draft_id: "batch", overview: { project_revision: "r1" } }));
	const onCommitted = vi.fn((files: ProjectFileUpload[], projectName: string) =>
		files.map((file) => ({
			file_id: `local:${file.file_key}`,
			filename: file.filename,
			size: file.size,
			available: true,
			local: { projectName, id: file.file_key },
		})),
	);
	return { api, prepare, onCommitted, owner: createTemplateFileUploadOwner({ api, prepare, onCommitted }) };
}

describe("文件表单的云端复用与延后保存", () => {
	it("未修改云端文件不初始化或上传；替换内容后才保存新声明，原引用不改变", async () => {
		const t = fixture();
		const selected = [cloud];
		expect(await t.owner.save(selected)).toBe(selected);
		expect(t.prepare).not.toHaveBeenCalled();
		expect(t.api.uploadFile).not.toHaveBeenCalled();
		const replacement = pendingTemplateFile(new File(["new"], "new.txt"), cloud);
		const result = await t.owner.save([replacement]);
		expect(result[0]).toMatchObject({
			file_id: "local:file-1",
			filename: "new.txt",
			mount_path: cloud.mount_path,
			local: { id: "file-1" },
		});
		expect(result[0]).not.toHaveProperty("pending");
		expect(cloud.file_id).toBe("cloud-file");
		expect(t.api.uploadFile).toHaveBeenCalledTimes(1);
	});
	it("明确拒绝后的重试复用暂存；移除及退出不清理已提交的声明", async () => {
		const t = fixture();
		t.api.commitFileUploads.mockRejectedValueOnce(new KitError("conflict", "请重新预览"));
		const rows = withFileMountPaths([pendingTemplateFile(new File(["new"], "new.txt"))]);
		await expect(t.owner.save(rows)).rejects.toMatchObject({ code: "conflict" });
		await t.owner.save(rows);
		expect(t.api.uploadFile).toHaveBeenCalledTimes(1);
		t.owner.retain([]);
		t.owner.dispose();
		expect(t.api.discardFileUpload).not.toHaveBeenCalled();
	});
	it("失败后移除释放暂存；提交结果不明确时阻止重复创建", async () => {
		const t = fixture();
		t.api.previewFileUploads.mockResolvedValueOnce({
			base_revision: "r1",
			before: "{}",
			after: "{}",
			diagnostics: ["校验失败"],
			can_commit: false,
			file_uploads: [],
		});
		const rows = withFileMountPaths([pendingTemplateFile(new File(["new"], "new.txt"))]);
		await expect(t.owner.save(rows)).rejects.toThrow("校验失败");
		t.owner.retain([]);
		expect(t.api.discardFileUpload).toHaveBeenCalledTimes(1);
		t.api.commitFileUploads.mockRejectedValueOnce(new Error("connection lost"));
		await expect(t.owner.save(rows)).rejects.toThrow("结果尚未确认");
		await expect(t.owner.save(rows)).rejects.toThrow("结果尚未确认");
		expect(t.api.commitFileUploads).toHaveBeenCalledTimes(1);
	});
	it("导入保留替换草稿和新文件；同名文件避让已有挂载路径", () => {
		const replacement = pendingTemplateFile(new File(["new"], "guide.txt"), cloud);
		const added = pendingTemplateFile(new File(["another"], "guide.txt"));
		const rows = withFileMountPaths([replacement, added]);
		expect(rows.map((row) => row.mount_path)).toEqual([cloud.mount_path, "/mnt/session/uploads/guide-2.txt"]);
		const imported = mergeImportedFiles(rows, [cloud]);
		expect(imported).toEqual(rows);
		expect(mergeImportedFiles(rows, [])).toEqual([rows[1]]);
		const newFile = withFileMountPaths([added]);
		expect(mergeImportedFiles(newFile, [cloud]).map((file) => file.mount_path)).toEqual([
			cloud.mount_path,
			"/mnt/session/uploads/guide-2.txt",
		]);
	});
	it("源码版本变化后重传，退出后的迟到上传仅清理、不保存声明", async () => {
		const t = fixture();
		const rows = withFileMountPaths([pendingTemplateFile(new File(["new"], "new.txt"))]);
		t.api.previewFileUploads.mockResolvedValueOnce({
			base_revision: "r1",
			before: "{}",
			after: "{}",
			diagnostics: ["校验失败"],
			can_commit: false,
			file_uploads: [],
		});
		await expect(t.owner.save(rows)).rejects.toThrow("校验失败");
		t.prepare.mockResolvedValue({ draft_id: "batch", overview: { project_revision: "r2" } });
		await t.owner.save(rows);
		expect(t.api.discardFileUpload).toHaveBeenCalledWith("batch", "upload-1");
		expect(t.api.uploadFile).toHaveBeenCalledTimes(2);
		const late = fixture();
		let resolveUpload!: (value: ProjectFileUpload) => void;
		const upload = new Promise<ProjectFileUpload>((resolve) => {
			resolveUpload = resolve;
		});
		late.api.uploadFile.mockReturnValueOnce(upload);
		const saving = late.owner.save(rows);
		await vi.waitFor(() => expect(late.api.uploadFile).toHaveBeenCalledTimes(1));
		late.owner.dispose();
		resolveUpload({
			upload_id: "late-upload",
			file_key: "late-file",
			filename: "new.txt",
			size: 3,
			sha256: "a".repeat(64),
		});
		await expect(saving).rejects.toThrow("已取消");
		expect(late.api.discardFileUpload).toHaveBeenCalledWith("batch", "late-upload");
		expect(late.api.commitFileUploads).not.toHaveBeenCalled();
	});
});
