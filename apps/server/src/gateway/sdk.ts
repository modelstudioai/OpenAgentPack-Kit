import {
	type AgentResourceItem,
	KitError,
	type RemoteAgentResources,
	type RemoteFile,
	type SessionEvent,
	type SessionThreadSummary,
	SessionThreadSummarySchema,
} from "@openagentpack/kit-sdk/protocol";
import {
	type AgentPage,
	ApiError,
	archiveRemoteSession,
	createManagedApiContext,
	deleteSession,
	downloadRemoteFile,
	getFileInfo,
	getRemoteAgent,
	getSession,
	listRemoteAgents,
	listRemoteEnvironments,
	listRemoteFiles,
	listSessionEvents,
	listSessionThreadEvents,
	listSessionThreads,
	type ManagedApiContext,
	mountRemoteSessionResource,
	type ProjectRuntimeContext,
	type ProviderSessionEvent,
	type ProviderSessionInfo,
	listModelUsage as sdkListModelUsage,
	listToolUsage as sdkListToolUsage,
	sendRemoteSessionEvents,
	streamSessionEvents,
	unmountRemoteSessionResource,
	uploadFile,
} from "@openagentpack/sdk";
import { sanitizeSessionEvent } from "@openagentpack/sdk/session-events";
import type { BailianCredentials } from "../config.ts";
import { isRemoteCoordinator } from "./agent-multiagent.ts";
import { createBailianRest, filesFromResources } from "./bailian-rest.ts";
import { withAgentSkillDisplayMeta } from "./sdk-agent-skill-names.ts";
import { createSdkAgentVersionGateway } from "./sdk-agent-versions.ts";
import { buildSdkContext } from "./sdk-context.ts";
import { createSdkEnvironmentGateway } from "./sdk-environments.ts";
import { toUploadedRemoteFile } from "./sdk-files.ts";
import { createSdkMemoryStoreGateway } from "./sdk-memory-stores.ts";
import { createSdkPresetPackGateway } from "./sdk-preset-pack-resources.ts";
import { createSdkRemoteSkillGateway } from "./sdk-remote-skills.ts";
import { createSdkVaultGateway } from "./sdk-vaults.ts";
import { withSendRejection } from "./send-error.ts";
import { sessionUsageFromAttributes } from "./session-usage.ts";
import type { GatewaySendInput, GatewaySessionInfo, ProviderGateway } from "./types.ts";
import { createYamlDraftGateway } from "./yaml-draft-gateway.ts";

interface LooseSessionInfo extends ProviderSessionInfo {
	session_id?: string;
}

function sessionIdOf(info: LooseSessionInfo): string {
	return info.session_id ?? info.id;
}

function providerResponseBodyMessage(responseBody: string): string | null {
	try {
		const parsed = JSON.parse(responseBody) as { error?: { message?: unknown } };
		const message = parsed.error?.message;
		return typeof message === "string" && message ? message : null;
	} catch {
		return null;
	}
}

/** SDK 把 provider 拒绝抛成 ApiError，不映射会落成 500 internal 遮住真实原因（如 415 文件类型不被允许）。 */
function providerUploadError(error: ApiError): KitError {
	const detail = providerResponseBodyMessage(error.responseBody) ?? `HTTP ${error.statusCode}`;
	if (error.statusCode === 401) return new KitError("unauthorized", `Provider 凭据无效：${detail}`);
	if (error.statusCode === 403) return new KitError("forbidden", `Provider 拒绝访问：${detail}`);
	if (error.statusCode === 429 || error.statusCode >= 500)
		return new KitError("provider_error", `文件上传失败：${detail}`, { retryable: true });
	return new KitError("invalid_request", `文件不被接受：${detail}`);
}

/** SDK 已完成累计快照转换；不得用触发帧 raw 覆盖它。正文完整传递，raw 不出网关。 */
export function toContractEvent(provider: ProviderSessionEvent): SessionEvent {
	return sanitizeSessionEvent(provider, { redact: false, truncate: false, includeRaw: false });
}

function removeCredential(value: unknown, secret: string): unknown {
	if (typeof value === "string") return secret ? value.split(secret).join("[REDACTED]") : value;
	if (Array.isArray(value)) return value.map((item) => removeCredential(item, secret));
	if (value && typeof value === "object")
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, removeCredential(item, secret)]));
	return value;
}

/**
 * 纯函数：把 listRemoteAgents 的原始分页响应归一化为 kit 形状。
 * 实测（2026-10-14 live）：workspace endpoint 返回 `{ data: [...] }` 且主键为 `id`；
 * 保留 items/agents 与 agent_id 的兼容分支以防上游形状变化。
 * 契约测试用录制 fixture 直接驱动本函数（tests/contract.test.ts）。
 */
export function normalizeAgentPage(
	page: unknown,
): { agent_id: string; name: string; version?: number; is_coordinator?: boolean }[] {
	const p = (page ?? {}) as {
		data?: Record<string, unknown>[];
		items?: Record<string, unknown>[];
		agents?: Record<string, unknown>[];
	};
	const items = p.data ?? p.items ?? p.agents ?? [];
	return items.map((a) => ({
		agent_id: String(a.id ?? a.agent_id ?? ""),
		name: String(a.name ?? a.id ?? a.agent_id ?? ""),
		...(typeof a.version === "number" ? { version: a.version } : {}),
		...(isRemoteCoordinator(a) ? { is_coordinator: true } : {}),
	}));
}

function resourceItem(entry: unknown): AgentResourceItem | null {
	if (typeof entry === "string") return entry.trim() ? { name: entry.trim() } : null;
	if (!entry || typeof entry !== "object") return null;
	const record = entry as Record<string, unknown>;
	const name = [record.name, record.id].find((candidate): candidate is string => typeof candidate === "string");
	if (!name?.trim()) return null;
	return {
		name: name.trim(),
		...(typeof record.description === "string" && record.description.trim() ? { description: record.description } : {}),
	};
}

/** skill 引用的键名不定：console 版本详情已兼容 name / skill_name / skillName / skill_id，
 * 管理端云技能还会提交带 version 的固定版本引用；通用 resourceItem 只认 name|id。
 * 这里按 skill 专属键补名后回退通用投影（skills 非空形状 live 未实测）。 */
function skillEntryItems(entry: unknown): AgentResourceItem[] {
	const generic = resourceItem(entry);
	if (generic) return [generic];
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
	const record = entry as Record<string, unknown>;
	const name = [record.skill_name, record.skillName, record.skill_id, record.skill_key].find(
		(candidate): candidate is string => typeof candidate === "string",
	);
	if (!name?.trim()) return [];
	return [
		{
			name: name.trim(),
			...(typeof record.description === "string" && record.description.trim()
				? { description: record.description }
				: {}),
		},
	];
}

/** wire 的 permission_policy 实测为字符串或 {type}（SDK 读写两端同此约定）：
 * always_ask→ask、always_allow→allow，其余视为未声明。 */
function normalizePermissionPolicy(value: unknown): "allow" | "ask" | undefined {
	const type =
		typeof value === "string"
			? value
			: value && typeof value === "object" && "type" in value
				? (value as { type: unknown }).type
				: undefined;
	if (type === "always_ask") return "ask";
	if (type === "always_allow") return "allow";
	return undefined;
}

/** live 工具组条目投影（2026-11-02 实测）：builtin_toolkit 展开 configs[].name 并跳过禁用项，
 * mcp_toolkit 不展开（其服务端已在 mcp_servers 单列）；非工具组条目返回 null 走通用兜底。
 * 权限取工具级 permission_policy > 组 default_config > 兜底 allow（与 SDK 读取缺省一致）。 */
function toolkitEntryItems(entry: unknown): AgentResourceItem[] | null {
	if (!entry || typeof entry !== "object") return null;
	const toolkit = entry as Record<string, unknown>;
	if (typeof toolkit.type !== "string") return null;
	if (toolkit.type === "mcp_toolkit") return [];
	const defaults = toolkit.default_config;
	const defaultPolicy = normalizePermissionPolicy(
		defaults && typeof defaults === "object" ? (defaults as Record<string, unknown>).permission_policy : undefined,
	);
	const configs = Array.isArray(toolkit.configs) ? toolkit.configs : [];
	return configs.flatMap((config) => {
		if (!config || typeof config !== "object") return [];
		const record = config as Record<string, unknown>;
		if (record.enabled === false || typeof record.name !== "string" || !record.name.trim()) return [];
		return [
			{
				name: record.name.trim(),
				permission: normalizePermissionPolicy(record.permission_policy) ?? defaultPolicy ?? "allow",
			},
		];
	});
}

/**
 * 纯函数：把远端 Agent 详情里 unknown 形状的 tools / skills / mcp_servers 投影成成员侧合同。
 * live 实测（2026-11-02）：
 * tools 是工具组数组（经 toolkitEntryItems 投影）；`mcp_servers` 条目为 `{type,name,url}`，
 * 按 `name` 吸收；skills 非空形状未实测，按字符串或 `{name|id, description?}` 兜底，
 * 无法识别的条目丢弃。
 */
export function normalizeAgentResources(agent: unknown): RemoteAgentResources {
	const source = (agent ?? {}) as Record<string, unknown>;
	const asItems = (entry: unknown): AgentResourceItem[] => {
		const item = resourceItem(entry);
		return item ? [item] : [];
	};
	const items = (value: unknown): AgentResourceItem[] => (Array.isArray(value) ? value.flatMap(asItems) : []);
	const skillItems = (value: unknown): AgentResourceItem[] =>
		Array.isArray(value) ? value.flatMap(skillEntryItems) : [];
	const toolItems = (value: unknown): AgentResourceItem[] =>
		Array.isArray(value) ? value.flatMap((entry) => toolkitEntryItems(entry) ?? asItems(entry)) : [];
	return {
		tools: toolItems(source.tools),
		skills: skillItems(source.skills),
		mcp_servers: items(source.mcp_servers ?? source.mcpServers),
	};
}

function nextResourcePage(
	page: Pick<AgentPage, "has_more" | "next_page">,
	seenPages: Set<string>,
	resource: string,
): string | undefined {
	if (page.has_more && !page.next_page) {
		throw new KitError("provider_error", `${resource}列表缺少下一页游标，请重试`);
	}
	if (page.next_page) {
		if (seenPages.has(page.next_page)) {
			throw new KitError("provider_error", `${resource}列表分页游标重复，请重试`);
		}
		seenPages.add(page.next_page);
	}
	return page.next_page;
}

function createThreadNameEnricher(context: ProjectRuntimeContext, secret: string, signal?: AbortSignal) {
	const names = new Map<string, Promise<string | undefined>>();
	const enrichName = async (summary: SessionThreadSummary) => {
		if (summary.agent_name || summary.agent.name || signal?.aborted) return;
		const key = `${summary.agent.id}:${summary.agent.version ?? "latest"}`;
		if (!names.has(key))
			names.set(
				key,
				getRemoteAgent(context, summary.agent.id, {
					...(signal ? { signal: signal } : {}),
					...(summary.agent.version !== undefined ? { version: summary.agent.version } : {}),
				})
					.then((agent) => (typeof agent.name === "string" ? agent.name : undefined))
					.catch(() => undefined),
			);
		const name = await names.get(key);
		if (name) summary.agent.name = removeCredential(name, secret) as string;
	};
	return enrichName;
}

/** 上游错误可能回显请求数据；新线程查询只交付固定安全摘要。 */
async function safeThreadQuery<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
	try {
		return await action();
	} catch (error) {
		if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
		if (ApiError.isNotFound(error)) throw new KitError("not_found", "线程不存在");
		throw new KitError("provider_error", "查询子 Agent 失败，请稍后重试", { retryable: true });
	}
}

/**
 * 真实 Provider gateway：资源与会话使用 SDK 公开面，建会话窄入口见 bailian-rest.ts。
 * 不碰 internal。形状差异用防御性读取吸收，并由 live 验证兜底（docs/validation.md）。
 */
export function createSdkGateway(credentials: BailianCredentials): ProviderGateway {
	const toContract = (event: ProviderSessionEvent) =>
		removeCredential(toContractEvent(event), credentials.apiKey) as SessionEvent;
	let contextPromise: Promise<ProjectRuntimeContext> | null = null;
	const ctx = () => (contextPromise ??= buildSdkContext(credentials));
	let restPromise: ReturnType<typeof createBailianRest> | null = null;
	const rest = () => (restPromise ??= createBailianRest(credentials));
	/** 用量遥测走 provider-only 轻量上下文，无 project 依赖；凭据形状与 sdk-context.ts 一致。 */
	let managedContext: ManagedApiContext | null = null;
	const managedCtx = () =>
		(managedContext ??= createManagedApiContext({
			providers: {
				bailian: {
					api_key: credentials.apiKey,
					...(credentials.baseUrl ? { base_url: credentials.baseUrl } : {}),
					...(credentials.workspaceId ? { workspace_id: credentials.workspaceId } : {}),
				},
			},
		}));

	return {
		mode: "sdk",
		resourceDraftDocument(id, assetRoot, storage) {
			return createYamlDraftGateway({ id, assetRoot, storage, credentials });
		},
		/**
		 * 建会话统一走 provider REST（`POST /sessions`），两个实测原因
		 * （docs/research/bailian-session-file-mount.md、docs/research/sdk-session-runtime.md）：
		 * 1. `createSessionForAgent({ agent })` 的 `agent` 必须是 **config 声明键**，而 kit 的
		 *    catalog 存的是远端 agent id（`agent_01…`）→ 传远端 id 会 "not found in config"；
		 * 2. 指定 Agent 历史版本须传 `agent:{id,version}`；安装版 SDK 建会话不能传版本。
		 *    官方合同核对见 docs/research/2026-10-30-agent-version-binding.md。
		 * 文件不进创建载荷（实测 2026-11-03：创建时 file_resource 回显成功但 sandbox 不物化），
		 * 由服务层在建会话后走 `mountSessionResource` 运行时挂载。
		 */
		async createSession({ agentId, agentVersion, environmentId, title, memoryStores, vaultIds }) {
			const raw = await rest().createSessionWithResources({
				agentId,
				...(agentVersion !== undefined ? { agentVersion } : {}),
				vaultIds,
				...(environmentId ? { environmentId } : {}),
				...(title ? { title } : {}),
				resources: (memoryStores ?? []).map((store) => ({ type: "memory_store" as const, ...store })),
			});
			return {
				session_id: raw.id,
				status: raw.status ?? "idle",
				...(raw.title ? { title: raw.title } : {}),
			};
		},
		async getSession(sessionId): Promise<GatewaySessionInfo | null> {
			try {
				const info = (await getSession(await ctx(), sessionId)) as LooseSessionInfo;
				// GET /sessions/:id 的原始载荷在 attributes 里，含 resources（挂载回显）
				const files = filesFromResources(
					(info.attributes as { resources?: { type?: string; file_id?: string; mount_path?: string | null }[] })
						?.resources,
				);
				return {
					session_id: sessionIdOf(info),
					status: info.status ?? "unknown",
					...sessionUsageFromAttributes(info.attributes),
					...(info.title ? { title: info.title } : {}),
					...(files.length ? { files } : {}),
				};
			} catch (error) {
				if (ApiError.isNotFound(error)) return null;
				if (error instanceof KitError) throw error;
				throw new KitError("provider_error", "获取会话详情失败，请稍后重试");
			}
		},
		async sendMessage(sessionId, input: GatewaySendInput) {
			const result = await withSendRejection(async () =>
				sendRemoteSessionEvents(await ctx(), sessionId, [
					{ type: "message", role: "user", content: [{ type: "text", text: input.text }] },
				]),
			);
			return { event_ids: result.event_ids ?? [] };
		},
		async respondToolApproval(sessionId, input) {
			const { session_thread_id, ...decision } = input;
			const result = await withSendRejection(async () =>
				sendRemoteSessionEvents(
					await ctx(),
					sessionId,
					[
						{
							type: "tool_approval_response",
							role: "user",
							...(session_thread_id ? { session_thread_id } : {}),
							content: [{ type: "data", data: decision }],
						},
					],
					{ provider: "bailian" },
				),
			);
			return { event_ids: result.event_ids ?? [] };
		},
		async archiveSession(sessionId) {
			await archiveRemoteSession(await ctx(), sessionId);
		},
		async deleteSession(sessionId) {
			await deleteSession(await ctx(), sessionId);
		},
		async mountSessionResource(sessionId, { fileId, mountPath }) {
			const info = await mountRemoteSessionResource(
				await ctx(),
				sessionId,
				{ type: "file", file_id: fileId, mount_path: mountPath },
				{ provider: "bailian" },
			);
			if (!info.id) throw new KitError("provider_error", "挂载成功但 provider 未返回资源 id，无法支持后续卸载");
			return { resourceId: info.id, mountPath: info.mount_path ?? mountPath };
		},
		async unmountSessionResource(sessionId, resourceId) {
			await unmountRemoteSessionResource(await ctx(), sessionId, resourceId, { provider: "bailian" });
		},
		async uploadFile({ filename, bytes, mimeType }) {
			try {
				const info = await uploadFile(await ctx(), bytes, filename, { ...(mimeType ? { mimeType } : {}) });
				return { file_id: info.id, filename: info.filename || filename, size: info.size_bytes ?? bytes.byteLength };
			} catch (error) {
				if (error instanceof ApiError) throw providerUploadError(error);
				throw error;
			}
		},
		async fileStatus(fileId) {
			try {
				const info = await getFileInfo(await ctx(), fileId);
				return { available: info.available, ...(info.status ? { status: info.status } : {}) };
			} catch {
				// 查不到状态不阻塞建会话：交给 provider 判（它的错误更准确）
				return { available: true, status: "unknown" };
			}
		},
		async interrupt(sessionId) {
			// 公开 API 无独立 interrupt 端点：以 interrupt 事件表达中断意图
			await sendRemoteSessionEvents(await ctx(), sessionId, [{ type: "interrupt" }]);
		},
		async listEvents(sessionId, options = {}) {
			const page = await listSessionEvents(await ctx(), sessionId, {
				event_format: "snapshot",
				order: "asc",
				...(options.pageToken ? { page_token: options.pageToken } : {}),
				...(options.signal ? { signal: options.signal } : {}),
				...(options.afterId ? { after_id: options.afterId } : {}),
				...(options.limit ? { limit: options.limit } : {}),
			});
			if (page.has_more && !page.next_page) throw new KitError("provider_error", "事件历史缺少下一页游标");
			return { events: page.events.map(toContract), next_page_token: page.next_page ?? null };
		},
		async listThreads(sessionId, options = {}) {
			return safeThreadQuery(async () => {
				const context = await ctx();
				const page = await listSessionThreads(context, sessionId, {
					limit: options.limit ?? 50,
					...(options.pageToken ? { page: options.pageToken } : {}),
					...(options.signal ? { signal: options.signal } : {}),
				});
				if (page.has_more && !page.next_page) throw new KitError("provider_error", "线程列表缺少下一页游标");
				const enrichName = createThreadNameEnricher(context, credentials.apiKey, options.signal);
				const data = await Promise.all(
					page.data.map(async (thread) => {
						if (thread.session_id !== sessionId) throw new KitError("provider_error", "线程归属与会话不符");
						const summary = SessionThreadSummarySchema.parse(removeCredential(thread, credentials.apiKey));
						await enrichName(summary);
						return summary;
					}),
				);
				options.signal?.throwIfAborted();
				return { data, next_page_token: page.next_page ?? null };
			}, options.signal);
		},
		async listThreadEvents(sessionId, threadId, options = {}) {
			return safeThreadQuery(async () => {
				const page = await listSessionThreadEvents(await ctx(), sessionId, threadId, {
					event_format: "snapshot",
					order: "desc",
					limit: options.limit ?? 50,
					...(options.pageToken ? { page_token: options.pageToken } : {}),
					...(options.signal ? { signal: options.signal } : {}),
				});
				if (page.has_more && !page.next_page) throw new KitError("provider_error", "线程事件缺少下一页游标");
				return { events: page.events.map(toContract), next_page_token: page.next_page ?? null };
			}, options.signal);
		},
		async *streamEvents(sessionId, options = {}) {
			const iterable = streamSessionEvents(await ctx(), sessionId, {
				event_format: "snapshot",
				event_deltas: ["message", "reasoning"],
				reconnect: true,
				...(options.signal ? { signal: options.signal } : {}),
				...(options.onReady ? { onReady: options.onReady } : {}),
				...(options.afterId ? { after_id: options.afterId } : {}),
			});
			for await (const event of iterable) {
				if (options.signal?.aborted) return;
				yield toContract(event);
			}
		},
		async downloadFile(fileId) {
			const body = await downloadRemoteFile(await ctx(), fileId);
			// 事件产物常缺 content_type，固定 octet-stream 会让浏览器把可预览文件当附件下载；
			// 从 Provider Files 元数据补真实文件名与 MIME，查不到（如已归档）时维持旧行为。
			try {
				const info = await getFileInfo(await ctx(), fileId);
				return { body, contentType: info.mime_type || "application/octet-stream", filename: info.filename || fileId };
			} catch {
				return { body, contentType: "application/octet-stream", filename: fileId };
			}
		},
		async listRemoteAgents() {
			const agents = new Map<string, ReturnType<typeof normalizeAgentPage>[number]>();
			const seenPages = new Set<string>();
			let pageToken: string | undefined;
			do {
				const page = await listRemoteAgents(await ctx(), { limit: 100, ...(pageToken ? { page: pageToken } : {}) });
				for (const agent of normalizeAgentPage(page)) agents.set(agent.agent_id, agent);
				pageToken = nextResourcePage(page, seenPages, "远端 Agent ");
			} while (pageToken);
			return [...agents.values()];
		},
		async getRemoteAgentResources(agentId) {
			try {
				const raw = await getRemoteAgent(await ctx(), agentId);
				// skill 引用常只有 skill_* 裸 ID；复用管理端详情的补名投影并补描述供成员侧选择器（按 ID/version 去重限流，查询失败保留原引用）。
				const agent = removeCredential(
					await withAgentSkillDisplayMeta(raw, ctx, { descriptions: true }),
					credentials.apiKey,
				);
				return normalizeAgentResources(agent);
			} catch (error) {
				if (ApiError.isNotFound(error)) return null;
				throw new KitError("provider_error", "Agent 资源查询失败，请稍后重试", { retryable: true });
			}
		},
		async listRemoteEnvironments() {
			const environments = new Map<string, { environment_id: string; name: string }>();
			const seenPages = new Set<string>();
			let pageToken: string | undefined;
			do {
				const page = await listRemoteEnvironments(await ctx(), {
					limit: 100,
					...(pageToken ? { page: pageToken } : {}),
				});
				for (const environment of page.data) {
					environments.set(environment.id, {
						environment_id: environment.id,
						name: environment.name || environment.id,
					});
				}
				pageToken = nextResourcePage(page, seenPages, "远端环境");
			} while (pageToken);
			return [...environments.values()];
		},
		async listRemoteFiles() {
			const files = new Map<string, RemoteFile>();
			const seenPages = new Set<string>();
			let pageToken: string | undefined;
			do {
				const page = await listRemoteFiles(await ctx(), { limit: 100, ...(pageToken ? { page: pageToken } : {}) });
				for (const info of page.data) {
					const file = toUploadedRemoteFile(info);
					if (file) files.set(file.file_id, file);
				}
				pageToken = nextResourcePage(page, seenPages, "远端文件");
			} while (pageToken);
			return [...files.values()];
		},
		async getRemoteFile(fileId) {
			try {
				return toUploadedRemoteFile(await getFileInfo(await ctx(), fileId));
			} catch (error) {
				if (ApiError.isNotFound(error)) return null;
				throw new KitError("provider_error", "文件信息查询失败，请稍后重试", { retryable: true });
			}
		},
		async listModelUsage(request, options) {
			return sdkListModelUsage(managedCtx(), request, options);
		},
		async listToolUsage(request, options) {
			return sdkListToolUsage(managedCtx(), request, options);
		},
		...createSdkAgentVersionGateway(ctx),
		...createSdkPresetPackGateway(ctx, credentials.apiKey),
		...createSdkRemoteSkillGateway(ctx),
		...createSdkEnvironmentGateway(ctx),
		...createSdkMemoryStoreGateway(ctx),
		...createSdkVaultGateway(ctx),
	};
}
