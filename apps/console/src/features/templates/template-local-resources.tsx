import type {
	ProjectFileUploadCommit,
	ProjectResourceBindings,
	RemoteEnvironment,
	RemoteFile,
	RemoteMemoryStore,
	RemoteVault,
	ResourceDraftAgentCreateResult,
	ResourceDraftDeclaration,
	ResourceDraftEnvironmentCreateResult,
	ResourceDraftMemoryStoreCreateResult,
	ResourceDraftVaultCreateResult,
} from "@openagentpack/kit-sdk/protocol";
import { Alert, Button } from "antd";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import type { RemoteAgent } from "../catalog/use-remote-agents.ts";
import styles from "./template-pages.module.less";
import { TemplateResourceDraftProvider, useTemplateResourceDraft } from "./template-resource-draft.tsx";

export interface TemplateLocalResource {
	local?: { projectName: string; id: string };
}
export type TemplateEnvironmentSelection = RemoteEnvironment & TemplateLocalResource;
export type TemplateVaultSelectionValue = RemoteVault & TemplateLocalResource;
export type TemplateAgentSelection = RemoteAgent &
	TemplateLocalResource & {
		agent_version?: number;
		/** 当前页面的显示名称，不提交给模版或 Provider。 */
		skill_names?: Record<string, string>;
	};
type ResourceType = "agent" | "environment" | "file" | "memory_store" | "vault";
interface LocalCandidate {
	type: ResourceType;
	id: string;
	projectName: string;
	name: string;
	size?: number;
}
type Binding = ProjectResourceBindings["resources"][number];
const localKey = (item: LocalCandidate) => `local:${item.projectName}:${item.type}:${item.id}`;

function candidateFromDeclaration(projectName: string, item: ResourceDraftDeclaration): LocalCandidate[] {
	if (item.type === "skill") return [];
	const value = item.declaration;
	const name = item.name || (typeof value.display_name === "string" ? value.display_name : item.id);
	const sourceName = typeof value.source === "string" ? value.source.split(/[\\/]/).at(-1) : undefined;
	return [{ type: item.type, id: item.id, projectName, name: item.type === "file" ? sourceName || name : name }];
}

function identity(item: LocalCandidate, binding?: Binding) {
	return {
		id: binding?.remote_id ?? localKey(item),
		local: binding ? undefined : { projectName: item.projectName, id: item.id },
	};
}
function agentCandidate(item: LocalCandidate, binding?: Binding): TemplateAgentSelection {
	const { id, local } = identity(item, binding);
	return { agent_id: id, name: item.name, local, version: binding?.version, agent_version: binding?.version };
}
function environmentCandidate(item: LocalCandidate, binding?: Binding): TemplateEnvironmentSelection {
	const { id, local } = identity(item, binding);
	return { environment_id: id, name: item.name, local };
}
function fileCandidate(item: LocalCandidate, binding?: Binding): RemoteFile & TemplateLocalResource {
	const { id, local } = identity(item, binding);
	return { file_id: id, filename: item.name, size: item.size, available: true, local };
}
function memoryCandidate(item: LocalCandidate, binding?: Binding): RemoteMemoryStore & TemplateLocalResource {
	const { id, local } = identity(item, binding);
	return { memory_store_id: id, name: item.name, local };
}
function vaultCandidate(item: LocalCandidate, binding?: Binding): TemplateVaultSelectionValue {
	const { id, local } = identity(item, binding);
	return { vault_id: id, name: item.name, local };
}

function bindingsFor(resolved: Map<string, ProjectResourceBindings>, name: string, snapshot?: ProjectResourceBindings) {
	const bindings = new Map<string, Binding>();
	for (const [projectName, receipt] of resolved) {
		for (const item of receipt.resources) bindings.set(`local:${projectName}:${item.type}:${item.id}`, item);
	}
	for (const item of snapshot?.resources ?? []) bindings.set(`local:${name}:${item.type}:${item.id}`, item);
	return bindings;
}
function mergeCandidates(
	created: LocalCandidate[],
	persisted: LocalCandidate[],
	cached: Map<string, LocalCandidate[]>,
	resolved: Map<string, ProjectResourceBindings>,
) {
	const byKey = new Map(created.map((item) => [localKey(item), item]));
	for (const [name, receipt] of resolved) {
		const saved = cached.get(name) ?? [];
		for (const binding of receipt.resources) {
			const item = saved.find((entry) => entry.type === binding.type && entry.id === binding.id) ?? {
				type: binding.type,
				id: binding.id,
				projectName: name,
				name: binding.id,
			};
			if (!byKey.has(localKey(item))) byKey.set(localKey(item), item);
		}
	}
	for (const item of persisted) if (!byKey.has(localKey(item))) byKey.set(localKey(item), item);
	return [...byKey.values()];
}

function useLocalResources() {
	const client = useMemo(getAdminClient, []);
	const draftState = useTemplateResourceDraft();
	const { markContent } = draftState;
	const draft = draftState.draft;
	const projectName = draft?.draft_id ?? "";
	const sourceReadable = Boolean(draft && draft.status !== "published");
	const declarations = useAdminQuery(
		`templates:local-resources:${projectName}`,
		(signal) => client.draftResources.declarations(projectName, signal),
		{ enabled: sourceReadable },
	);
	const published = useAdminQuery(
		`templates:resource-bindings:${projectName}`,
		(signal) => client.draftResources.resourceBindings(projectName, signal),
		{ enabled: sourceReadable },
	);
	const [created, setCreated] = useState<LocalCandidate[]>([]);
	const [cached, setCached] = useState(new Map<string, LocalCandidate[]>());
	const [resolved, setResolved] = useState(new Map<string, ProjectResourceBindings>());
	useEffect(() => {
		if (!projectName || !declarations.data || declarations.error) return;
		if (declarations.data.length) markContent(projectName);
		const candidates = declarations.data.flatMap((item) => candidateFromDeclaration(projectName, item));
		setCached((current) => new Map(current).set(projectName, candidates));
	}, [projectName, declarations.data, declarations.error, markContent]);
	// 发布凭证优先于在途初始化查询；已完成批次不再读取被清理的源码目录。
	const snapshot = resolved.get(projectName) ?? (sourceReadable ? published.data : undefined);
	const bindingError = sourceReadable && !resolved.has(projectName) ? published.error : null;
	const bindings = bindingsFor(resolved, projectName, snapshot);
	// 未确认绑定前不暴露持久声明的临时 ID。新建结果仍立即展示并可选择。
	const persisted =
		sourceReadable && !declarations.error && snapshot && !bindingError
			? (declarations.data ?? []).flatMap((item) => candidateFromDeclaration(projectName, item))
			: [];
	const candidates = mergeCandidates(created, persisted, cached, resolved);
	const rows = <T,>(type: ResourceType, convert: (item: LocalCandidate, binding?: Binding) => T) =>
		candidates.filter((item) => item.type === type).map((item) => convert(item, bindings.get(localKey(item))));
	function add(item: LocalCandidate) {
		markContent(item.projectName);
		setCreated((current) => [item, ...current.filter((entry) => localKey(entry) !== localKey(item))]);
		return item;
	}
	return {
		agents: rows("agent", agentCandidate),
		environments: rows("environment", environmentCandidate),
		files: rows("file", fileCandidate),
		memories: rows("memory_store", memoryCandidate),
		vaults: rows("vault", vaultCandidate),
		loading: draftState.loading || (sourceReadable && !snapshot && !bindingError),
		error: draftState.error || (sourceReadable ? declarations.error || bindingError : null),
		retry: () =>
			void (draftState.error ? draftState.retry() : declarations.error ? declarations.refresh() : published.refresh()),
		addAgent: (result: ResourceDraftAgentCreateResult, projectName: string) =>
			agentCandidate(add({ type: "agent", projectName, id: result.agent.id, name: result.agent.name })),
		addEnvironment: (result: ResourceDraftEnvironmentCreateResult, projectName: string) =>
			environmentCandidate(
				add({ type: "environment", projectName, id: result.environment.id, name: result.environment.name }),
			),
		addFiles: (files: ProjectFileUploadCommit["files"], projectName: string) =>
			files.map((file) =>
				fileCandidate(add({ type: "file", projectName, id: file.file_key, name: file.filename, size: file.size })),
			),
		addMemory: (result: ResourceDraftMemoryStoreCreateResult, projectName: string) =>
			memoryCandidate(
				add({ type: "memory_store", projectName, id: result.memory_store.id, name: result.memory_store.name }),
			),
		addVault: (result: ResourceDraftVaultCreateResult, projectName: string) =>
			vaultCandidate(add({ type: "vault", projectName, id: result.vault.id, name: result.vault.display_name })),
		applyBindings: (projectName: string, result: ProjectResourceBindings) => {
			// 完整替换也会清除已移除或失效的绑定，未选候选同样参与状态同步。
			setResolved((current) => new Map(current).set(projectName, result));
		},
	};
}

const Context = createContext<ReturnType<typeof useLocalResources> | null>(null);
function LocalResourcesProvider({ children }: { children: ReactNode }) {
	const value = useLocalResources();
	return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function TemplateLocalResourcesProvider({ children }: { children: ReactNode }) {
	return (
		<TemplateResourceDraftProvider>
			<LocalResourcesProvider>{children}</LocalResourcesProvider>
		</TemplateResourceDraftProvider>
	);
}
export function useTemplateLocalResources() {
	const context = useContext(Context);
	if (!context) throw new Error("缺少模版资源上下文");
	return context;
}
export function TemplateLocalResourcesStatus() {
	const resources = useTemplateLocalResources();
	return resources.error ? (
		<Alert
			type="error"
			showIcon
			message={`本地资源列表加载失败：${resources.error}`}
			action={
				<Button size="small" onClick={resources.retry}>
					重试
				</Button>
			}
		/>
	) : resources.loading ? (
		<p role="status" className={styles.formNote}>
			正在读取本地资源发布状态…
		</p>
	) : null;
}
