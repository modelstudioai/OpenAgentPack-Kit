import type { ProjectResourceBindings } from "@openagentpack/kit-sdk/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";
import { getAdminClient } from "../../lib/api.ts";
import type { TemplateAgentSelection } from "./template-agent-list.tsx";
import type { TemplateFileDraft } from "./template-file-selection.tsx";
import {
	type TemplateEnvironmentSelection,
	type TemplateLocalResource,
	useTemplateLocalResources,
} from "./template-local-resources.tsx";
import type { TemplateMemoryDraft } from "./template-memory-selection.tsx";
import { useTemplateResourceDraft } from "./template-resource-draft.tsx";
import type { TemplateVaultDraft } from "./template-vault-draft.ts";

export interface TemplateRuntimeSelection {
	agent: TemplateAgentSelection | null;
	environment: TemplateEnvironmentSelection | null;
	files: TemplateFileDraft[];
	memories: TemplateMemoryDraft[];
	vaults: TemplateVaultDraft[];
}
type ResourceType = ProjectResourceBindings["resources"][number]["type"];

function localReferences(selection: TemplateRuntimeSelection) {
	const entries: [ResourceType, TemplateLocalResource | null][] = [
		["agent", selection.agent],
		["environment", selection.environment],
		...selection.files.map((file): [ResourceType, TemplateLocalResource] => ["file", file]),
		...selection.memories.map((memory): [ResourceType, TemplateLocalResource] => ["memory_store", memory]),
		...selection.vaults.map((vault): [ResourceType, TemplateLocalResource] => ["vault", vault]),
	];
	return entries.flatMap(([type, item]) => (item?.local ? [{ type, ...item.local }] : []));
}
export function hasLocalResources(selection: TemplateRuntimeSelection) {
	return localReferences(selection).length > 0;
}

function assertDistinctBindings(selection: TemplateRuntimeSelection) {
	const groups = [
		selection.files.map((file) => file.file_id),
		selection.memories.map((memory) => memory.memory_store_id),
		selection.vaults.map((vault) => vault.vault_id),
	];
	if (groups.some((ids) => new Set(ids).size !== ids.length))
		throw new Error("所选本地配置与云端条目指向同一资源，请取消重复项后重试。");
}

function resolveSelection(
	selection: TemplateRuntimeSelection,
	result: ProjectResourceBindings,
): TemplateRuntimeSelection {
	const bindings = new Map(result.resources.map((item) => [`${item.type}:${item.id}`, item]));
	function binding(type: ResourceType, item: TemplateLocalResource) {
		const found = bindings.get(`${type}:${item.local?.id}`);
		if (!found?.remote_id || (type === "agent" && (!Number.isInteger(found.version) || (found.version ?? 0) < 1)))
			throw new Error("发布后的资源信息不完整，请重试读取资源。");
		return found;
	}
	const agent = selection.agent;
	const environment = selection.environment;
	const agentBinding = agent?.local ? binding("agent", agent) : undefined;
	return {
		agent:
			agent && agentBinding
				? {
						...agent,
						local: undefined,
						agent_id: agentBinding.remote_id,
						version: agentBinding.version,
						agent_version: agentBinding.version,
					}
				: agent,
		environment: environment?.local
			? { ...environment, local: undefined, environment_id: binding("environment", environment).remote_id }
			: environment,
		files: selection.files.map((file) =>
			file.local ? { ...file, local: undefined, file_id: binding("file", file).remote_id } : file,
		),
		memories: selection.memories.map((memory) =>
			memory.local
				? { ...memory, local: undefined, memory_store_id: binding("memory_store", memory).remote_id }
				: memory,
		),
		vaults: selection.vaults.map((vault) =>
			vault.local ? { ...vault, local: undefined, vault_id: binding("vault", vault).remote_id } : vault,
		),
	};
}

/** 先完整解析再一次性更新草稿；失败只允许重读映射，不重复发布。 */
export function useTemplateResourceResolution(
	selection: TemplateRuntimeSelection,
	onResolved: (selection: TemplateRuntimeSelection) => void,
) {
	const client = useMemo(getAdminClient, []);
	const resources = useTemplateLocalResources();
	const drafts = useTemplateResourceDraft();
	const active = useRef<AbortController | null>(null);
	useEffect(() => () => active.current?.abort(), []);
	const key = JSON.stringify(selection);
	const [failure, setFailure] = useState<{ key: string; projectName?: string; error: string } | null>(null);
	const resolve = useAdminMutation(async (projectName?: string) => {
		const references = localReferences(selection);
		setFailure(null);
		const name = projectName ?? references[0]?.projectName;
		if (!name && !references.length) {
			onResolved(selection);
			return;
		}
		if (!name || references.some((item) => item.projectName !== name))
			throw new Error("所选本地资源与已发布项目不一致，请重新选择资源。");
		active.current?.abort();
		const controller = new AbortController();
		active.current = controller;
		// 已完成批次的源目录已清理，只从持久发布凭证读取绑定。
		const draft = await client.resourceDrafts.get(name, controller.signal);
		controller.signal.throwIfAborted();
		const result =
			draft.status === "published"
				? { resources: draft.resources }
				: await client.draftResources.resourceBindings(name, controller.signal);
		controller.signal.throwIfAborted();
		const resolved = resolveSelection(selection, result);
		assertDistinctBindings(resolved);
		resources.applyBindings(name, result);
		drafts.accept(draft);
		onResolved(resolved);
	});
	function start(projectName?: string) {
		void resolve.run(projectName).catch((error: unknown) => {
			if (active.current?.signal.aborted) return;
			setFailure({ key, projectName, error: error instanceof Error ? error.message : String(error) });
		});
	}
	const currentFailure = failure?.key === key ? failure : null;
	return {
		start,
		pending: resolve.pending,
		error: currentFailure?.error,
		retry: () => start(currentFailure?.projectName),
	};
}
