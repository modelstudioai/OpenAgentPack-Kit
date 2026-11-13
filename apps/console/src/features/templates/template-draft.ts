import type { PlazaCategory, PresetPackPreview, TemplateView } from "@openagentpack/kit-sdk/protocol";
import { type AgentPresentationDraft, EMPTY_AGENT_PRESENTATION } from "../catalog/agent-presentation-fields.tsx";
import type { TemplateAgentSelection } from "./template-agent-list.tsx";
import { type TemplateFileDraft, validateTemplateFiles } from "./template-file-draft.ts";
import type { TemplateEnvironmentSelection } from "./template-local-resources.tsx";
import { MAX_TEMPLATE_MEMORIES, type TemplateMemoryDraft } from "./template-memory-draft.ts";
import { MAX_TEMPLATE_VAULTS, type TemplateVaultDraft } from "./template-vault-draft.ts";

interface TemplateDraft {
	name: string;
	agent: TemplateAgentSelection | null;
	environment: TemplateEnvironmentSelection | null;
	files: TemplateFileDraft[];
	memories: TemplateMemoryDraft[];
	vaults: TemplateVaultDraft[];
	category: PlazaCategory;
	presentation: AgentPresentationDraft;
}
export type TemplateDisplayDraft = Pick<TemplateDraft, "name" | "category" | "presentation">;
export type TemplateRuntimeDraft = Pick<TemplateDraft, "environment" | "files" | "memories" | "vaults">;

function appendResourceReferences<T>(current: T[], imported: T[], id: (item: T) => string): T[] {
	const existing = new Set(current.map(id));
	return [...current, ...imported.filter((item) => !existing.has(id(item)))];
}

/** 关联资源只补充引用；相同身份保留用户已有路径、权限及编辑草稿，全部校验后才交给表单。 */
export function mergeTemplateRuntimeResources(
	current: TemplateRuntimeDraft,
	preset: PresetPackPreview,
): TemplateRuntimeDraft {
	const imported = createTemplateDraft(undefined, preset);
	const environment = imported.environment;
	const result = {
		environment:
			environment && environment.environment_id !== current.environment?.environment_id
				? environment
				: current.environment,
		files: appendResourceReferences(current.files, imported.files, (file) => file.file_id),
		memories: appendResourceReferences(current.memories, imported.memories, (memory) => memory.memory_store_id),
		vaults: appendResourceReferences(current.vaults, imported.vaults, (vault) => vault.vault_id),
	};
	const fileError = validateTemplateFiles(result.files);
	if (fileError) throw new Error(fileError);
	if (result.memories.length > MAX_TEMPLATE_MEMORIES) throw new Error(`最多选择 ${MAX_TEMPLATE_MEMORIES} 个记忆库`);
	if (result.vaults.length > MAX_TEMPLATE_VAULTS) throw new Error(`最多选择 ${MAX_TEMPLATE_VAULTS} 个密钥库`);
	return result;
}

/** 编辑从已保存快照恢复草稿；远端候选加载不改变原有资源引用。 */
export function createTemplateDraft(
	template?: TemplateView,
	preset?: PresetPackPreview,
	display?: TemplateDisplayDraft,
): TemplateDraft {
	const source = template ?? preset;
	if (!source)
		return {
			name: "",
			agent: null,
			environment: null,
			files: [],
			memories: [],
			vaults: [],
			category: "general",
			presentation: EMPTY_AGENT_PRESENTATION,
		};
	return {
		name: display?.name ?? template?.name ?? "",
		agent: {
			agent_id: source.remote_agent_id,
			name: source.remote_agent_name || source.remote_agent_id,
			version: template?.remote_agent_version ?? preset?.agent_version,
			agent_version: source.agent_version,
		},
		environment: source.remote_environment_id
			? {
					environment_id: source.remote_environment_id,
					name: source.remote_environment_name || source.remote_environment_id,
				}
			: null,
		files: source.files.map((file) => ({ ...file, filename: file.filename || file.file_id, available: true })),
		memories: source.memory_stores.map((memory) => ({
			...memory,
			key: memory.memory_store_id,
			instructions: memory.instructions ?? "",
			...(preset ? { name: memory.memory_store_id, referenceOnly: true } : {}),
		})),
		vaults: source.vault_ids.map((id) => ({ vault_id: id, name: id })),
		category: display?.category ?? template?.category ?? "general",
		presentation: display?.presentation ?? {
			description: template?.description ?? "",
			opening_remarks: template?.opening_remarks ?? "",
			suggested_prompts: template?.suggested_prompts.join("\n") ?? "",
		},
	};
}
