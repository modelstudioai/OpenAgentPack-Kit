import type {
	PlazaCategory,
	PresetPackAgentResources,
	PresetPackPreview,
	TemplateView,
} from "@openagentpack/kit-sdk/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AgentPresentationDraft, AgentPresentationFields } from "../catalog/agent-presentation-fields.tsx";
import { PlazaCategoryField } from "../catalog/plaza-category-field.tsx";
import { useConsoleRoute } from "../navigation/console-router.tsx";
import { InnerLayout } from "../navigation/inner-layout.tsx";
import { TemplateAgentConfiguration } from "./template-agent-configuration.tsx";
import type { AgentFormHandle, AgentFormState } from "./template-agent-form.tsx";
import type { TemplateAgentSelection } from "./template-agent-list.tsx";
import { TemplateAgentRuntimeResources } from "./template-agent-runtime-resources.tsx";
import { TemplateConfigurationSummary } from "./template-configuration-summary.tsx";
import { createTemplateDraft, mergeTemplateRuntimeResources, type TemplateDisplayDraft } from "./template-draft.ts";
import { TemplateEnvironmentConfiguration } from "./template-environment-configuration.tsx";
import type { EnvironmentFormHandle, EnvironmentFormState } from "./template-environment-form.tsx";
import { TemplateFileConfiguration } from "./template-file-configuration.tsx";
import type { TemplateFileDraft } from "./template-file-selection.tsx";
import {
	type TemplateEnvironmentSelection,
	TemplateLocalResourcesProvider,
	TemplateLocalResourcesStatus,
} from "./template-local-resources.tsx";
import { TemplateMemoryConfiguration } from "./template-memory-configuration.tsx";
import type { TemplateMemoryDraft } from "./template-memory-selection.tsx";
import { TemplateNameField } from "./template-name-field.tsx";
import styles from "./template-pages.module.less";
import { TemplatePresetPicker } from "./template-preset-picker.tsx";
import { useTemplateResourceDraft } from "./template-resource-draft.tsx";
import { TemplateSaveAction } from "./template-save-action.tsx";
import { TemplateVaultConfiguration } from "./template-vault-configuration.tsx";
import type { TemplateVaultDraft } from "./template-vault-draft.ts";
import type { TemplateStep } from "./template-wizard-steps.tsx";
import type { FileFormHandle } from "./use-template-file-form.ts";
import type { MemoryFormHandle } from "./use-template-memory-form.ts";
import type { VaultFormHandle } from "./use-template-vault-form.ts";

/** 新建与编辑共用配置、预览调试两步；先发布本批资源，再调试和保存远端引用。 */
export function TemplateEditorPage(props: TemplateEditorProps) {
	return (
		<TemplateLocalResourcesProvider>
			<TemplateEditorForm {...props} />
		</TemplateLocalResourcesProvider>
	);
}
export interface TemplateEditorProps {
	onPendingChange?: (pending: boolean) => void;
	onSaved: (template: TemplateView) => void;
	initialTemplate?: TemplateView;
	initialPresetPack?: PresetPackPreview;
	initialDisplay?: TemplateDisplayDraft;
	onImportPreset?: (preset: PresetPackPreview, display: TemplateDisplayDraft) => void;
	onCancel?: () => void;
}
function TemplateEditorForm({
	onPendingChange,
	onSaved,
	initialTemplate,
	initialPresetPack,
	initialDisplay,
	onImportPreset,
	onCancel,
}: TemplateEditorProps) {
	const { route, complete } = useConsoleRoute();
	const [initialDraft] = useState(() => createTemplateDraft(initialTemplate, initialPresetPack, initialDisplay));
	const resourceDraft = useTemplateResourceDraft();
	const [name, setName] = useState(initialDraft.name);
	const step: TemplateStep = route.step ?? "config";
	const setStep = (value: TemplateStep) => complete({ ...route, step: value === "preview" ? "preview" : undefined });
	const nameField = useRef<HTMLInputElement>(null);
	const [restoreNameFocus, setRestoreNameFocus] = useState(false);
	const [selectedAgent, setSelectedAgent] = useState<TemplateAgentSelection | null>(initialDraft.agent);
	const [selectedEnvironment, setSelectedEnvironment] = useState<TemplateEnvironmentSelection | null>(
		initialDraft.environment,
	);
	const [selectedFiles, setSelectedFiles] = useState<TemplateFileDraft[]>(initialDraft.files);
	const [selectedMemories, setSelectedMemories] = useState<TemplateMemoryDraft[]>(initialDraft.memories);
	const [selectedVaults, setSelectedVaults] = useState<TemplateVaultDraft[]>(initialDraft.vaults);
	const [category, setCategory] = useState<PlazaCategory>(initialDraft.category);
	const [presentation, setPresentation] = useState<AgentPresentationDraft>(initialDraft.presentation);
	const [saving, setSaving] = useState(false);
	const [environmentSaving, setEnvironmentSaving] = useState(false);
	const [fileSaving, setFileSaving] = useState(false);
	const [vaultSaving, setVaultSaving] = useState(false);
	const [memorySaving, setMemorySaving] = useState(false);
	const [agentSaving, setAgentSaving] = useState(false);
	const [presetReplacing, setPresetReplacing] = useState(false);
	const [runtimeAgent, setRuntimeAgent] = useState<{
		agent: TemplateAgentSelection;
		resources?: PresetPackAgentResources;
	} | null>(null);
	const closeRuntimeResources = useCallback(() => setRuntimeAgent(null), []);
	const agentForm = useRef<AgentFormHandle>(null);
	const [agentState, setAgentState] = useState<AgentFormState>({ dirty: false, valid: Boolean(initialDraft.agent) });
	const [agentRevision, setAgentRevision] = useState(0);
	const environmentForm = useRef<EnvironmentFormHandle>(null);
	const [environmentState, setEnvironmentState] = useState<EnvironmentFormState>({ dirty: false, valid: true });
	const [environmentRevision, setEnvironmentRevision] = useState(0);
	const fileForm = useRef<FileFormHandle>(null);
	const memoryForm = useRef<MemoryFormHandle>(null);
	const vaultForm = useRef<VaultFormHandle>(null);
	const hasResourceConfiguration = [
		selectedAgent,
		selectedEnvironment,
		agentState.dirty,
		environmentState.dirty,
		selectedFiles.length,
		selectedMemories.length,
		selectedVaults.length,
		resourceDraft.draft && resourceDraft.draft.status !== "published",
	].some(Boolean);
	const busy = [
		saving,
		environmentSaving,
		fileSaving,
		vaultSaving,
		memorySaving,
		agentSaving,
		presetReplacing,
		runtimeAgent,
	].some(Boolean);
	useEffect(() => {
		onPendingChange?.(busy);
		return () => onPendingChange?.(false);
	}, [busy, onPendingChange]);
	useEffect(() => {
		if (!restoreNameFocus || step !== "config" || busy) return;
		const frame = requestAnimationFrame(() => {
			nameField.current?.focus();
			setRestoreNameFocus(false);
		});
		return () => cancelAnimationFrame(frame);
	}, [restoreNameFocus, step, busy]);
	return (
		<section aria-labelledby="create-template-title" className={styles.editorRoot}>
			<InnerLayout
				titleId="create-template-title"
				title={initialTemplate ? "编辑智能体" : "创建智能体"}
				onBack={onCancel}
				right={
					onImportPreset && step === "config" ? (
						<TemplatePresetPicker
							disabled={busy || resourceDraft.loading || Boolean(resourceDraft.error)}
							hasConfiguration={hasResourceConfiguration}
							onPendingChange={setPresetReplacing}
							onImport={(preset) => onImportPreset(preset, { name, category, presentation })}
						/>
					) : undefined
				}
			/>
			<TemplateLocalResourcesStatus />
			<TemplateSaveAction
				agentForm={agentForm}
				agentState={agentState}
				environmentForm={environmentForm}
				environmentState={environmentState}
				fileForm={fileForm}
				memoryForm={memoryForm}
				vaultForm={vaultForm}
				step={step}
				onStepChange={setStep}
				name={name}
				onNameChange={setName}
				onReturnToName={() => {
					setStep("config");
					setRestoreNameFocus(true);
				}}
				category={category}
				presentation={presentation}
				selection={{
					agent: selectedAgent,
					environment: selectedEnvironment,
					files: selectedFiles,
					memories: selectedMemories,
					vaults: selectedVaults,
				}}
				onResolved={(resolved) => {
					setSelectedAgent(resolved.agent);
					if (resolved.agent !== selectedAgent) setAgentRevision((value) => value + 1);
					setSelectedEnvironment(resolved.environment);
					if (resolved.environment !== selectedEnvironment) setEnvironmentRevision((value) => value + 1);
					setSelectedFiles(resolved.files);
					setSelectedMemories(resolved.memories);
					setSelectedVaults(resolved.vaults);
				}}
				busy={busy}
				editingTemplate={initialTemplate}
				onPendingChange={setSaving}
				onSaved={onSaved}
			/>
			<div hidden={step !== "config"} className={styles.editorLayout}>
				<TemplateConfigurationSummary
					name={name}
					agentConfiguration={agentState.preview}
					environment={selectedEnvironment}
					environmentName={environmentState.dirty ? environmentState.name : undefined}
					files={selectedFiles}
					memories={selectedMemories}
					vaults={selectedVaults}
				/>
				<div className={styles.editorMain}>
					<fieldset disabled={busy} className={styles.shrinkRoot}>
						<section aria-label="展示配置" className={styles.configCard}>
							<h3 className={styles.sectionTitle}>展示配置</h3>
							<TemplateNameField inputRef={nameField} value={name} onChange={setName} />
							<PlazaCategoryField label="分类" required value={category} onChange={setCategory} />
							<AgentPresentationFields value={presentation} onChange={setPresentation} />
						</section>
					</fieldset>
					<fieldset disabled={busy} className={styles.shrinkRoot}>
						<TemplateAgentConfiguration
							revision={agentRevision}
							formRef={agentForm}
							onStateChange={setAgentState}
							onClear={() => {
								setSelectedAgent(null);
								setAgentRevision((value) => value + 1);
							}}
							onPendingChange={setAgentSaving}
							selected={selectedAgent}
							onVersionChange={setSelectedAgent}
							onSelect={(agent, resources) => {
								if (selectedAgent && agent.agent_id !== selectedAgent.agent_id) {
									setSelectedEnvironment(null);
									setEnvironmentRevision((value) => value + 1);
									setSelectedFiles([]);
									setSelectedMemories([]);
									setSelectedVaults([]);
								}
								setSelectedAgent(agent);
								setRuntimeAgent(agent.local ? null : { agent, resources });
							}}
						/>
					</fieldset>
					{runtimeAgent ? (
						<TemplateAgentRuntimeResources
							key={`${runtimeAgent.agent.agent_id}:${runtimeAgent.agent.agent_version}`}
							agent={runtimeAgent.agent}
							initialResources={runtimeAgent.resources}
							onClose={closeRuntimeResources}
							onApply={(preset) => {
								const next = mergeTemplateRuntimeResources(
									{
										environment: selectedEnvironment,
										files: selectedFiles,
										memories: selectedMemories,
										vaults: selectedVaults,
									},
									preset,
								);
								if (next.environment !== selectedEnvironment) setEnvironmentRevision((value) => value + 1);
								setSelectedEnvironment(next.environment);
								setSelectedFiles(next.files);
								setSelectedMemories(next.memories);
								setSelectedVaults(next.vaults);
							}}
						/>
					) : null}
					<fieldset disabled={busy} className={styles.shrinkRoot}>
						<div className={styles.createRoot}>
							<TemplateEnvironmentConfiguration
								revision={environmentRevision}
								selected={selectedEnvironment}
								formRef={environmentForm}
								onStateChange={setEnvironmentState}
								onSelect={(environment) => {
									setSelectedEnvironment(environment);
									setEnvironmentRevision((value) => value + 1);
								}}
								onClear={() => {
									setSelectedEnvironment(null);
									setEnvironmentRevision((value) => value + 1);
								}}
								onPendingChange={setEnvironmentSaving}
							/>
							<TemplateFileConfiguration
								value={selectedFiles}
								onChange={setSelectedFiles}
								formRef={fileForm}
								onPendingChange={setFileSaving}
							/>
							<TemplateMemoryConfiguration
								value={selectedMemories}
								onChange={setSelectedMemories}
								formRef={memoryForm}
								onPendingChange={setMemorySaving}
							/>
							<TemplateVaultConfiguration
								onPendingChange={setVaultSaving}
								formRef={vaultForm}
								value={selectedVaults}
								onChange={setSelectedVaults}
							/>
						</div>
					</fieldset>
				</div>
			</div>
			{/* 固定底栏不占流内空间，页面真实末尾用等高占位垫底；两步共用，见 footerSpacer 样式注释 */}
			<div aria-hidden="true" className={styles.footerSpacer} />
		</section>
	);
}
