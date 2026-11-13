import type {
	AuditLogsPage,
	AuditLogsQuery,
	BrandingUpdate,
	BrandingView,
	CatalogAgentCreateInput,
	CatalogAgentUpdateInput,
	CatalogAgentView,
	CreateMemberRequest,
	CreateQuotaPack,
	EvalRunDetail,
	EvalRunSummary,
	EvalWorkspaceView,
	MembersQuery,
	OperationView,
	PresetPackAgentResources,
	PresetPackCreateInput,
	PresetPackPreview,
	PresetPacksPage,
	PresetPacksQuery,
	PresetPackView,
	PutQuotaOverride,
	PutQuotaPolicy,
	QuotaOverrideView,
	QuotaPackView,
	QuotaPolicyView,
	QuotaRequestView,
	QuotaUsageRow,
	RemoteEnvironment,
	RemoteFile,
	RemoteMemoryStore,
	RemoteVault,
	ReviewQuotaRequest,
} from "@openagentpack/kit-sdk/protocol";
import { BRANDING_LOGO_PATH } from "@openagentpack/kit-sdk/protocol";
import { createAdminClient } from "./admin/index.ts";
import { adminBaseUrl } from "./auth.ts";
import { adminRequest } from "./kit.ts";

export { adminToken, setAdminToken } from "./auth.ts";

/** 与管理请求共用已解析的后端地址及动态管理员身份。 */
export function getAdminClient() {
	return createAdminClient({ request: adminRequest() });
}

/** 上传 Logo 与管理请求共用完整 API base，保留反向代理路径前缀。 */
function brandingView(view: BrandingView): BrandingView {
	const { logoUrl } = view;
	if (!logoUrl?.startsWith(BRANDING_LOGO_PATH)) return view;
	return { ...view, logoUrl: `${adminBaseUrl()}${logoUrl}` };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const headers = new Headers(init?.headers);
	if (!(init?.body instanceof FormData) && !headers.has("content-type"))
		headers.set("content-type", "application/json");
	return adminRequest().json<T>(path, { ...init, headers });
}

/** 审批队列筛选值（与服务端 query `status` 一致）。 */
export type QuotaRequestStatus = QuotaRequestView["status"];

export const adminApi = {
	presetPacks: {
		preview: (input: PresetPackCreateInput, signal?: AbortSignal) =>
			request<{ data: PresetPackPreview }>("/api/admin/preset-packs/preview", {
				method: "POST",
				body: JSON.stringify(input),
				signal,
			}).then((result) => result.data),
		list: (query: Partial<PresetPacksQuery> = {}, signal?: AbortSignal) => {
			const params = new URLSearchParams({
				search: query.search ?? "",
				limit: String(query.limit ?? 10),
				offset: String(query.offset ?? 0),
			});
			return request<PresetPacksPage>(`/api/admin/preset-packs?${params}`, { signal });
		},
		create: (input: PresetPackCreateInput, signal?: AbortSignal) =>
			request<{ data: PresetPackView }>("/api/admin/preset-packs", {
				method: "POST",
				body: JSON.stringify(input),
				signal,
			}).then((result) => result.data),
		get: (id: string, signal?: AbortSignal) =>
			request<{ data: PresetPackView }>(`/api/admin/preset-packs/${encodeURIComponent(id)}`, { signal }).then(
				(result) => result.data,
			),
		agentResources: (agentId: string, signal?: AbortSignal) =>
			request<{ data: PresetPackAgentResources }>(
				`/api/admin/preset-packs/agents/${encodeURIComponent(agentId)}/resources`,
				{ signal },
			).then((result) => result.data),
	},
	audit: {
		list: (query: AuditLogsQuery, signal?: AbortSignal) =>
			request<AuditLogsPage>(`/api/admin/audit?limit=${query.limit}&offset=${query.offset}`, { signal }),
	},
	branding: {
		get: (signal?: AbortSignal) =>
			request<{ data: BrandingView }>("/api/admin/branding", { signal }).then((result) => brandingView(result.data)),
		update: (input: BrandingUpdate) =>
			request<{ data: BrandingView }>("/api/admin/branding", {
				method: "PUT",
				body: JSON.stringify(input),
			}).then((result) => brandingView(result.data)),
		uploadLogo: (file: File) => {
			const body = new FormData();
			body.append("file", file);
			return request<{ data: BrandingView }>("/api/admin/branding/logo", {
				method: "POST",
				body,
			}).then((result) => brandingView(result.data));
		},
	},
	members: {
		list: (query: Partial<MembersQuery> = {}, signal?: AbortSignal) =>
			createAdminClient({ request: adminRequest() }).members.list(query, signal),
		create: (input: CreateMemberRequest) => createAdminClient({ request: adminRequest() }).members.create(input),
	},
	catalog: {
		list: () => request<{ data: CatalogAgentView[] }>("/api/admin/agents").then((r) => r.data),
		create: (input: CatalogAgentCreateInput) =>
			request<{ data: CatalogAgentView }>("/api/admin/agents", { method: "POST", body: JSON.stringify(input) }).then(
				(r) => r.data,
			),
		/** 改绑定与展示信息（环境/开场白/主题等）；status 不在此路径改。 */
		update: (slug: string, patch: CatalogAgentUpdateInput) =>
			request<{ data: CatalogAgentView }>(`/api/admin/agents/${encodeURIComponent(slug)}`, {
				method: "PUT",
				body: JSON.stringify(patch),
			}).then((r) => r.data),
		/** 删条目第一段：同样必须 plan → 确认（服务端拒绝无令牌的 DELETE）。 */
		planDelete: (slug: string) =>
			request<{
				data: {
					plan_id: string;
					confirm_token: string;
					destructive: boolean;
					expires_at: number;
					diff: { resource: string; action: string; destructive: boolean; summary?: string }[];
				};
			}>(`/api/admin/agents/${encodeURIComponent(slug)}/plan`, {
				method: "POST",
				body: JSON.stringify({ action: "delete" }),
			}).then((r) => r.data),
		remove: (slug: string, confirmation: { plan_id: string; confirm_token: string }) =>
			request<{ data: { deleted: boolean } }>(`/api/admin/agents/${encodeURIComponent(slug)}`, {
				method: "DELETE",
				body: JSON.stringify(confirmation),
			}).then((r) => r.data),
		/** 上/下架第一段：拿 plan 与一次性确认令牌（服务端拒绝无令牌的状态变更）。 */
		plan: (slug: string, status: "listed" | "unlisted") =>
			request<{
				data: {
					plan_id: string;
					confirm_token: string;
					destructive: boolean;
					expires_at: number;
					diff: { resource: string; action: string; destructive: boolean; summary?: string }[];
				};
			}>(`/api/admin/agents/${encodeURIComponent(slug)}/plan`, {
				method: "POST",
				body: JSON.stringify({ action: "listing", status }),
			}).then((r) => r.data),
		setStatus: (
			slug: string,
			status: "listed" | "unlisted",
			confirmation: { plan_id: string; confirm_token: string },
		) =>
			request<{ data: CatalogAgentView }>(`/api/admin/agents/${encodeURIComponent(slug)}`, {
				method: "PATCH",
				body: JSON.stringify({ status, ...confirmation }),
			}).then((r) => r.data),
	},
	operations: {
		list: () => request<{ data: OperationView[] }>("/api/admin/operations").then((r) => r.data),
	},
	eval: {
		workspaces: () => request<{ data: EvalWorkspaceView[] }>("/api/admin/eval/workspaces").then((r) => r.data),
		runs: (workspace: string) =>
			request<{ data: EvalRunSummary[] }>(`/api/admin/eval/runs?workspace=${encodeURIComponent(workspace)}`).then(
				(r) => r.data,
			),
		run: (workspace: string, runId: string) =>
			request<{ data: EvalRunDetail }>(
				`/api/admin/eval/runs/${encodeURIComponent(runId)}?workspace=${encodeURIComponent(workspace)}`,
			).then((r) => r.data),
	},
	/**
	 * Credits 配额与提额审批（op 对照见 docs/interfaces.md 的 `admin.quota.*`）。
	 * 与其它管理页共用 Request 和动态管理员令牌；配额操作不写入智能体操作日志。
	 */
	quota: {
		policy: () => request<{ data: QuotaPolicyView }>("/api/admin/quota/policy").then((r) => r.data),
		/** `monthly_credits = -1` 表示不限量。 */
		putPolicy: (monthlyCredits: number) =>
			request<{ data: QuotaPolicyView }>("/api/admin/quota/policy", {
				method: "PUT",
				body: JSON.stringify({ monthly_credits: monthlyCredits } satisfies PutQuotaPolicy),
			}).then((r) => r.data),
		/** 每员工长期上限（服务端已附当月 used / packs / remaining，便于直接决策）。 */
		overrides: () => request<{ data: QuotaOverrideView[] }>("/api/admin/quota/overrides").then((r) => r.data),
		putOverride: (subjectId: string, body: PutQuotaOverride) =>
			request<{ data: QuotaOverrideView }>(`/api/admin/quota/overrides/${encodeURIComponent(subjectId)}`, {
				method: "PUT",
				body: JSON.stringify(body),
			}).then((r) => r.data),
		/** 删除后该 subject 回落默认政策（不可逆，UI 侧走 AlertDialog 确认）。 */
		deleteOverride: (subjectId: string) =>
			request<{ data: { deleted: boolean } }>(`/api/admin/quota/overrides/${encodeURIComponent(subjectId)}`, {
				method: "DELETE",
			}).then((r) => r.data),
		createPack: (body: CreateQuotaPack) =>
			request<{ data: QuotaPackView }>("/api/admin/quota/packs", {
				method: "POST",
				body: JSON.stringify(body),
			}).then((r) => r.data),
		deletePack: (packId: string) =>
			request<{ data: { deleted: boolean } }>(`/api/admin/quota/packs/${encodeURIComponent(packId)}`, {
				method: "DELETE",
			}).then((r) => r.data),
		/** 审批队列；省略 status = 全部。 */
		requests: (status?: QuotaRequestStatus) =>
			request<{ data: QuotaRequestView[] }>(`/api/admin/quota/requests${status ? `?status=${status}` : ""}`).then(
				(r) => r.data,
			),
		/** approve 必须带 mode，reject 必须带 note，否则服务端 400（错误消息直接展示在弹窗内）。 */
		review: (id: string, body: ReviewQuotaRequest) =>
			request<{ data: QuotaRequestView }>(`/api/admin/quota/requests/${encodeURIComponent(id)}/review`, {
				method: "POST",
				body: JSON.stringify(body),
			}).then((r) => r.data),
		usage: (month?: string) =>
			request<{ data: QuotaUsageRow[] }>(
				`/api/admin/quota/usage${month ? `?month=${encodeURIComponent(month)}` : ""}`,
			).then((r) => r.data),
	},
	operation: (id: string) =>
		request<{ data: OperationView }>(`/api/admin/operations/${encodeURIComponent(id)}`).then((r) => r.data),
	remoteAgents: (signal?: AbortSignal) =>
		request<{ data: { agent_id: string; name: string; version?: number; is_coordinator?: boolean }[] }>(
			"/api/admin/remote/agents",
			{
				signal,
			},
		).then((r) => r.data),
	remoteEnvironments: (signal?: AbortSignal) =>
		request<{ data: RemoteEnvironment[] }>("/api/admin/remote/environments", {
			signal,
		}).then((r) => r.data),
	remoteFiles: (signal?: AbortSignal) =>
		request<{ data: RemoteFile[] }>("/api/admin/remote/files", {
			signal,
		}).then((r) => r.data),
	remoteMemoryStores: (signal?: AbortSignal) =>
		request<{ data: RemoteMemoryStore[] }>("/api/admin/remote/memory-stores", {
			signal,
		}).then((r) => r.data),
	remoteVaults: (signal?: AbortSignal) =>
		request<{ data: RemoteVault[] }>("/api/admin/remote/vaults", {
			signal,
		}).then((r) => r.data),
};
