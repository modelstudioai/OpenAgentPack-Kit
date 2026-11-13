import { ErrorState } from "@openagentpack/kit-chat-ui";
import type { RemoteEnvironmentDetail } from "@openagentpack/kit-sdk/protocol";
import { type Ref, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import { EnvironmentCreateFields } from "./environment-create-fields.tsx";
import { EnvironmentDetailView } from "./environment-detail-view.tsx";
import {
	createEnvironmentDraft,
	environmentCopyIssues,
	environmentDraftFingerprint,
	environmentFormDeclaration,
	environmentFormInput,
	environmentValidationError,
} from "./template-environment-form-draft.ts";
import styles from "./template-forms.module.less";
import { type TemplateEnvironmentSelection, useTemplateLocalResources } from "./template-local-resources.tsx";
import { useTemplateResourceDraft } from "./template-resource-draft.tsx";
import { useTemplateDraftProject } from "./use-template-draft-project.ts";

export type EnvironmentFormState = { dirty: boolean; valid: boolean; name?: string };
export type EnvironmentFormHandle = { save: () => Promise<TemplateEnvironmentSelection | null> };
const fieldLabels: Record<string, string> = {
	name: "环境名称",
	description: "描述",
	metadata: "元数据",
	scope: "作用域",
	configuration: "其他环境配置",
	"configuration.type": "环境类型",
	"configuration.networking": "网络策略",
	"configuration.packages": "预装包",
	"configuration.environment_variables": "环境变量",
	"configuration.setup_script": "初始化脚本",
};

type Props = {
	selected: TemplateEnvironmentSelection | null;
	detail?: RemoteEnvironmentDetail;
	ref: Ref<EnvironmentFormHandle>;
	onPendingChange?: (pending: boolean) => void;
	onStateChange: (state: EnvironmentFormState) => void;
};

async function saveEnvironmentSource(
	client: ReturnType<typeof getAdminClient>,
	projectName: string,
	input: ReturnType<typeof environmentFormInput>,
	selected: TemplateEnvironmentSelection | null,
) {
	if (!selected?.local || selected.local.projectName !== projectName)
		return client.draftResources.createEnvironment(projectName, input);
	const source = await client.draftResources.declaration(projectName, "environment", selected.local.id);
	const updated = await client.draftResources.putDeclaration(projectName, "environment", selected.local.id, {
		base_revision: source.base_revision,
		declaration: environmentFormDeclaration(input, source.declaration),
	});
	return {
		new_revision: updated.new_revision,
		environment: { id: selected.local.id, name: input.name },
	};
}

function useEnvironmentForm({ selected, detail, ref, onPendingChange, onStateChange }: Props) {
	const client = useMemo(getAdminClient, []);
	const identity = useAdminQuery("templates:environment-form:identity", (signal) => client.identity(signal));
	const [initial] = useState(() => createEnvironmentDraft(detail));
	const [draft, setDraft] = useState(initial);
	const issues = detail ? environmentCopyIssues(detail) : [];
	const local = useTemplateLocalResources();
	const resources = useTemplateResourceDraft();
	const project = useTemplateDraftProject("environment-inline", false);
	const dirty = environmentDraftFingerprint(initial) !== environmentDraftFingerprint(draft);
	const validationError = dirty || selected ? environmentValidationError(draft) : undefined;
	const valid = selected && !dirty ? true : !validationError && !issues.length;
	const save = useAdminMutation(async () => {
		if (!dirty) return selected;
		if (identity.data?.role !== "admin" || issues.length) throw new Error("当前环境配置不可编辑");
		const input = environmentFormInput(draft, "draft");
		const current = await project.prepare();
		if (current.overview.active_mutation) throw new Error("项目正在修改，请稍后重试。");
		const result = await saveEnvironmentSource(
			client,
			current.draft_id,
			{
				...input,
				base_revision: current.overview.project_revision,
			},
			selected,
		);
		return local.addEnvironment(result, current.draft_id);
	});
	const busy = save.pending || project.projects.loading;
	useImperativeHandle(ref, () => ({ save: () => save.run() }));
	useEffect(() => {
		onPendingChange?.(busy);
		return () => onPendingChange?.(false);
	}, [busy, onPendingChange]);
	useEffect(() => {
		onStateChange({ dirty, valid, name: draft.name });
	}, [dirty, valid, draft.name, onStateChange]);
	useEffect(() => {
		resources.setEnvironmentDirty(dirty);
		return () => resources.setEnvironmentDirty(false);
	}, [dirty, resources.setEnvironmentDirty]);
	return { identity, draft, setDraft, issues, dirty, validationError, busy, save, project };
}

export function TemplateEnvironmentForm(props: Props) {
	const { selected, detail } = props;
	const { identity, draft, setDraft, issues, dirty, validationError, busy, save, project } = useEnvironmentForm(props);
	return (
		<form noValidate className={styles.pageStack} onSubmit={(event) => event.preventDefault()}>
			{identity.error ? <ErrorState message={identity.error} onRetry={() => void identity.refresh()} /> : null}
			{issues.length && detail ? (
				<>
					<div role="status" className={styles.copyIssuesPanel}>
						<p>此环境包含当前表单无法完整复制的配置，可直接使用原环境，或清空后重新填写。</p>
						<ul className={styles.copyIssuesList}>
							{issues.map((field) => (
								<li key={field} className={styles.wrapAnywhere}>
									{fieldLabels[field]}（<code>{field}</code>）
								</li>
							))}
						</ul>
					</div>
					<EnvironmentDetailView detail={detail} />
				</>
			) : (
				<fieldset disabled={busy || identity.data?.role !== "admin"} className={styles.shrinkRoot}>
					<EnvironmentCreateFields value={draft} onChange={setDraft} />
				</fieldset>
			)}
			{dirty && validationError ? (
				<p role="alert" className={styles.errorText}>
					{validationError}
				</p>
			) : null}
			{dirty && selected && !selected.local ? (
				<p className={styles.formNote}>修改后保存为新环境，原环境保持不变。</p>
			) : null}
			{save.error || project.projects.error ? (
				<ErrorState message={save.error || project.projects.error || "环境保存失败"} />
			) : null}
		</form>
	);
}
