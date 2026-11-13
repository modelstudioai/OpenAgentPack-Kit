import { type ProjectAgentCreateInput, ProjectAgentCreateInputSchema } from "@openagentpack/kit-sdk/protocol";
import { Alert, Button, Form, Input } from "antd";
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import { AgentVersionConfigurationView } from "./agent-version-configuration-view.tsx";
import { MANAGED_AGENT_MODELS } from "./managed-agent-models.ts";
import { TemplateAgentCapabilities } from "./template-agent-capability-picker.tsx";
import { copyFieldLabel } from "./template-agent-copy-issues.ts";
import {
	type AgentFormDetail,
	type AgentFormDraft,
	agentFormDeclaration,
	agentFormDraftChanged,
	agentFormInput,
	agentFormPreview,
	createAgentFormDraft,
} from "./template-agent-form-draft.ts";
import { mcpDraftErrors } from "./template-agent-mcp-draft.ts";
import { TemplateAgentMcpFields } from "./template-agent-mcp-fields.tsx";
import { TemplateAgentModelPicker } from "./template-agent-model-picker.tsx";
import { TemplateAgentMultiagentFields } from "./template-agent-multiagent-fields.tsx";
import { TemplateAgentToolsFields } from "./template-agent-tools-fields.tsx";
import styles from "./template-forms.module.less";
import { type TemplateAgentSelection, useTemplateLocalResources } from "./template-local-resources.tsx";
import { useTemplateResourceDraft } from "./template-resource-draft.tsx";
import { useTemplateDraftProject } from "./use-template-draft-project.ts";

export type AgentFormState = { dirty: boolean; valid: boolean; preview?: AgentFormDetail };
export type AgentFormHandle = { save: () => Promise<TemplateAgentSelection | null> };
const fields = [
	{ key: "name", label: "名称", accessibleName: "智能体名称", maxLength: 255, rows: 0 },
	{ key: "description", label: "描述", accessibleName: "智能体描述", maxLength: 1024, rows: 3 },
	{ key: "instructions", label: "系统提示词", accessibleName: "系统提示词", maxLength: 65536, rows: 8 },
] as const;
type FieldName = (typeof fields)[number]["key"] | "model";

type Props = {
	selected: TemplateAgentSelection | null;
	detail?: AgentFormDetail;
	version: ReactNode;
	ref: Ref<AgentFormHandle>;
	onPendingChange?: (pending: boolean) => void;
	onStateChange: (state: AgentFormState) => void;
};

async function saveAgentSource(
	client: ReturnType<typeof getAdminClient>,
	projectName: string,
	input: ProjectAgentCreateInput,
	selected: TemplateAgentSelection | null,
) {
	if (!selected?.local || selected.local.projectName !== projectName)
		return client.draftResources.createAgent(projectName, input);
	const source = await client.draftResources.declaration(projectName, "agent", selected.local.id);
	const updated = await client.draftResources.putDeclaration(projectName, "agent", selected.local.id, {
		base_revision: source.base_revision,
		declaration: agentFormDeclaration(input, source.declaration),
	});
	return {
		new_revision: updated.new_revision,
		agent: { id: selected.local.id, name: input.name },
	};
}
function validationErrors(issues: { path: PropertyKey[]; message: string }[]) {
	const next: Partial<Record<FieldName, string>> = {};
	for (const issue of issues) {
		const key = issue.path[0] as FieldName;
		if (["name", "model", "description", "instructions"].includes(key))
			next[key] = key === "model" ? "请选择模型" : issue.message;
	}
	return next;
}
function useAgentForm({ selected, detail, ref, onPendingChange, onStateChange }: Props) {
	const client = useMemo(getAdminClient, []);
	const identity = useAdminQuery("templates:agent-create:identity", (signal) => client.identity(signal));
	const [initial] = useState(() => createAgentFormDraft(detail, selected?.skill_names));
	const [draft, setDraft] = useState(initial.draft);
	const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
	const [uploadPending, setUploadPending] = useState(false);
	const [projectRevision, setProjectRevision] = useState<string>();
	const local = useTemplateLocalResources();
	const resources = useTemplateResourceDraft();
	const project = useTemplateDraftProject("agent-inline", false);
	const inputs = useRef<Partial<Record<FieldName, { focus: () => void } | null>>>({});
	const dirty = agentFormDraftChanged(initial.draft, draft);
	const valid =
		!initial.error &&
		mcpDraftErrors(draft.mcpServers).size === 0 &&
		ProjectAgentCreateInputSchema.safeParse(agentFormInput(draft, "draft")).success;
	const editable = identity.data?.role === "admin" && !initial.error;
	const prepareProject = async () => {
		const current = await project.prepare();
		if (current.overview.active_mutation) throw new Error("项目正在修改，请稍后重试。");
		setProjectRevision(current.overview.project_revision);
		return current;
	};
	const validate = () => {
		if (selected && !dirty) return;
		if (!editable) throw new Error(initial.error ?? "当前身份不可编辑基础配置");
		if (mcpDraftErrors(draft.mcpServers).size) throw new Error("请检查 MCP 服务标识和工具配置");
		const parsed = ProjectAgentCreateInputSchema.safeParse(agentFormInput(draft, "draft"));
		if (!parsed.success) {
			const next = validationErrors(parsed.error.issues);
			setErrors(next);
			inputs.current[Object.keys(next)[0] as FieldName]?.focus();
			throw new Error("请检查基础配置");
		}
	};
	const save = useAdminMutation(async () => {
		if (selected && !dirty) return selected;
		const parsed = ProjectAgentCreateInputSchema.parse(agentFormInput(draft, "draft"));
		const current = await prepareProject();
		const input = { ...parsed, base_revision: current.overview.project_revision };
		const result = await saveAgentSource(client, current.draft_id, input, selected);
		return {
			...local.addAgent(result, current.draft_id),
			skill_names: Object.fromEntries(draft.capabilities.skills.map((skill) => [skill.key, skill.name])),
		};
	});
	const busy = save.pending || uploadPending || project.projects.loading;
	const submit = async () => {
		validate();
		return save.run();
	};
	useImperativeHandle(ref, () => ({ save: submit }));
	useEffect(() => {
		onPendingChange?.(busy);
		return () => onPendingChange?.(false);
	}, [busy, onPendingChange]);
	useEffect(() => {
		onStateChange({
			dirty,
			valid: selected && !dirty ? true : valid,
			preview: initial.error ? detail : agentFormPreview(draft),
		});
	}, [dirty, valid, selected, draft, initial.error, detail, onStateChange]);
	useEffect(() => {
		resources.setAgentDirty(dirty);
		return () => resources.setAgentDirty(false);
	}, [dirty, resources.setAgentDirty]);
	const change = <K extends keyof AgentFormDraft>(key: K, value: AgentFormDraft[K]) => {
		setDraft((current) => ({ ...current, [key]: value }));
		setErrors((current) => ({ ...current, [key]: undefined }));
	};
	return {
		identity,
		initial,
		draft,
		errors,
		uploadPending,
		setUploadPending,
		projectRevision,
		project,
		inputs,
		dirty,
		editable,
		prepareProject,
		save,
		busy,
		change,
	};
}
export function TemplateAgentForm(props: Props) {
	const { selected, version } = props;
	const model = useAgentForm(props);
	const { identity, initial, save, project, prepareProject, dirty } = model;
	if (initial.error && props.detail)
		return (
			<div className={styles.pageStack}>
				<div role="status" className={styles.copyIssuesPanel}>
					<p>{initial.error}</p>
					<ul className={styles.copyIssuesList}>
						{initial.issues.map((issue) => (
							<li key={`${issue.field}:${issue.reason}`} className={styles.wrapAnywhere}>
								<span>
									{copyFieldLabel(issue.field)}（<code>{issue.field}</code>）
								</span>
								：{issue.reason}
							</li>
						))}
					</ul>
					<p className={styles.mutedOnly}>可直接使用原版本，或清空基础配置后重新填写。</p>
				</div>
				<AgentVersionConfigurationView detail={props.detail} versionContent={version} />
			</div>
		);

	return (
		<form noValidate className={styles.createRoot} onSubmit={(event) => event.preventDefault()}>
			{/* 纯布局上下文：不接管数据（component=false 不渲染 form 元素），字段仍由草稿状态受控 */}
			<Form component={false} layout="vertical" requiredMark={false}>
				{identity.error ? (
					<Alert
						type="error"
						showIcon
						message={identity.error}
						action={
							<Button size="small" onClick={() => void identity.refresh()}>
								重试
							</Button>
						}
					/>
				) : null}
				<AgentFormFields model={model} selected={selected} version={version} />
				<AgentFormFeedback
					error={save.error || project.projects.error}
					onRetry={() => void prepareProject().catch(() => {})}
					copying={Boolean(dirty && selected && !selected.local)}
				/>
			</Form>
		</form>
	);
}

function AgentFormFields({
	model,
	selected,
	version,
}: {
	model: ReturnType<typeof useAgentForm>;
	selected: TemplateAgentSelection | null;
	version: ReactNode;
}) {
	const {
		draft,
		errors,
		setUploadPending,
		projectRevision,
		project,
		inputs,
		dirty,
		editable,
		prepareProject,
		busy,
		change,
	} = model;
	const textField = (field: (typeof fields)[number]) => {
		const error = errors[field.key];
		const shared = {
			status: (error ? "error" : undefined) as "error" | undefined,
			"aria-label": field.accessibleName,
			"aria-invalid": Boolean(error),
			maxLength: field.maxLength,
			value: draft[field.key],
		};
		return (
			<Form.Item
				key={field.key}
				label={
					<>
						{field.label}
						{field.key === "name" ? (
							<span aria-hidden="true" className={styles.requiredStar}>
								*
							</span>
						) : null}
					</>
				}
				validateStatus={error ? "error" : undefined}
				help={error}
			>
				{field.rows ? (
					<Input.TextArea
						{...shared}
						rows={field.rows}
						ref={(el) => {
							inputs.current[field.key] = el;
						}}
						onChange={(event) => change(field.key, event.target.value)}
					/>
				) : (
					<Input
						{...shared}
						placeholder="输入智能体名称"
						ref={(el) => {
							inputs.current[field.key] = el;
						}}
						onChange={(event) => change(field.key, event.target.value)}
					/>
				)}
			</Form.Item>
		);
	};
	return (
		<>
			<fieldset disabled={busy || !editable} className={styles.shrinkRoot}>
				{textField(fields[0])}
			</fieldset>
			<Form.Item label="版本">{dirty || !selected ? <p className={styles.mutedOnly}>--</p> : version}</Form.Item>
			<fieldset disabled={busy || !editable} className={styles.configFields}>
				<section aria-label="模型">
					<TemplateAgentModelPicker
						value={draft.model}
						onChange={(value) => change("model", value)}
						error={errors.model}
						disabled={busy || !editable}
						options={
							draft.model && !MANAGED_AGENT_MODELS.some((option) => option.id === draft.model)
								? [{ id: draft.model, name: draft.model }, ...MANAGED_AGENT_MODELS]
								: MANAGED_AGENT_MODELS
						}
						triggerRef={(el) => {
							inputs.current.model = el;
						}}
					/>
				</section>
				<TemplateAgentMultiagentFields
					draft={draft}
					disabled={busy || !editable}
					currentAgentId={selected?.local ? undefined : selected?.agent_id}
					onEnabledChange={(value) => change("multiAgentEnabled", value)}
					onMembersChange={(value) => change("subAgents", value)}
				/>
				{textField(fields[1])}
				{textField(fields[2])}
				<TemplateAgentToolsFields value={draft.tools} onChange={(value) => change("tools", value)} />
			</fieldset>
			<section aria-label="MCP 服务器">
				<Form.Item label="MCP 服务器">
					<TemplateAgentMcpFields
						value={draft.mcpServers}
						disabled={busy || !editable}
						onChange={(value) => change("mcpServers", value)}
					/>
				</Form.Item>
			</section>
			<section aria-label="技能">
				<Form.Item label="技能">
					<TemplateAgentCapabilities
						projectName={project.projectName}
						revision={projectRevision ?? project.project.data?.project_revision}
						value={draft.capabilities}
						disabled={busy || !editable}
						uploadEnabled={editable}
						onPrepare={prepareProject}
						onUploadPendingChange={setUploadPending}
						onReloadProject={async () => {
							await prepareProject().catch(() => {});
						}}
						onChange={(value) => change("capabilities", value)}
					/>
				</Form.Item>
			</section>
		</>
	);
}

function AgentFormFeedback({
	error,
	copying,
	onRetry,
}: {
	error: string | null;
	copying: boolean;
	onRetry: () => void;
}) {
	return (
		<>
			{error ? (
				<Alert
					type="error"
					showIcon
					message={error}
					action={
						<Button size="small" onClick={onRetry}>
							重试
						</Button>
					}
				/>
			) : null}
			{copying ? <p className="text-neutral-500">修改后保存为新智能体，原智能体保持不变。</p> : null}
		</>
	);
}
