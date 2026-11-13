import { useEffect, useMemo, useState } from "react";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import { useTemplateResourceDraft } from "./template-resource-draft.tsx";

/** 弹窗打开后初始化；主页面传 enabled=false，在添加能力或保存时调用 prepare。同一轮资源共用隔离项目。 */
export function useTemplateDraftProject(kind: string, enabled = true) {
	const client = useMemo(getAdminClient, []);
	const resources = useTemplateResourceDraft();
	const [projectName, setProjectName] = useState("");
	const ensure = useAdminMutation(async (readOverview = false) => {
		const draft = await resources.ensureDraft();
		setProjectName(draft.draft_id);
		return { ...draft, overview: readOverview ? await client.draftResources.overview(draft.draft_id) : undefined };
	});
	useEffect(() => {
		let cancelled = false;
		queueMicrotask(() => {
			if (!cancelled && enabled) void ensure.run().catch(() => {});
		});
		return () => {
			cancelled = true;
		};
	}, [ensure.run, enabled]);
	const project = useAdminQuery(
		`templates:${kind}-create:project:${projectName}`,
		(signal) => client.draftResources.overview(projectName, signal),
		{ enabled: Boolean(projectName) },
	);
	return {
		prepare: async () => {
			const result = await ensure.run(true);
			return { ...result, overview: result.overview! };
		},
		projectName,
		project,
		projects: {
			data: projectName ? [{ name: projectName }] : undefined,
			loading: ensure.pending,
			error: ensure.error,
			refresh: () => ensure.run().catch(() => undefined),
		},
	};
}
