import type { MemoryStoreConfiguration } from "@openagentpack/kit-sdk/protocol";
import {
	type AdminIdentityView,
	type AdminMembersPage,
	type ApplyRequest,
	type AttachmentRef,
	type CatalogAgentView,
	type CreateMemberRequest,
	type CreateMemberResponse,
	type CreateTemplateDebugSessionRequest,
	type DebugSessionDetail,
	type DeclarationPreview,
	type DeclarationPreviewInput,
	type DeclarationType,
	type EventsPage,
	errorFromResponse,
	type GroupInput,
	type GroupMembershipQuery,
	type GroupMembersPage,
	type GroupMembersPatch,
	type GroupsPage,
	type GroupsQuery,
	type GroupView,
	type MemberGroupsPage,
	type MemberGroupsPatch,
	type MemberSessionsPage,
	type MembersQuery,
	type MemberUsageLimitView,
	type MemberUsageSummary,
	type MemberView,
	type ModelUsagePage,
	type OperationView,
	OperationViewSchema,
	type PlanResponse,
	PROTOCOL_VERSION,
	type ProjectAgentCreateInput,
	type ProjectAgentCreateResult,
	type ProjectAgentOptions,
	type ProjectDeclaration,
	type ProjectEnvironmentCreateInput,
	type ProjectEnvironmentCreateResult,
	type ProjectFileUpload,
	type ProjectFileUploadCommit,
	type ProjectFileUploadInput,
	type ProjectFileUploadPreview,
	type ProjectMemoryStoreCreateInput,
	type ProjectMemoryStoreCreateResult,
	type ProjectOverview,
	type ProjectPlan,
	type ProjectResourceBindingInput,
	type ProjectResourceBindings,
	type ProjectSkillUpload,
	type ProjectSkillUploadCommit,
	type ProjectSkillUploadInput,
	type ProjectSkillUploadPreview,
	type ProjectVaultCreateInput,
	type ProjectVaultCreateResult,
	RESOURCE_DRAFT_KEY_HEADER,
	type RemoteAgentVersion,
	type RemoteAgentVersionDetail,
	type RemoteEnvironmentDetail,
	type RemoteSkill,
	type RemoteSkillSource,
	type RemoteVaultDetail,
	type ResourceDraftAgentCreateResult,
	type ResourceDraftDeclaration,
	type ResourceDraftDiscardResult,
	type ResourceDraftEnvironmentCreateResult,
	type ResourceDraftMemoryStoreCreateResult,
	type ResourceDraftOverview,
	type ResourceDraftVaultCreateResult,
	type ResourceDraftView,
	type SendMessageRequest,
	type SendMessageResponse,
	type SessionThreadsResponse,
	type TemplateCreateInput,
	type TemplateListingInput,
	type TemplateListingRequest,
	type TemplateSessionsPage,
	type TemplatesPage,
	type TemplatesQuery,
	type TemplateUpdateInput,
	type TemplateUsageLimitView,
	type TemplateUsageRow,
	type TemplateUsageTrend,
	type TemplateVersionsPage,
	type TemplateVersionsQuery,
	type TemplateVersionView,
	type TemplateView,
	type ToolApprovalDecision,
	type ToolApprovalsResponse,
	type ToolUsagePage,
	type UsageLimitConfig,
	type UsageLimitPolicy,
} from "@openagentpack/kit-sdk/protocol";
import type { StreamSessionOptions, ThreadQueryOptions } from "@openagentpack/kit-sdk/providers";
import { streamProtocolFrames } from "@openagentpack/kit-sdk/providers/kit";
import { createRequest, type RequestClient, type RequestOptions } from "@openagentpack/kit-sdk/request";

export type AdminClientOptions = RequestOptions | { request: RequestClient };

/** Provider 侧用量明细的公共筛选；workspace 由服务端注入，前端不传。 */
export interface UsageTelemetryQuery {
	/** 传 session_id 时按会话口径查询（scope=session，忽略时间区间与 agent_id）。 */
	session_id?: string;
	/** 毫秒时间戳；缺省为最近 7 天（session 口径下不传）。 */
	start_time?: number;
	end_time?: number;
	agent_id?: string;
	page_no?: number;
	page_size?: number;
	sort_order?: "asc" | "desc";
}
export type ModelUsageQuery = UsageTelemetryQuery & {
	model_name?: string;
	sort_by?: "call_count" | "failed_count" | "input_tokens" | "output_tokens";
};
export type ToolUsageQuery = UsageTelemetryQuery & {
	source?: "builtin" | "mcp" | "custom";
	tool_name?: string;
	sort_by?: "call_count" | "failed_count";
};

export interface DeclarationWrite {
	base_revision: string;
	declaration: Record<string, unknown>;
}

/** 控制面客户端与体验页身份独立；复用 Request 和 Kit v2 帧，不持有浏览器存储。 */
export function createAdminClient(options: AdminClientOptions) {
	const raw = "request" in options ? options.request : createRequest({ ...options, mapHttpError: errorFromResponse });
	function initWithProtocol(init: RequestInit = {}): RequestInit {
		const headers = new Headers(init.headers);
		headers.set("x-kit-protocol-version", PROTOCOL_VERSION);
		return { ...init, headers };
	}
	const request: RequestClient = {
		url: raw.url,
		response: (path, init) => raw.response(path, initWithProtocol(init)),
		json: (path, init) => raw.json(path, initWithProtocol(init)),
		stream: (path, init, streamOptions) => raw.stream(path, initWithProtocol(init), streamOptions),
	};
	const get = <T>(path: string, signal?: AbortSignal) =>
		request.json<{ data: T }>(path, { signal }).then((result) => result.data);
	const write = <T>(path: string, method: string, body?: unknown) =>
		request
			.json<{ data: T }>(path, {
				method,
				headers: { "Content-Type": "application/json" },
				...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			})
			.then((result) => result.data);
	const sessionPath = (id: string) => `/api/admin/debug/sessions/${encodeURIComponent(id)}`;
	function threadQuery(query: ThreadQueryOptions) {
		const params = new URLSearchParams();
		if (query.limit !== undefined) params.set("limit", String(query.limit));
		if (query.pageToken) params.set("page_token", query.pageToken);
		return params.size ? `?${params}` : "";
	}
	const groupPath = (id: string) => `/api/admin/groups/${encodeURIComponent(id)}`;
	const memberGroupsPath = (id: string) => `/api/admin/members/${encodeURIComponent(id)}/groups`;
	/** 用量明细 query 全量字段非空即拼；布尔外的值统一 String 化。 */
	function usageTelemetryQuery(
		query: UsageTelemetryQuery & { model_name?: string; source?: string; tool_name?: string; sort_by?: string },
	) {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(query)) {
			if (value !== undefined && value !== "") params.set(key, String(value));
		}
		return params.size ? `?${params}` : "";
	}
	function groupQuery(query: Partial<GroupMembershipQuery>) {
		const params = new URLSearchParams();
		if (query.search) params.set("search", query.search);
		if (query.limit) params.set("limit", String(query.limit));
		if (query.page_token) params.set("page_token", query.page_token);
		if (query.membership) params.set("membership", query.membership);
		return params.size ? `?${params}` : "";
	}
	function resourceClient(projectPath: (name: string) => string) {
		const declarationPath = (name: string, type: DeclarationType, id: string) =>
			`${projectPath(name)}/declarations/${type}/${encodeURIComponent(id)}`;
		return {
			createEnvironment: (name: string, input: ProjectEnvironmentCreateInput) =>
				write<ProjectEnvironmentCreateResult>(`${projectPath(name)}/environments`, "POST", input),
			createAgent: (name: string, input: ProjectAgentCreateInput) =>
				write<ProjectAgentCreateResult>(`${projectPath(name)}/agents`, "POST", input),
			agentOptions: (name: string, signal?: AbortSignal) =>
				get<ProjectAgentOptions>(`${projectPath(name)}/agent-options`, signal),
			createVault: (name: string, input: ProjectVaultCreateInput) =>
				write<ProjectVaultCreateResult>(`${projectPath(name)}/vaults`, "POST", input),
			memoryStoreConfiguration: (name: string, id: string, signal?: AbortSignal) =>
				get<MemoryStoreConfiguration>(`${projectPath(name)}/memory-stores/${encodeURIComponent(id)}`, signal),
			createMemoryStore: (name: string, input: ProjectMemoryStoreCreateInput) =>
				write<ProjectMemoryStoreCreateResult>(`${projectPath(name)}/memory-stores`, "POST", input),
			overview: (name: string, signal?: AbortSignal) => get<ProjectOverview>(projectPath(name), signal),
			declarations: (name: string, signal?: AbortSignal) =>
				get<ProjectDeclaration[]>(`${projectPath(name)}/declarations`, signal),
			resourceBindings: (name: string, signal?: AbortSignal) =>
				get<ProjectResourceBindings>(`${projectPath(name)}/resource-bindings`, signal),
			resolveResourceBindings: (name: string, input: ProjectResourceBindingInput, signal?: AbortSignal) =>
				request
					.json<{ data: ProjectResourceBindings }>(`${projectPath(name)}/resource-bindings/resolve`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(input),
						signal,
					})
					.then((result) => result.data),
			declaration: (name: string, type: DeclarationType, id: string, signal?: AbortSignal) =>
				get<ProjectDeclaration>(declarationPath(name, type, id), signal),
			previewDeclaration: (name: string, type: DeclarationType, id: string, body: DeclarationPreviewInput) =>
				write<DeclarationPreview>(`${declarationPath(name, type, id)}/preview`, "POST", body),
			putDeclaration: (name: string, type: DeclarationType, id: string, body: DeclarationWrite) =>
				write<{ new_revision: string }>(declarationPath(name, type, id), "PUT", body),
			deleteDeclaration: (name: string, type: DeclarationType, id: string, body: { base_revision: string }) =>
				write<{ new_revision: string }>(declarationPath(name, type, id), "DELETE", body),
			uploadFile: (name: string, baseRevision: string, file: Blob, filename: string) => {
				const body = new FormData();
				body.append("base_revision", baseRevision);
				body.append("file", file, filename);
				return request
					.json<{ data: ProjectFileUpload }>(`${projectPath(name)}/file-uploads`, { method: "POST", body })
					.then((result) => result.data);
			},
			discardFileUpload: (name: string, uploadId: string) =>
				write<{ deleted: boolean }>(`${projectPath(name)}/file-uploads/${encodeURIComponent(uploadId)}`, "DELETE"),
			previewFileUploads: (name: string, body: ProjectFileUploadInput) =>
				write<ProjectFileUploadPreview>(`${projectPath(name)}/file-uploads/preview`, "POST", body),
			commitFileUploads: (name: string, body: ProjectFileUploadInput) =>
				write<ProjectFileUploadCommit>(`${projectPath(name)}/file-uploads/commit`, "POST", body),
			uploadSkill: (name: string, baseRevision: string, file: Blob, filename: string) => {
				const body = new FormData();
				body.append("base_revision", baseRevision);
				body.append("file", file, filename);
				return request
					.json<{ data: ProjectSkillUpload }>(`${projectPath(name)}/skill-uploads`, { method: "POST", body })
					.then((result) => result.data);
			},
			discardSkillUpload: (name: string, uploadId: string) =>
				write<{ deleted: boolean }>(`${projectPath(name)}/skill-uploads/${encodeURIComponent(uploadId)}`, "DELETE"),
			previewSkillUploads: (name: string, body: ProjectSkillUploadInput) =>
				write<ProjectSkillUploadPreview>(`${projectPath(name)}/skill-uploads/preview`, "POST", body),
			commitSkillUploads: (name: string, body: ProjectSkillUploadInput) =>
				write<ProjectSkillUploadCommit>(`${projectPath(name)}/skill-uploads/commit`, "POST", body),
			validate: (name: string) =>
				write<{ diagnostics: string[]; warnings?: string[] }>(`${projectPath(name)}/validate`, "POST"),
			plan: (name: string) => write<ProjectPlan>(`${projectPath(name)}/plan`, "POST", { action: "publish" }),
			execute: (name: string, confirmation: ApplyRequest) =>
				write<{ operation_id: string }>(`${projectPath(name)}/publish`, "POST", confirmation),
		};
	}
	function draftResourceClient() {
		const path = (id: string) => `/api/admin/resource-drafts/${encodeURIComponent(id)}/resources`;
		const client = resourceClient(path);
		return {
			overview: (id: string, signal?: AbortSignal) => get<ResourceDraftOverview>(path(id), signal),
			declarations: (id: string, signal?: AbortSignal) =>
				get<ResourceDraftDeclaration[]>(`${path(id)}/declarations`, signal),
			declaration: (id: string, type: DeclarationType, key: string, signal?: AbortSignal) =>
				get<ResourceDraftDeclaration>(`${path(id)}/declarations/${type}/${encodeURIComponent(key)}`, signal),
			createAgent: (id: string, input: ProjectAgentCreateInput) =>
				write<ResourceDraftAgentCreateResult>(`${path(id)}/agents`, "POST", input),
			createEnvironment: (id: string, input: ProjectEnvironmentCreateInput) =>
				write<ResourceDraftEnvironmentCreateResult>(`${path(id)}/environments`, "POST", input),
			createMemoryStore: (id: string, input: ProjectMemoryStoreCreateInput) =>
				write<ResourceDraftMemoryStoreCreateResult>(`${path(id)}/memory-stores`, "POST", input),
			createVault: (id: string, input: ProjectVaultCreateInput) =>
				write<ResourceDraftVaultCreateResult>(`${path(id)}/vaults`, "POST", input),
			agentOptions: client.agentOptions,
			memoryStoreConfiguration: client.memoryStoreConfiguration,
			resourceBindings: client.resourceBindings,
			resolveResourceBindings: client.resolveResourceBindings,
			previewDeclaration: client.previewDeclaration,
			putDeclaration: client.putDeclaration,
			deleteDeclaration: client.deleteDeclaration,
			uploadFile: client.uploadFile,
			discardFileUpload: client.discardFileUpload,
			previewFileUploads: client.previewFileUploads,
			commitFileUploads: client.commitFileUploads,
			uploadSkill: client.uploadSkill,
			discardSkillUpload: client.discardSkillUpload,
			previewSkillUploads: client.previewSkillUploads,
			commitSkillUploads: client.commitSkillUploads,
			validate: client.validate,
			plan: (id: string) => client.plan(id),
			execute: (id: string, confirmation: ApplyRequest) => client.execute(id, confirmation),
		};
	}
	return {
		identity: (signal?: AbortSignal) => get<AdminIdentityView>("/api/admin/identity", signal),
		remoteAgentVersions: (agentId: string, signal?: AbortSignal) =>
			get<RemoteAgentVersion[]>(`/api/admin/remote/agents/${encodeURIComponent(agentId)}/versions`, signal),
		remoteAgentVersion: (agentId: string, version: number, signal?: AbortSignal) =>
			get<RemoteAgentVersionDetail>(
				`/api/admin/remote/agents/${encodeURIComponent(agentId)}/versions/${version}`,
				signal,
			),
		remoteEnvironment: (environmentId: string, signal?: AbortSignal) =>
			get<RemoteEnvironmentDetail>(`/api/admin/remote/environments/${encodeURIComponent(environmentId)}`, signal),
		remoteMemoryStoreConfiguration: (id: string, signal?: AbortSignal) =>
			get<MemoryStoreConfiguration>(`/api/admin/remote/memory-stores/${encodeURIComponent(id)}`, signal),
		remoteVault: (vaultId: string, signal?: AbortSignal) =>
			get<RemoteVaultDetail>(`/api/admin/remote/vaults/${encodeURIComponent(vaultId)}`, signal),
		remoteSkills: (source: RemoteSkillSource = "custom", signal?: AbortSignal) =>
			get<RemoteSkill[]>(`/api/admin/remote/skills?source=${encodeURIComponent(source)}`, signal),
		templates: {
			list: (query: Partial<TemplatesQuery> = {}, signal?: AbortSignal) => {
				const params = new URLSearchParams();
				if (query.search) params.set("search", query.search);
				if (query.status) params.set("status", query.status);
				if (query.category) params.set("category", query.category);
				if (query.limit) params.set("limit", String(query.limit));
				if (query.page_token) params.set("page_token", query.page_token);
				return request.json<TemplatesPage>(`/api/admin/templates${params.size ? `?${params}` : ""}`, { signal });
			},
			get: (id: string, signal?: AbortSignal) =>
				get<TemplateView>(`/api/admin/templates/${encodeURIComponent(id)}`, signal),
			versions: (id: string, query: Partial<TemplateVersionsQuery> = {}, signal?: AbortSignal) => {
				const params = new URLSearchParams();
				if (query.limit) params.set("limit", String(query.limit));
				if (query.page_token) params.set("page_token", query.page_token);
				return request.json<TemplateVersionsPage>(
					`/api/admin/templates/${encodeURIComponent(id)}/versions${params.size ? `?${params}` : ""}`,
					{ signal },
				);
			},
			version: (id: string, version: number, signal?: AbortSignal) =>
				get<TemplateVersionView>(`/api/admin/templates/${encodeURIComponent(id)}/versions/${version}`, signal),
			create: (input: TemplateCreateInput) => write<TemplateView>("/api/admin/templates", "POST", input),
			update: (id: string, input: TemplateUpdateInput) =>
				write<TemplateView>(`/api/admin/templates/${encodeURIComponent(id)}`, "PUT", input),
			planListing: (id: string, input: TemplateListingInput) =>
				write<PlanResponse>(`/api/admin/templates/${encodeURIComponent(id)}/listing/plan`, "POST", input),
			confirmListing: (id: string, input: TemplateListingRequest) =>
				write<CatalogAgentView>(`/api/admin/templates/${encodeURIComponent(id)}/listing`, "POST", input),
			planDelete: (id: string) =>
				write<PlanResponse>(`/api/admin/templates/${encodeURIComponent(id)}/delete/plan`, "POST"),
			remove: (id: string, confirmation: ApplyRequest) =>
				write<{ deleted: boolean }>(`/api/admin/templates/${encodeURIComponent(id)}`, "DELETE", confirmation),
		},
		groups: {
			list: (query: Partial<GroupsQuery> = {}, signal?: AbortSignal) =>
				request.json<GroupsPage>(`/api/admin/groups${groupQuery(query)}`, { signal }),
			get: (id: string, signal?: AbortSignal) => get<GroupView>(groupPath(id), signal),
			create: (input: GroupInput) => write<GroupView>("/api/admin/groups", "POST", input),
			update: (id: string, input: GroupInput) => write<GroupView>(groupPath(id), "PATCH", input),
			members: (id: string, query: Partial<GroupMembershipQuery> = {}, signal?: AbortSignal) =>
				request.json<GroupMembersPage>(`${groupPath(id)}/members${groupQuery(query)}`, { signal }),
			updateMembers: (id: string, input: GroupMembersPatch) =>
				write<GroupView>(`${groupPath(id)}/members`, "PATCH", input),
			planDelete: (id: string) => write<PlanResponse>(`${groupPath(id)}/plan`, "POST", { action: "delete" }),
			remove: (id: string, confirmation: ApplyRequest) =>
				write<{ deleted: boolean }>(groupPath(id), "DELETE", confirmation),
		},
		usageLimits: {
			policy: (signal?: AbortSignal) => get<UsageLimitPolicy>("/api/admin/usage-limits/policy", signal),
			setPolicy: (limits: UsageLimitConfig) => write<UsageLimitPolicy>("/api/admin/usage-limits/policy", "PUT", limits),
		},
		usage: {
			/** Provider 侧模型用量明细（workspace scope 由服务端注入）；默认统计最近 7 天。 */
			modelUsage: (query: ModelUsageQuery = {}, signal?: AbortSignal) =>
				get<ModelUsagePage>(`/api/admin/usage/model-usage${usageTelemetryQuery(query)}`, signal),
			/** Provider 侧工具调用明细（workspace scope 由服务端注入）；默认统计最近 7 天。 */
			toolUsage: (query: ToolUsageQuery = {}, signal?: AbortSignal) =>
				get<ToolUsagePage>(`/api/admin/usage/tool-usage${usageTelemetryQuery(query)}`, signal),
			/** 以模版为主键聚合的体验会话用量（管理端「模版用量」视角）；search 按模版名/智能体名/模版 ID 过滤。 */
			templates: (query: { search?: string } = {}, signal?: AbortSignal) => {
				const params = new URLSearchParams();
				if (query.search) params.set("search", query.search);
				return get<TemplateUsageRow[]>(`/api/admin/usage/templates${params.size ? `?${params}` : ""}`, signal);
			},
			templateSessions: (templateId: string, query: { cursor?: string; limit?: number } = {}, signal?: AbortSignal) => {
				const params = new URLSearchParams();
				if (query.cursor) params.set("cursor", query.cursor);
				if (query.limit) params.set("limit", String(query.limit));
				return request.json<TemplateSessionsPage>(
					`/api/admin/usage/templates/${encodeURIComponent(templateId)}/sessions${params.size ? `?${params}` : ""}`,
					{ signal },
				);
			},
			/** 模版用量逐日趋势（限额账本条目逐日账）；templateId 缺省为全部模版求和，days 支持 7/14/28。 */
			templateTrend: (query: { templateId?: string; days?: 7 | 14 | 28 } = {}, signal?: AbortSignal) => {
				const params = new URLSearchParams();
				if (query.templateId) params.set("template_id", query.templateId);
				if (query.days) params.set("days", String(query.days));
				return get<TemplateUsageTrend>(
					`/api/admin/usage/templates/daily-trend${params.size ? `?${params}` : ""}`,
					signal,
				);
			},
			templateLimit: (templateId: string, signal?: AbortSignal) =>
				get<TemplateUsageLimitView>(`/api/admin/usage/templates/${encodeURIComponent(templateId)}/usage-limit`, signal),
			setTemplateLimit: (templateId: string, limits: UsageLimitConfig) =>
				write<TemplateUsageLimitView>(
					`/api/admin/usage/templates/${encodeURIComponent(templateId)}/usage-limit`,
					"PUT",
					limits,
				),
			resetTemplateLimit: (templateId: string) =>
				write<TemplateUsageLimitView>(
					`/api/admin/usage/templates/${encodeURIComponent(templateId)}/usage-limit`,
					"DELETE",
				),
		},
		members: {
			get: (id: string, signal?: AbortSignal) =>
				get<MemberView>(`/api/admin/members/${encodeURIComponent(id)}`, signal),
			groups: (id: string, query: Partial<GroupMembershipQuery> = {}, signal?: AbortSignal) =>
				request.json<MemberGroupsPage>(`${memberGroupsPath(id)}${groupQuery(query)}`, { signal }),
			updateGroups: (id: string, input: MemberGroupsPatch) =>
				write<{ updated: boolean }>(memberGroupsPath(id), "PATCH", input),
			usageLimit: (id: string, signal?: AbortSignal) =>
				get<MemberUsageLimitView>(`/api/admin/members/${encodeURIComponent(id)}/usage-limit`, signal),
			setUsageLimit: (id: string, limits: UsageLimitConfig) =>
				write<MemberUsageLimitView>(`/api/admin/members/${encodeURIComponent(id)}/usage-limit`, "PUT", limits),
			resetUsageLimit: (id: string) =>
				write<MemberUsageLimitView>(`/api/admin/members/${encodeURIComponent(id)}/usage-limit`, "DELETE"),
			list: (query: Partial<MembersQuery> = {}, signal?: AbortSignal) => {
				const params = new URLSearchParams();
				if (query.search) params.set("search", query.search);
				if (query.limit) params.set("limit", String(query.limit));
				if (query.page_token) params.set("page_token", query.page_token);
				return request.json<AdminMembersPage>(`/api/admin/members${params.size ? `?${params}` : ""}`, { signal });
			},
			create: (input: CreateMemberRequest) => write<CreateMemberResponse["data"]>("/api/admin/members", "POST", input),
			usage: (id: string, query: { agent_slug?: string; refresh?: boolean } = {}, signal?: AbortSignal) => {
				const params = new URLSearchParams();
				if (query.agent_slug) params.set("agent_slug", query.agent_slug);
				if (query.refresh) params.set("refresh", "1");
				return get<MemberUsageSummary>(
					`/api/admin/members/${encodeURIComponent(id)}/usage${params.size ? `?${params}` : ""}`,
					signal,
				);
			},
			sessions: (
				id: string,
				query: { agent_slug?: string; cursor?: string; limit?: number } = {},
				signal?: AbortSignal,
			) => {
				const params = new URLSearchParams();
				if (query.agent_slug) params.set("agent_slug", query.agent_slug);
				if (query.cursor) params.set("cursor", query.cursor);
				if (query.limit) params.set("limit", String(query.limit));
				return request.json<MemberSessionsPage>(
					`/api/admin/members/${encodeURIComponent(id)}/sessions${params.size ? `?${params}` : ""}`,
					{ signal },
				);
			},
		},
		resourceDrafts: {
			active: (signal?: AbortSignal, cleanupKey?: string) =>
				request
					.json<{ data: ResourceDraftView | null }>("/api/admin/resource-drafts/active", {
						signal,
						headers: cleanupKey ? { [RESOURCE_DRAFT_KEY_HEADER]: cleanupKey } : {},
					})
					.then((result) => result.data),
			create: (cleanupKey?: string) =>
				request
					.json<{ data: ResourceDraftView }>("/api/admin/resource-drafts", {
						method: "POST",
						headers: cleanupKey ? { [RESOURCE_DRAFT_KEY_HEADER]: cleanupKey } : {},
					})
					.then((result) => result.data),
			get: (id: string, signal?: AbortSignal) =>
				get<ResourceDraftView>(`/api/admin/resource-drafts/${encodeURIComponent(id)}`, signal),
			finalize: (id: string) =>
				write<ResourceDraftView>(`/api/admin/resource-drafts/${encodeURIComponent(id)}/finalize`, "POST"),
			discard: (id: string, options: { keepalive?: boolean; cleanupKey?: string } = {}) =>
				request
					.json<{ data: ResourceDraftDiscardResult }>(`/api/admin/resource-drafts/${encodeURIComponent(id)}/discard`, {
						method: "POST",
						keepalive: options.keepalive,
						headers: options.cleanupKey ? { [RESOURCE_DRAFT_KEY_HEADER]: options.cleanupKey } : {},
					})
					.then((result) => result.data),
		},
		draftResources: draftResourceClient(),
		operations: {
			get: (id: string, signal?: AbortSignal) =>
				get<OperationView>(`/api/admin/operations/${encodeURIComponent(id)}`, signal),
			list: (signal?: AbortSignal) => get<OperationView[]>("/api/admin/operations", signal),
			stream: (id: string, onOperation: (operation: OperationView) => void, signal?: AbortSignal) =>
				streamProtocolFrames(request, `/api/admin/operations/${encodeURIComponent(id)}/events`, {
					signal,
					onFrame: (frame) => {
						if (frame.type === "operation") onOperation(OperationViewSchema.parse(frame.data));
					},
				}),
		},
		debug: {
			createTemplateSession: (body: CreateTemplateDebugSessionRequest) =>
				write<DebugSessionDetail>("/api/admin/debug/sessions", "POST", body),
			session: (id: string, signal?: AbortSignal) => get<DebugSessionDetail>(sessionPath(id), signal),
			listThreads: (id: string, query: ThreadQueryOptions = {}) =>
				request.json<SessionThreadsResponse>(`${sessionPath(id)}/threads${threadQuery(query)}`, {
					signal: query.signal,
				}),
			listThreadEvents: (id: string, threadId: string, query: ThreadQueryOptions = {}) =>
				request
					.json<EventsPage>(`${sessionPath(id)}/threads/${encodeURIComponent(threadId)}/events${threadQuery(query)}`, {
						signal: query.signal,
					})
					.then((page) => ({ ...page, data: page.data.toReversed() })),
			sendMessage: (id: string, body: SendMessageRequest) =>
				write<SendMessageResponse>(`${sessionPath(id)}/messages`, "POST", body),
			interrupt: (id: string) => write<{ interrupted: boolean }>(`${sessionPath(id)}/interrupt`, "POST"),
			toolApprovals: (id: string) => get<ToolApprovalsResponse>(`${sessionPath(id)}/tool-approvals`),
			submitToolApproval: (id: string, body: ToolApprovalDecision) =>
				write<SendMessageResponse>(`${sessionPath(id)}/tool-approvals`, "POST", body),
			stream: (id: string, handlers: StreamSessionOptions = {}) =>
				streamProtocolFrames(
					request,
					`${sessionPath(id)}/stream${handlers.after ? `?after=${encodeURIComponent(handlers.after)}` : ""}`,
					{
						signal: handlers.signal,
						onFrame: (frame) => {
							if (frame.type === "event") handlers.onEvent?.(frame.data, frame.cursor);
							else if (frame.type === "reset") handlers.onReset?.();
							else if (frame.type === "ready")
								handlers.onReady?.({
									sessionId: frame.data.session_id,
									replayed: frame.data.replayed,
									cursor: frame.data.cursor,
								});
							else if (frame.type === "done")
								handlers.onDone?.({ status: frame.data.status, lastEventId: frame.data.last_event_id });
							else if (frame.type === "ping") handlers.onPing?.(frame.data.t);
						},
					},
				),
			planDelete: (id: string) => write<PlanResponse>(`${sessionPath(id)}/plan`, "POST", { action: "delete" }),
			deleteSession: (id: string, confirmation: ApplyRequest) =>
				write<{ deleted: boolean }>(sessionPath(id), "DELETE", confirmation),
			uploadFile: (file: Blob, filename: string) => {
				const body = new FormData();
				body.append("file", file, filename);
				return request
					.json<{ data: AttachmentRef }>("/api/admin/debug/files", { method: "POST", body })
					.then((result) => result.data);
			},
			downloadFile: (fileId: string, sessionId?: string) =>
				request.response(
					`/api/admin/debug/files/${encodeURIComponent(fileId)}/download${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`,
				),
		},
	};
}

export type AdminClient = ReturnType<typeof createAdminClient>;
