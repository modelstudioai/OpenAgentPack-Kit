import type { DatabaseSync } from "node:sqlite";
import type { SessionPurpose } from "@openagentpack/kit-sdk/protocol";

/** 只记录上传归属（含迁移确认的历史挂载归属）；文件字节仍由 Provider 保存。 */
export function createFileStore(db: DatabaseSync) {
	return {
		recordUpload(fileId: string, subjectId: string, purpose: SessionPurpose = "experience") {
			db.prepare("INSERT INTO kit_uploaded_files (file_id, subject_id, purpose, created_at) VALUES (?, ?, ?, ?)").run(
				fileId,
				subjectId,
				purpose,
				new Date().toISOString(),
			);
		},
		isUploadedBy(fileId: string, subjectId: string, purpose: SessionPurpose = "experience"): boolean {
			return Boolean(
				db
					.prepare("SELECT 1 FROM kit_uploaded_files WHERE file_id = ? AND subject_id = ? AND purpose = ?")
					.get(fileId, subjectId, purpose),
			);
		},
	};
}

export type FileStore = ReturnType<typeof createFileStore>;
