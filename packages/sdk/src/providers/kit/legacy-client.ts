import type {
	AgentDetail,
	AgentSummary,
	AttachmentRef,
	EventsPage,
	KitRuntimeConfig,
	MemberAuthView,
	MemberLoginRequest,
	MemberLoginResult,
	MemberUsageLimitView,
	PlazaCategory,
	PlazaView,
	QuotaRequestView,
	QuotaView,
	SendMessageRequest,
	SendMessageResponse,
	SessionDetail,
	SessionEvent,
	SessionSummary,
	SessionThreadsResponse,
	ToolApprovalDecision,
	ToolApprovalsResponse,
} from "../../protocol/index.ts";
import { isProtocolCompatible, KitError } from "../../protocol/index.ts";
import { loadSessionDirectory, type SessionListQuery } from "../../sessions/load-directory.ts";
import { createTransport, type TransportOptions } from "./transport.ts";

export interface LegacyKitClientOptions extends TransportOptions {}

import type { StreamSessionOptions, ThreadQueryOptions } from "../contract.ts";

export type { StreamSessionOptions } from "../contract.ts";

function qs(params: Record<string, string | number | undefined>): string {
	const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
	if (entries.length === 0) return "";
	return `?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")}`;
}

/** 数据面客户端。控制面操作由管理端直接走 transport（见 apps/console）。 */
export function createLegacyKitClient(options: LegacyKitClientOptions) {
	const transport = createTransport(options);
	const sessionAgents = (signal?: AbortSignal) =>
		transport.request<{ data: string[] }>("/api/kit/session-agents", { signal }).then((r) => r.data);
	const sessions = (query: SessionListQuery = {}, signal?: AbortSignal) =>
		transport
			.request<{ data: SessionSummary[]; next_page_token: string | null }>(
				`/api/kit/sessions${qs({ agent_slug: query.agentSlug, limit: query.limit, page_token: query.pageToken, include_archived: query.includeArchived === undefined ? undefined : String(query.includeArchived), q: query.q })}`,
				{ signal },
			)
			.then((r) => ({ sessions: r.data, nextPageToken: r.next_page_token }));

	return {
		transport,
		auth: {
			login: (body: MemberLoginRequest, signal?: AbortSignal) =>
				transport
					.request<{ data: MemberLoginResult }>("/api/kit/auth/login", {
						signal,
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(body),
					})
					.then((response) => response.data),
			me: (signal?: AbortSignal) =>
				transport.request<{ data: MemberAuthView }>("/api/kit/auth/me", { signal }).then((response) => response.data),
			logout: (signal?: AbortSignal) => transport.request<void>("/api/kit/auth/logout", { method: "POST", signal }),
		},
		config: (signal?: AbortSignal) =>
			transport.request<{ data: KitRuntimeConfig }>("/api/config", { signal }).then((r) => {
				if (!isProtocolCompatible(r.data.protocolVersion))
					throw new KitError("conflict", "客户端与服务端协议版本不兼容，请同步升级");
				return r.data;
			}),

		agents: (signal?: AbortSignal) =>
			transport.request<{ data: AgentSummary[] }>("/api/kit/agents", { signal }).then((r) => r.data),
		/** 广场视图：分类/精选/热门/我的 + 每条目个人统计。 */
		plaza: (query: { category?: PlazaCategory; q?: string } = {}, signal?: AbortSignal) =>
			transport
				.request<{ data: PlazaView }>(`/api/kit/plaza${qs({ category: query.category, q: query.q })}`, { signal })
				.then((r) => r.data),
		/** 本地成员的 UTC 月度 Token 与执行时长限额；匿名和外部身份返回 null。days 指定 daily 逐日窗口（1..400，缺省 30）。 */
		usageLimits: (query: { days?: number } = {}, signal?: AbortSignal) =>
			transport
				.request<{ data: MemberUsageLimitView | null }>(`/api/kit/usage-limits${qs({ days: query.days })}`, { signal })
				.then((r) => r.data),
		/** 我的月度用量（Credits）：余额/加油包/按 agent 分解/逐日窗口/待审批申请；days 指定 daily 窗口（1..400，缺省 30）。 */
		quota: (query: { days?: number } = {}, signal?: AbortSignal) =>
			transport
				.request<{ data: QuotaView }>(`/api/kit/quota${qs({ days: query.days })}`, { signal })
				.then((r) => r.data),
		quotaRequests: (signal?: AbortSignal) =>
			transport.request<{ data: QuotaRequestView[] }>("/api/kit/quota/requests", { signal }).then((r) => r.data),
		createQuotaRequest: (body: { requestedCredits: number; reason?: string }, signal?: AbortSignal) =>
			transport
				.request<{ data: QuotaRequestView }>("/api/kit/quota/requests", {
					signal,
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						requested_credits: body.requestedCredits,
						...(body.reason ? { reason: body.reason } : {}),
					}),
				})
				.then((r) => r.data),
		agent: (slug: string, signal?: AbortSignal) =>
			transport
				.request<{ data: AgentDetail }>(`/api/kit/agents/${encodeURIComponent(slug)}`, { signal })
				.then((r) => r.data),

		sessions,
		/** 本人未归档会话关联的全部智能体，含已下架或已删除的目录条目。 */
		sessionAgents,
		/** 先查询本人智能体，再完整读取各智能体的未归档会话摘要；失败不返回部分结果。 */
		sessionDirectory: (signal?: AbortSignal) => loadSessionDirectory({ sessionAgents, sessions }, signal),
		/**
		 * 建会话。`files` = 已上传附件（`uploadFile` 的结果），只能在创建时挂载进 sandbox；
		 * 服务端负责解析 mount_path 并在 SessionDetail.files 回显。
		 */
		createSession: (body: { agentSlug: string; title?: string; files?: AttachmentRef[] }, signal?: AbortSignal) =>
			transport
				.request<{ data: SessionDetail }>("/api/kit/sessions", {
					signal,
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						agent_slug: body.agentSlug,
						...(body.title ? { title: body.title } : {}),
						...(body.files?.length ? { files: body.files } : {}),
					}),
				})
				.then((r) => r.data),
		session: (id: string, signal?: AbortSignal) =>
			transport
				.request<{ data: SessionDetail }>(`/api/kit/sessions/${encodeURIComponent(id)}`, { signal })
				.then((r) => r.data),
		renameSession: (id: string, title: string, signal?: AbortSignal) =>
			transport
				.request<{ data: SessionDetail }>(`/api/kit/sessions/${encodeURIComponent(id)}`, {
					signal,
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ title }),
				})
				.then((r) => r.data),

		sendMessage: (sessionId: string, body: SendMessageRequest) =>
			transport
				.request<{ data: SendMessageResponse }>(`/api/kit/sessions/${encodeURIComponent(sessionId)}/messages`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				})
				.then((r) => r.data),
		toolApprovals: (sessionId: string) =>
			transport
				.request<{ data: ToolApprovalsResponse }>(`/api/kit/sessions/${encodeURIComponent(sessionId)}/tool-approvals`)
				.then((response) => response.data),
		submitToolApproval: (sessionId: string, decision: ToolApprovalDecision) =>
			transport
				.request<{ data: SendMessageResponse }>(`/api/kit/sessions/${encodeURIComponent(sessionId)}/tool-approvals`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(decision),
				})
				.then((response) => response.data),

		interrupt: (sessionId: string) =>
			transport
				.request<{ data: { interrupted: boolean } }>(`/api/kit/sessions/${encodeURIComponent(sessionId)}/interrupt`, {
					method: "POST",
				})
				.then((r) => r.data),

		events: (
			sessionId: string,
			query: { afterId?: string; limit?: number; pageToken?: string } = {},
		): Promise<EventsPage> =>
			transport
				.request<{ data: SessionEvent[]; next_page_token: string | null }>(
					`/api/kit/sessions/${encodeURIComponent(sessionId)}/events${qs({ after_id: query.afterId, limit: query.limit, page_token: query.pageToken })}`,
				)
				.then((r) => ({ data: r.data, next_page_token: r.next_page_token })),

		listThreads: (sessionId: string, query: ThreadQueryOptions = {}): Promise<SessionThreadsResponse> =>
			transport.request(
				`/api/kit/sessions/${encodeURIComponent(sessionId)}/threads${qs({ limit: query.limit, page_token: query.pageToken })}`,
				{ signal: query.signal },
			),
		listThreadEvents: (sessionId: string, threadId: string, query: ThreadQueryOptions = {}): Promise<EventsPage> =>
			transport
				.request<EventsPage>(
					`/api/kit/sessions/${encodeURIComponent(sessionId)}/threads/${encodeURIComponent(threadId)}/events${qs({ limit: query.limit, page_token: query.pageToken })}`,
					{ signal: query.signal },
				)
				.then((page) => ({ ...page, data: page.data.toReversed() })),

		stream: (sessionId: string, streamOptions: StreamSessionOptions = {}) =>
			transport.stream(
				`/api/kit/sessions/${encodeURIComponent(sessionId)}/stream${qs({ after: streamOptions.after ?? undefined })}`,
				{
					signal: streamOptions.signal,
					onFrame: (frame) => {
						if (frame.type === "event") streamOptions.onEvent?.(frame.data, frame.cursor);
						else if (frame.type === "reset") streamOptions.onReset?.();
						else if (frame.type === "ready")
							streamOptions.onReady?.({
								sessionId: frame.data.session_id,
								replayed: frame.data.replayed,
								cursor: frame.data.cursor,
							});
						else if (frame.type === "done")
							streamOptions.onDone?.({ status: frame.data.status, lastEventId: frame.data.last_event_id });
						else if (frame.type === "ping") streamOptions.onPing?.(frame.data.t);
					},
				},
			),

		sessionPlan: (sessionId: string, action: "archive" | "delete", signal?: AbortSignal) =>
			transport
				.request<{
					data: {
						plan_id: string;
						confirm_token: string;
						destructive: boolean;
						expires_at: number;
						diff: { resource: string; action: string; destructive: boolean }[];
					};
				}>(`/api/kit/sessions/${encodeURIComponent(sessionId)}/plan`, {
					signal,
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ action }),
				})
				.then((r) => r.data),
		archiveSession: (
			sessionId: string,
			confirmation: { plan_id: string; confirm_token: string },
			signal?: AbortSignal,
		) =>
			transport
				.request<{ data: { archived: boolean } }>(`/api/kit/sessions/${encodeURIComponent(sessionId)}/archive`, {
					signal,
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(confirmation),
				})
				.then((r) => r.data),
		deleteSession: (
			sessionId: string,
			confirmation: { plan_id: string; confirm_token: string },
			signal?: AbortSignal,
		) =>
			transport
				.request<{ data: { deleted: boolean } }>(`/api/kit/sessions/${encodeURIComponent(sessionId)}`, {
					signal,
					method: "DELETE",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(confirmation),
				})
				.then((r) => r.data),
		uploadFile: async (file: { name: string; bytes: Uint8Array; mimeType?: string }, signal?: AbortSignal) => {
			const form = new FormData();
			form.append(
				"file",
				new Blob([file.bytes as BlobPart], { type: file.mimeType ?? "application/octet-stream" }),
				file.name,
			);
			return transport
				.request<{ data: { file_id: string; filename: string; size: number } }>(`/api/kit/files`, {
					signal,
					method: "POST",
					body: form,
				})
				.then((r) => r.data);
		},
		fileDownloadUrl: (fileId: string) => transport.url(`/api/kit/files/${encodeURIComponent(fileId)}/download`),
		/** 附件安全扫描状态（`checking → available`，实测 15~20s）：上传后轮询到 available 再发送。 */
		fileStatus: (fileId: string, signal?: AbortSignal) =>
			transport
				.request<{ data: { file_id: string; status: string | null; available: boolean } }>(
					`/api/kit/files/${encodeURIComponent(fileId)}`,
					{ signal },
				)
				.then((r) => r.data),
		/** Artifact 下载须提供所属会话；本人上传文件可省略。返回响应供宿主保存。 */
		downloadFile: (fileId: string, input: { sessionId?: string; signal?: AbortSignal } = {}) =>
			transport.response(
				`/api/kit/files/${encodeURIComponent(fileId)}/download${qs({ session_id: input.sessionId })}`,
				{
					signal: input.signal,
				},
			),
	};
}

export type LegacyKitClient = ReturnType<typeof createLegacyKitClient>;
