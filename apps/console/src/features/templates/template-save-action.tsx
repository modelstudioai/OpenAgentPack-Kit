import type {
	CreateTemplateDebugSessionRequest,
	PlazaCategory,
	TemplateCreateInput,
	TemplateView,
} from "@openagentpack/kit-sdk/protocol";
import { Alert, Button } from "antd";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import {
	type AgentPresentationDraft,
	toAgentPresentation,
	validateAgentPresentation,
} from "../catalog/agent-presentation-fields.tsx";
import { useConsoleRoute } from "../navigation/console-router.tsx";
import type { AgentFormHandle, AgentFormState } from "./template-agent-form.tsx";
import type { TemplateAgentSelection } from "./template-agent-list.tsx";
import { TemplateDebugPreview } from "./template-debug-preview.tsx";
import type { EnvironmentFormHandle, EnvironmentFormState } from "./template-environment-form.tsx";
import { hasPendingFiles, validateTemplateFiles } from "./template-file-draft.ts";
import { hasPendingMemories, validateTemplateMemories } from "./template-memory-draft.ts";
import { validateTemplateName } from "./template-name-field.tsx";
import styles from "./template-pages.module.less";
import { TemplatePublishStatus } from "./template-publish-status.tsx";
import { TemplateSaveDialog } from "./template-save-dialog.tsx";
import { hasPendingVaults, validateTemplateVaults } from "./template-vault-draft.ts";
import { type TemplateStep, TemplateWizardSteps } from "./template-wizard-steps.tsx";
import type { FileFormHandle } from "./use-template-file-form.ts";
import type { MemoryFormHandle } from "./use-template-memory-form.ts";
import { useTemplatePublish } from "./use-template-publish.ts";
import {
	hasLocalResources,
	type TemplateRuntimeSelection,
	useTemplateResourceResolution,
} from "./use-template-resource-resolution.ts";
import type { VaultFormHandle } from "./use-template-vault-form.ts";

interface TemplateSaveActionProps {
	agentForm: RefObject<AgentFormHandle | null>;
	agentState: AgentFormState;
	environmentForm: RefObject<EnvironmentFormHandle | null>;
	environmentState: EnvironmentFormState;
	fileForm: RefObject<FileFormHandle | null>;
	memoryForm: RefObject<MemoryFormHandle | null>;
	vaultForm: RefObject<VaultFormHandle | null>;
	step: TemplateStep;
	onStepChange: (step: TemplateStep) => void;
	name: string;
	onNameChange: (name: string) => void;
	onReturnToName: () => void;
	category: PlazaCategory;
	presentation: AgentPresentationDraft;
	selection: TemplateRuntimeSelection;
	onResolved: (selection: TemplateRuntimeSelection) => void;
	busy: boolean;
	editingTemplate?: TemplateView;
	onSaved: (template: TemplateView) => void;
	onPendingChange: (pending: boolean) => void;
}

function runtimeInput(selection: TemplateRuntimeSelection, editing: boolean): CreateTemplateDebugSessionRequest | null {
	if (!selection.agent) return null;
	return {
		remote_agent_id: selection.agent.agent_id,
		agent_version: selection.agent.agent_version,
		...(selection.environment ? { remote_environment_id: selection.environment.environment_id } : {}),
		files: selection.files.map(({ file_id, mount_path, filename, size }) =>
			editing ? { file_id, mount_path, filename, size } : { file_id, mount_path },
		),
		memory_stores: selection.memories.map(({ memory_store_id, access, instructions }) => ({
			memory_store_id,
			access,
			...(instructions.trim() ? { instructions: instructions.trim() } : {}),
		})),
		vault_ids: selection.vaults.map(({ vault_id }) => vault_id),
	};
}

/** 展示文案或资源元数据变化不重建会话；真正的运行时变化立即释放旧 owner。 */
function runtimeKey(input: CreateTemplateDebugSessionRequest | null) {
	return input
		? JSON.stringify({ ...input, files: input.files?.map(({ file_id, mount_path }) => ({ file_id, mount_path })) })
		: null;
}

function useTemplateWorkflow(props: TemplateSaveActionProps) {
	const {
		name,
		selection,
		editingTemplate,
		presentation,
		category,
		busy,
		onPendingChange,
		onReturnToName,
		onResolved,
		onStepChange,
	} = props;
	const client = useMemo(getAdminClient, []);
	const identity = useAdminQuery("templates:create:identity", (signal) => client.identity(signal));
	const opener = useRef<HTMLElement | null>(null);
	const [input, setInput] = useState<Omit<TemplateCreateInput, "name"> | null>(null);
	const [saving, setSaving] = useState(false);
	const [debugBusy, setDebugBusy] = useState(false);
	const [restoreFocus, setRestoreFocus] = useState(false);
	const [preview, setPreview] = useState<{
		key: string;
		input: CreateTemplateDebugSessionRequest;
		agent: TemplateAgentSelection;
	} | null>(null);
	const current = runtimeInput(selection, Boolean(editingTemplate));
	const key =
		props.agentState.dirty ||
		props.environmentState.dirty ||
		hasPendingFiles(selection.files) ||
		hasPendingMemories(selection.memories) ||
		hasPendingVaults(selection.vaults) ||
		hasLocalResources(selection)
			? null
			: runtimeKey(current);
	if (preview && preview.key !== key) setPreview(null);
	const valid =
		props.agentState.valid &&
		props.environmentState.valid &&
		!validateTemplateFiles(selection.files) &&
		!validateTemplateName(name) &&
		!validateAgentPresentation(presentation) &&
		!validateTemplateMemories(selection.memories) &&
		!validateTemplateVaults(selection.vaults);
	const resolution = useTemplateResourceResolution(selection, (resolved) => {
		onResolved(resolved);
		const prepared = runtimeInput(resolved, Boolean(editingTemplate));
		if (
			!resolved.agent ||
			!prepared ||
			hasLocalResources(resolved) ||
			hasPendingFiles(resolved.files) ||
			hasPendingMemories(resolved.memories) ||
			hasPendingVaults(resolved.vaults)
		)
			return;
		setPreview({ key: runtimeKey(prepared)!, input: prepared, agent: resolved.agent });
		onStepChange("preview");
	});
	const publish = useTemplatePublish({ onPublished: resolution.start });
	const prepareAgent = useAdminMutation(async () => {
		const agent = await props.agentForm.current?.save();
		if (!agent) throw new Error("请先完成基础配置");
		flushSync(() => onResolved({ ...selection, agent }));
		if (!props.environmentForm.current) throw new Error("请先加载环境配置");
		const environment = await props.environmentForm.current.save();
		flushSync(() => onResolved({ ...selection, agent, environment }));
		if (!props.fileForm.current) throw new Error("请先加载文件配置");
		const files = await props.fileForm.current.save();
		flushSync(() => onResolved({ ...selection, agent, environment, files }));
		if (!props.memoryForm.current) throw new Error("请先加载记忆库配置");
		const memories = await props.memoryForm.current.save();
		flushSync(() => onResolved({ ...selection, agent, environment, files, memories }));
		if (!props.vaultForm.current) throw new Error("请先加载密钥库配置");
		const vaults = await props.vaultForm.current.save();
		flushSync(() => onResolved({ ...selection, agent, environment, files, memories, vaults }));
		publish.start();
	});
	const pending = prepareAgent.pending || publish.busy || resolution.pending || saving || Boolean(input) || debugBusy;
	const disabled = busy || pending || publish.blocked || !valid || identity.data?.role !== "admin";
	useEffect(() => {
		onPendingChange(pending);
		return () => onPendingChange(false);
	}, [pending, onPendingChange]);
	useEffect(() => {
		if (!restoreFocus || busy || pending) return;
		if (disabled) onReturnToName();
		else opener.current?.focus({ preventScroll: true });
		opener.current = null;
		setRestoreFocus(false);
	}, [restoreFocus, busy, pending, disabled, onReturnToName]);
	function prepare() {
		if (disabled) return;
		// 逐项保存有修改的本地声明；未改动的云端配置直接复用。
		if (
			props.agentState.dirty ||
			props.environmentState.dirty ||
			hasPendingFiles(selection.files) ||
			hasPendingMemories(selection.memories) ||
			hasPendingVaults(selection.vaults) ||
			!selection.agent
		)
			void prepareAgent.run().catch(() => {});
		else if (resolution.error) resolution.retry();
		else publish.start();
	}
	function openSave(button: HTMLElement) {
		if (disabled || !preview || !current) return;
		opener.current = button;
		setInput({ ...current, category, ...toAgentPresentation(presentation) });
	}
	return {
		identity,
		prepareError: prepareAgent.error,
		opener,
		input,
		saving,
		setSaving,
		preview,
		setDebugBusy,
		pending,
		disabled,
		publish,
		resolution,
		prepare,
		openSave,
		closeSave: () => {
			setInput(null);
			setRestoreFocus(true);
		},
	};
}

/** 配置页先准备本批资源，确认发布并解析后进入调试；预览步骤再打开保存表单。 */
export function TemplateSaveAction(props: TemplateSaveActionProps) {
	const { step, onStepChange, name, onNameChange, presentation, busy, editingTemplate, onSaved } = props;
	const model = useTemplateWorkflow(props);
	const { route, complete } = useConsoleRoute();
	useEffect(() => {
		if (step === "preview" && !model.preview) complete({ ...route, step: undefined }, true);
	}, [step, model.preview, route, complete]);
	const {
		identity,
		opener,
		input,
		setSaving,
		preview,
		setDebugBusy,
		pending,
		disabled,
		publish,
		resolution,
		prepare,
		openSave,
		closeSave,
	} = model;
	return (
		<div className={styles.contents}>
			<TemplateWizardSteps
				step={step}
				editing={Boolean(editingTemplate)}
				busy={busy || pending}
				canPreview={!disabled}
				onSelect={(next) => {
					if (next === "config") onStepChange(next);
					else if (step !== "preview") prepare();
				}}
			/>
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
			{model.prepareError ? <Alert type="error" showIcon message={model.prepareError} /> : null}
			{identity.data?.role === "auditor" ? <p>当前身份只读，不能调试或保存智能体。</p> : null}
			<TemplatePublishStatus publish={publish} onRetry={prepare} retryDisabled={disabled} />
			{resolution.pending ? <p role="status">正在读取已发布资源…</p> : null}
			{resolution.error ? (
				<div className={styles.stack2}>
					<Alert type="error" showIcon message={resolution.error} />
					<Button disabled={disabled} onClick={resolution.retry}>
						重试读取资源
					</Button>
				</div>
			) : null}
			{preview ? (
				<div hidden={step !== "preview"}>
					<TemplateDebugPreview
						key={preview.key}
						input={{ ...preview.input, title: `${name.trim()} 预览调试` }}
						agent={preview.agent}
						name={name}
						presentation={toAgentPresentation(presentation)}
						onBusyChange={setDebugBusy}
					/>
				</div>
			) : null}
			<footer role="contentinfo" aria-label="模版配置操作" className={styles.wizardFooter}>
				<div className={styles.wizardFooterInner}>
					{step === "preview" ? (
						<Button disabled={busy || pending} onClick={() => onStepChange("config")}>
							上一步：选择配置
						</Button>
					) : null}
					<Button
						type="primary"
						disabled={disabled}
						onClick={(event) => {
							if (step === "config") prepare();
							else openSave(event.currentTarget);
						}}
					>
						{step === "config" ? "下一步：预览调试" : editingTemplate ? "保存修改" : "保存智能体"}
					</Button>
				</div>
			</footer>
			{input && opener.current ? (
				<TemplateSaveDialog
					opener={opener.current}
					name={name}
					onNameChange={onNameChange}
					input={input}
					editingTemplate={editingTemplate}
					onPendingChange={setSaving}
					onSaved={onSaved}
					onClose={closeSave}
				/>
			) : null}
		</div>
	);
}
