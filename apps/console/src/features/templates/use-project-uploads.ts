import type { ProjectFileUpload, ProjectSkillUpload } from "@openagentpack/kit-sdk/protocol";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AdminClient } from "../../lib/admin/index.ts";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";

function uploadFailure(file: File, error: unknown): string {
	return `${file.name}：${error instanceof Error ? error.message : "上传失败，请重试"}`;
}

export type ProjectUploadKind = "file" | "skill";
type ProjectUpload = ProjectFileUpload | ProjectSkillUpload;

/** 项目资源的暂存队列；关闭后停止新上传，并清理晚到的结果。 */
export function useProjectUploads({
	kind,
	workbench,
	baseRevision,
	enabled,
}: {
	kind: ProjectUploadKind;
	workbench: { client: AdminClient; name: string };
	baseRevision: string;
	enabled: boolean;
}) {
	const client = workbench.client.draftResources;
	const api =
		kind === "file"
			? {
					upload: client.uploadFile,
					discard: client.discardFileUpload,
					preview: client.previewFileUploads,
					commit: client.commitFileUploads,
				}
			: {
					upload: client.uploadSkill,
					discard: client.discardSkillUpload,
					preview: client.previewSkillUploads,
					commit: client.commitSkillUploads,
				};
	const label = kind === "file" ? "文件" : "Skill";
	const [uploads, setUploads] = useState<ProjectUpload[]>([]);
	const owned = useRef(new Map<string, ProjectUpload>());
	const active = useRef(true);
	const available = useRef(enabled);
	const canUpload = () => active.current && available.current;
	useLayoutEffect(() => {
		available.current = enabled;
	});
	const discard = useAdminMutation(async (ids: string[]) => {
		await Promise.allSettled(ids.map((id) => api.discard(workbench.name, id)));
	});
	// 关闭清理独立于单项移除，避免其 pending 状态阻断关闭后的清理。
	const discardOnClose = useAdminMutation(async (ids: string[]) => {
		await Promise.allSettled(ids.map((id) => api.discard(workbench.name, id)));
	});
	const cleanupQueue = useRef(Promise.resolve());
	const cleanup = useCallback(
		(ids: string[]) => {
			cleanupQueue.current = cleanupQueue.current
				.then(() => discard.run(ids))
				.catch(() => undefined)
				.finally(() => {
					for (const id of ids) owned.current.delete(id);
				});
		},
		[discard.run],
	);
	const abandon = useCallback(() => {
		active.current = false;
		const ids = [...owned.current.keys()];
		if (ids.length) void discardOnClose.run(ids).catch(() => undefined);
		owned.current.clear();
	}, [discardOnClose.run]);
	useEffect(() => {
		active.current = true;
		return abandon;
	}, [abandon]);
	async function uploadOne(file: File) {
		const result = await api.upload(workbench.name, baseRevision, file, file.name);
		if (!canUpload()) {
			await api.discard(workbench.name, result.upload_id).catch(() => undefined);
			return;
		}
		owned.current.set(result.upload_id, result);
		setUploads((current) => [...current, result]);
		return result;
	}
	const upload = useAdminMutation(async (selection: File[]) => {
		if (!canUpload()) throw new Error(`当前项目不能上传${label}。`);
		if (uploads.length + selection.length > 20)
			throw new Error(`每次保存最多新增 20 个${label}，当前已有 ${uploads.length} 个，请减少本次选择的文件。`);
		const failures: string[] = [];
		const completed: (ProjectUpload | undefined)[] = [];
		for (const file of selection) {
			if (!canUpload()) break;
			try {
				completed.push(await uploadOne(file));
			} catch (error) {
				failures.push(uploadFailure(file, error));
			}
		}
		if (failures.length) throw new Error(failures.join("；"));
		return completed.filter((result) => result !== undefined);
	});
	return {
		uploads,
		pending: upload.pending,
		error: upload.error,
		upload: upload.run,
		abandon,
		remove(id: string) {
			setUploads((current) => current.filter((upload) => upload.upload_id !== id));
			cleanup([id]);
		},
		preview(ids: string[]) {
			return api.preview(workbench.name, { base_revision: baseRevision, upload_ids: ids });
		},
		commit(ids: string[]) {
			return api.commit(workbench.name, { base_revision: baseRevision, upload_ids: ids });
		},
		committed(ids: string[]) {
			for (const id of ids) owned.current.delete(id);
		},
	};
}
