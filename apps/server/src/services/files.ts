import {
	type AttachmentRef,
	artifactsOf,
	KitError,
	type SessionPurpose,
	uploadTypeRejectionReason,
} from "@openagentpack/kit-sdk/protocol";
import type { ProviderGateway } from "../gateway/types.ts";
import type { FileStore } from "../store/files.ts";
import type { SessionIndex } from "../store/sessions.ts";
import type { Metrics } from "./metrics.ts";
import { readSessionHistory } from "./session-streams.ts";

export function createFileService(deps: {
	gateway: ProviderGateway;
	sessionIndex: SessionIndex;
	store: FileStore;
	metrics?: Metrics;
}) {
	const { gateway, sessionIndex, store, metrics } = deps;
	return {
		async upload(
			subjectId: string,
			input: { filename: string; bytes: Uint8Array; mimeType?: string },
			purpose: SessionPurpose = "experience",
		) {
			const rejection = uploadTypeRejectionReason(input.filename);
			if (rejection) throw new KitError("invalid_request", rejection);
			const info = await gateway.uploadFile(input);
			store.recordUpload(info.file_id, subjectId, purpose);
			metrics?.count("kit_uploads_total", { gateway: gateway.mode });
			return info;
		},
		/** 在扫描文件、创建 Provider Session 之前拒绝任何非本人上传的附件。 */
		requireUploads(subjectId: string, attachments: AttachmentRef[], purpose: SessionPurpose = "experience") {
			if (attachments.some((file) => !store.isUploadedBy(file.file_id, subjectId, purpose))) {
				throw new KitError("not_found", "文件不存在");
			}
		},
		/** 本人上传附件的扫描状态：available 前绑定会话会被 provider 拒（服务端发送闸门兜底）。 */
		async status(subjectId: string, fileId: string, purpose: SessionPurpose = "experience") {
			if (!store.isUploadedBy(fileId, subjectId, purpose)) throw new KitError("not_found", "文件不存在");
			const info = await gateway.fileStatus(fileId);
			return { file_id: fileId, status: info.status ?? null, available: info.available };
		},
		async download(subjectId: string, fileId: string, sessionId?: string, purpose: SessionPurpose = "experience") {
			if (store.isUploadedBy(fileId, subjectId, purpose)) return gateway.downloadFile(fileId);
			// Session ID 本身不是文件访问凭据：先确认会话归属，再从 Provider 完整历史验证交付文件。
			if (!sessionId || !sessionIndex.owns(sessionId, subjectId, purpose)) {
				throw new KitError("not_found", "文件不存在");
			}
			const events = await readSessionHistory(gateway, sessionId);
			if (!events.some((event) => artifactsOf(event).some((artifact) => artifact.file_id === fileId))) {
				throw new KitError("not_found", "文件不存在");
			}
			return gateway.downloadFile(fileId);
		},
	};
}

export type FileService = ReturnType<typeof createFileService>;
