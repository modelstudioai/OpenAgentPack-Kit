import { type Ref, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import { hasPendingFiles, type TemplateFileDraft } from "./template-file-draft.ts";
import { createTemplateFileUploadOwner } from "./template-file-upload-owner.ts";
import { useTemplateLocalResources } from "./template-local-resources.tsx";
import { useTemplateResourceDraft } from "./template-resource-draft.tsx";
import { useTemplateDraftProject } from "./use-template-draft-project.ts";

export type FileFormHandle = { save: () => Promise<TemplateFileDraft[]> };
export function useTemplateFileForm(
	value: TemplateFileDraft[],
	ref: Ref<FileFormHandle>,
	onPendingChange?: (pending: boolean) => void,
) {
	const client = useMemo(getAdminClient, []);
	const identity = useAdminQuery("templates:file-form:identity", (signal) => client.identity(signal));
	const project = useTemplateDraftProject("file-inline", false);
	const local = useTemplateLocalResources();
	const resources = useTemplateResourceDraft();
	const latest = useRef({ project, local });
	useLayoutEffect(() => {
		latest.current = { project, local };
	});
	const owner = useMemo(
		() =>
			createTemplateFileUploadOwner({
				api: client.draftResources,
				prepare: () => latest.current.project.prepare(),
				onCommitted: (files, name) => latest.current.local.addFiles(files, name),
			}),
		[client],
	);
	useEffect(() => {
		owner.activate();
		return () => owner.dispose();
	}, [owner]);
	useEffect(() => owner.retain(value), [owner, value]);
	const save = useAdminMutation(() => {
		if (hasPendingFiles(value) && identity.data?.role !== "admin") throw new Error("当前身份不可新建文件");
		return owner.save(value);
	});
	useImperativeHandle(ref, () => ({ save: () => save.run() }));
	const busy = save.pending || project.projects.loading;
	useEffect(() => {
		onPendingChange?.(busy);
		return () => onPendingChange?.(false);
	}, [busy, onPendingChange]);
	const dirty = hasPendingFiles(value);
	useEffect(() => {
		resources.setFileDirty(dirty);
		return () => resources.setFileDirty(false);
	}, [dirty, resources.setFileDirty]);
	return { identity, busy, error: save.error || project.projects.error };
}
