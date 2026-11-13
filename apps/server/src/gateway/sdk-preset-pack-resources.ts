import {
	KitError,
	type PresetPackAgentResources,
	type PresetPackResource,
	type PresetPackSession,
} from "@openagentpack/kit-sdk/protocol";
import {
	ApiError,
	getRemoteAgent,
	getSession,
	listRemoteSessionResources,
	listSessionSummaries,
	type ProjectRuntimeContext,
	type ProviderSessionInfo,
} from "@openagentpack/sdk";
import { mergePresetPackResources, presetPackResource } from "./preset-pack-resources.ts";
import type { ProviderGateway } from "./types.ts";

function validId(id: string, secret: string) {
	return typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id) && (!secret || !id.includes(secret));
}

function nextPage(hasMore: boolean, token: string | undefined, seen: Set<string>): string | undefined {
	if ((hasMore && !token) || (token && seen.has(token)))
		throw new KitError("provider_error", "会话资源分页信息异常，请重试");
	if (token) seen.add(token);
	return token;
}

function sessionSummary(session: ProviderSessionInfo): PresetPackSession {
	return {
		session_id: session.id,
		status: typeof session.status === "string" && /^[a-z_]+$/.test(session.status) ? session.status : "unknown",
		...(session.created_at && !Number.isNaN(Date.parse(session.created_at)) ? { created_at: session.created_at } : {}),
		...(session.updated_at && !Number.isNaN(Date.parse(session.updated_at)) ? { updated_at: session.updated_at } : {}),
		resources: [],
	};
}

function configuredResources(session: ProviderSessionInfo, secret: string): PresetPackResource[] {
	const resources: Record<string, unknown>[] = [...(session.resources ?? [])];
	if (session.environment_id) resources.push({ type: "environment", environment_id: session.environment_id });
	for (const id of session.vault_ids ?? []) resources.push({ type: "vault", vault_id: id });
	for (const id of session.memory_store_ids ?? []) {
		if (!resources.some((resource) => resource.memory_store_id === id))
			resources.push({ type: "memory_store", memory_store_id: id });
	}
	return resources.map((resource) => presetPackResource(resource, "session", secret));
}

async function listAgentSessions(
	context: ProjectRuntimeContext,
	agentId: string,
	secret: string,
	signal?: AbortSignal,
) {
	const sessions = new Map<string, ProviderSessionInfo>();
	const seen = new Set<string>();
	let page: string | undefined;
	do {
		signal?.throwIfAborted();
		const result = await listSessionSummaries(context, {
			provider: "bailian",
			filter: { agent_id: agentId, limit: 100, ...(page ? { page } : {}) },
		});
		for (const { session } of result.summaries) {
			if (!validId(session.id, secret) || session.agent_id !== agentId) throw new Error("Unexpected session binding");
			sessions.set(session.id, session);
		}
		page = nextPage(result.hasMore, result.nextPage, seen);
	} while (page);
	return [...sessions.values()];
}

async function readSessionResources(
	context: ProjectRuntimeContext,
	agentId: string,
	listed: ProviderSessionInfo,
	secret: string,
	signal?: AbortSignal,
): Promise<PresetPackSession> {
	let summary = sessionSummary(listed);
	const runtime: PresetPackResource[] = [];
	try {
		signal?.throwIfAborted();
		const detail = await getSession(context, listed.id, "bailian");
		signal?.throwIfAborted();
		if (detail.id !== listed.id || detail.agent_id !== agentId) throw new Error("Session binding changed");
		summary = { ...sessionSummary(detail), resources: configuredResources(detail, secret) };
		const seen = new Set<string>();
		let page: string | undefined;
		do {
			signal?.throwIfAborted();
			const result = await listRemoteSessionResources(context, listed.id, { limit: 100, ...(page ? { page } : {}) });
			signal?.throwIfAborted();
			for (const resource of result.data) runtime.push(presetPackResource(resource, "runtime", secret));
			page = nextPage(result.has_more, result.next_page, seen);
		} while (page);
	} catch {
		signal?.throwIfAborted();
		summary = { ...summary, resource_error: "该会话的资源未完整读取，请重试；已显示的引用仅为部分结果。" };
	}
	return { ...summary, resources: mergePresetPackResources([...summary.resources, ...runtime]) };
}

/** 限定所选 Agent 的只读资源发现；不查询事件，不依赖 Kit 会话索引。 */
export function createSdkPresetPackGateway(
	context: () => Promise<ProjectRuntimeContext>,
	secret: string,
): Pick<ProviderGateway, "getPresetPackAgentResources"> {
	return {
		async getPresetPackAgentResources(agentId, signal): Promise<PresetPackAgentResources> {
			if (!validId(agentId, secret)) throw new KitError("invalid_request", "智能体 ID 格式无效");
			try {
				signal?.throwIfAborted();
				const ctx = await context();
				const agent = await getRemoteAgent(ctx, agentId);
				if (agent.id !== agentId) throw new Error("Agent binding mismatch");
				const listed = await listAgentSessions(ctx, agentId, secret, signal);
				const results = new Array<PresetPackSession>(listed.length);
				let next = 0;
				await Promise.all(
					Array.from({ length: Math.min(4, listed.length) }, async () => {
						while (next < listed.length) {
							const index = next++;
							results[index] = await readSessionResources(ctx, agentId, listed[index]!, secret, signal);
						}
					}),
				);
				return { agent_id: agentId, complete: results.every((session) => !session.resource_error), sessions: results };
			} catch (error) {
				signal?.throwIfAborted();
				if (ApiError.isNotFound(error)) throw new KitError("not_found", "智能体不存在或已不可用");
				throw new KitError("provider_error", "智能体关联会话读取失败，请稍后重试", { retryable: true });
			}
		},
	};
}
