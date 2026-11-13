import { z } from "zod";
import type { SessionEvent } from "./events.ts";
import { PublicationErrorDetailsSchema, PublicationReportSchema } from "./publication.ts";
import { MemberUsageSummarySchema, SessionStatsSchema, SessionUsageSchema } from "./session-usage.ts";

/** 线上一律 snake_case（与 Provider 对齐）；camelCase 仅 kit 自有对象的 TS 侧。 */

export const AgentCapabilitiesSchema = z.object({
	streaming: z.boolean().default(true),
	fileUpload: z.boolean().default(true),
	artifacts: z.boolean().default(true),
	threads: z.boolean().default(true),
	reasoning: z.boolean().default(true),
});
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;

export const CatalogThemeSchema = z.object({
	accent: z.string().optional(),
	iconBackground: z.string().optional(),
});

/** 广场分类（v1 固定枚举，不做管理员自定义；「精选」由 featured 标志承载）。 */
export const PlazaCategorySchema = z.enum(["general", "writing", "coding", "data", "other"]);
export type PlazaCategory = z.infer<typeof PlazaCategorySchema>;
export const PLAZA_CATEGORY_LABELS: Record<PlazaCategory, string> = {
	general: "通用",
	writing: "写作",
	coding: "编程",
	data: "数据分析",
	other: "其他",
};

/** 体验页可见的上架条目（数据面）。 */
export const AgentSummarySchema = z.object({
	slug: z.string(),
	display_name: z.string(),
	description: z.string().optional(),
	icon: z.string().optional(),
	opening_remarks: z.string().optional(),
	suggested_prompts: z.array(z.string()).default([]),
	capabilities: AgentCapabilitiesSchema,
	theme: CatalogThemeSchema.optional(),
	category: PlazaCategorySchema.default("general"),
	featured: z.boolean().default(false),
});
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

/** 单项资源（工具 / Skill / MCP 服务）的成员侧投影。`permission` 仅工具条目携带：
 * "ask"=每次询问（执行时 Provider 发 tool_approval_request 走审批卡）、
 * "allow"=总是允许；投影自 wire 的 permission_policy（always_ask/always_allow），未声明按 allow。 */
export const AgentResourceItemSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	permission: z.enum(["allow", "ask"]).optional(),
});
export type AgentResourceItem = z.infer<typeof AgentResourceItemSchema>;

/**
 * 远端 Agent 配置的成员侧投影。上游 `CloudAgent` 的 tools / skills / mcp_servers 均为
 * unknown 形状（SDK 不承诺结构），此处先按 mock 形状定合同，live 实测后校准。
 */
export const RemoteAgentResourcesSchema = z.object({
	tools: z.array(AgentResourceItemSchema).default([]),
	skills: z.array(AgentResourceItemSchema).default([]),
	mcp_servers: z.array(AgentResourceItemSchema).default([]),
});
export type RemoteAgentResources = z.infer<typeof RemoteAgentResourcesSchema>;

/** 成员侧记忆库投影：库显示名与描述；不含库 ID、访问权限或条目内容。 */
export const AgentMemoryStoreSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
});
export type AgentMemoryStore = z.infer<typeof AgentMemoryStoreSchema>;

export const AgentDetailSchema = AgentSummarySchema.extend({
	id: z.string(),
	remote_agent_id: z.string(),
	remote_agent_version: z.number().optional(),
	/** 远端 Agent 配置资源投影：懒读取，Provider 失败或未绑定时缺省。 */
	resources: RemoteAgentResourcesSchema.optional(),
	/** 目录配置的记忆库投影（名称/描述）：懒读取，Provider 失败或未配置时省略。 */
	memory_stores: z.array(AgentMemoryStoreSchema).max(8).optional(),
});
export type AgentDetail = z.infer<typeof AgentDetailSchema>;

/**
 * 附件引用：`file_id` 来自 `POST /api/kit/files` 上传结果。
 * 挂载时机有两种（实测 2026-11-02，docs/research/bailian-session-file-mount.md）：
 * 创建会话时随 `files` 绑定；已有会话随 `messages.attachments` 运行时挂载
 * （provider `POST /sessions/:id/resources`，SDK `mountRemoteSessionResource`）。
 * `mount_path` 省略时由服务端按 `/mnt/session/uploads/<安全文件名>` 解析并保证同会话唯一。
 */
export const AttachmentRefSchema = z.object({
	file_id: z.string(),
	filename: z.string().optional(),
	mount_path: z.string().optional(),
	size: z.number().int().nonnegative().optional(),
});
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;

/** kit 上传体积上限默认值（服务端 KIT_UPLOAD_MAX_BYTES 缺省同源）；provider 合同上限 50MB（官方文档 /zh/api/managed-agents/file/upload），kit 收得更紧。 */
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
/** 实测被 provider 拒绝的扩展名（.mjs 415「文件类型不被允许」，同内容 .txt/.mjs.txt 可过，2026-11-03）。 */
export const UPLOAD_BLOCKED_EXTENSIONS = ["mjs"] as const;

/** 扩展名黑名单前置校验：命中返回给用户看的拒绝原因，允许返回 null。服务端与前端共用同一份文案。 */
export function uploadTypeRejectionReason(filename: string): string | null {
	const extension = filename.includes(".") ? (filename.split(".").pop()?.toLowerCase() ?? "") : "";
	if ((UPLOAD_BLOCKED_EXTENSIONS as readonly string[]).includes(extension)) return `不支持的文件类型：.${extension}`;
	return null;
}

/** 体积前置校验：超限返回拒绝原因，否则 null。 */
export function uploadSizeRejectionReason(size: number): string | null {
	if (Number.isFinite(size) && size > UPLOAD_MAX_BYTES) {
		return `文件超过上限 ${Math.floor(UPLOAD_MAX_BYTES / 1024 / 1024)}MB`;
	}
	return null;
}

export const SessionSummarySchema = z.object({
	session_id: z.string(),
	agent_slug: z.string(),
	title: z.string().optional(),
	status: z.string().optional(),
	created_at: z.string(),
	last_event_at: z.string().optional(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

/** 一条用户消息与其随行附件的关联：event_ids 是发送响应回传的事件身份，用于历史重建定位气泡。 */
export const MessageFileAssociationSchema = z.object({
	event_ids: z.array(z.string().min(1)).min(1),
	files: z.array(AttachmentRefSchema).min(1),
});
export type MessageFileAssociation = z.infer<typeof MessageFileAssociationSchema>;

export const SessionDetailSchema = SessionSummarySchema.extend({
	usage: SessionUsageSchema.optional(),
	stats: SessionStatsSchema.optional(),
	remote_status: z.string().optional(),
	/** 创建时挂载进 sandbox 的附件（含解析后的 mount_path）。 */
	files: z.array(AttachmentRefSchema).optional(),
	/** 随消息运行时挂载的附件，按发送响应的 event_ids 关联；provider 不回显，本地索引是唯一来源。 */
	message_files: z.array(MessageFileAssociationSchema).optional(),
});
export type SessionDetail = z.infer<typeof SessionDetailSchema>;

export const CreateSessionRequestSchema = z.object({
	agent_slug: z.string().min(1),
	title: z.string().max(120).optional(),
	/** 需要挂载的已上传文件；mount_path 省略时由服务端按 provider 约定生成。 */
	files: z.array(AttachmentRefSchema).max(10).optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const SendMessageRequestSchema = z.object({
	text: z.string().min(1).max(32000),
	/** 技能 token 授权名单：从正文输入标记派生的技能名（ADR-0016）；服务端只转换名单内的标记。 */
	skills: z.array(z.string().min(1).max(240)).max(10).optional(),
	/** 需要随本条消息运行时挂载进 sandbox 的已上传文件；发送失败由服务端自动卸载回滚。 */
	attachments: z.array(AttachmentRefSchema).max(10).optional(),
	client_message_id: z.string().max(128).optional(),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const SendMessageResponseSchema = z.object({
	session_id: z.string(),
	accepted: z.boolean(),
	event_ids: z.array(z.string()).default([]),
});
export type SendMessageResponse = z.infer<typeof SendMessageResponseSchema>;

export function eventsPageSchema() {
	return z.object({
		data: z.array(z.unknown()),
		next_page_token: z.string().nullable(),
	});
}
export interface EventsPage {
	data: SessionEvent[];
	next_page_token: string | null;
}

/** Provider 的子 Agent 线程摘要；主线程不作为独立 Thread 资源返回。 */
export const SessionThreadSummarySchema = z.object({
	id: z.string(),
	session_id: z.string(),
	parent_thread_id: z.string(),
	agent: z.object({ id: z.string(), version: z.number().optional(), name: z.string().optional() }),
	agent_name: z.string().optional(),
	status: z.string(),
	created_at: z.string(),
	updated_at: z.string(),
	archived_at: z.string().nullable().optional(),
});
export type SessionThreadSummary = z.infer<typeof SessionThreadSummarySchema>;

export const SessionThreadsResponseSchema = z.object({
	data: z.array(SessionThreadSummarySchema),
	next_page_token: z.string().nullable(),
});
export type SessionThreadsResponse = z.infer<typeof SessionThreadsResponseSchema>;

export const PageQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(50),
	page_token: z.string().optional(),
	after_id: z.string().optional(),
});

export const StreamQuerySchema = z.object({
	after: z.string().optional(),
});

/** ---- 控制面 ---- */

/** 本地成员账号；成员登录与现有 subjectId 的关联由后续身份功能接入。 */
export const MemberViewSchema = z.object({
	usage_summary: MemberUsageSummarySchema.optional(),
	member_id: z.string(),
	username: z.string(),
	display_name: z.string(),
	email: z.string().optional(),
	auth_type: z.literal("local"),
	status: z.literal("active"),
	created_at: z.string(),
	updated_at: z.string(),
});
export type MemberView = z.infer<typeof MemberViewSchema>;

export const MemberLoginRequestSchema = z.object({
	username: z.string().trim().min(1, "请输入用户名").max(32, "用户名最多 32 个字符").toLowerCase(),
	password: z.string().min(1, "请输入密码").max(128, "密码长度超出限制"),
});
export type MemberLoginRequest = z.infer<typeof MemberLoginRequestSchema>;

export const MemberLoginResultSchema = z.object({
	access_token: z.string(),
	token_type: z.literal("Bearer"),
	expires_at: z.string(),
	member: MemberViewSchema,
});
export type MemberLoginResult = z.infer<typeof MemberLoginResultSchema>;

export const MemberAuthViewSchema = z.object({
	identity: z.object({
		subjectId: z.string(),
		displayName: z.string().optional(),
		tier: z.string().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	}),
	member: MemberViewSchema.optional(),
	expires_at: z.string().optional(),
});
export type MemberAuthView = z.infer<typeof MemberAuthViewSchema>;

const memberFields = {
	username: z
		.string()
		.trim()
		.min(3, "用户名须为 3–32 个字符")
		.max(32, "用户名须为 3–32 个字符")
		.regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, "用户名须以字母或数字开头，仅含字母、数字、下划线、点和连字符")
		.toLowerCase(),
	display_name: z.string().trim().min(1, "请输入显示名称").max(32, "显示名称最多 32 个字符"),
	email: z.string().trim().max(254, "邮箱最多 254 个字符").email("请输入有效的邮箱地址").optional(),
	auth_type: z.literal("local"),
};

export const MemberPasswordSchema = z
	.string()
	.min(8, "密码须为 8–32 个字符")
	.max(32, "密码须为 8–32 个字符")
	.regex(/^[!-~]+$/, "密码仅支持非空格的 ASCII 字符")
	.regex(/[a-z]/, "密码须包含小写字母")
	.regex(/[A-Z]/, "密码须包含大写字母")
	.regex(/[0-9]/, "密码须包含数字")
	.regex(/[^a-zA-Z0-9]/, "密码须包含特殊字符")
	.describe("8–32 位非空格 ASCII 字符，须包含大小写字母、数字和特殊字符；不能包含用户名（不区分大小写）");

export const CreateMemberRequestSchema = z
	.discriminatedUnion("password_mode", [
		z.object({
			...memberFields,
			password_mode: z.literal("auto"),
			password: z.string().optional().describe("自动生成模式不得传入该字段"),
		}),
		z.object({ ...memberFields, password_mode: z.literal("custom"), password: MemberPasswordSchema }),
	])
	.superRefine((input, ctx) => {
		if (input.password_mode === "auto" && input.password !== undefined) {
			ctx.addIssue({ code: "custom", path: ["password"], message: "自动生成密码时请勿传入密码" });
		}
		if (input.password_mode === "custom" && input.password.toLowerCase().includes(input.username)) {
			ctx.addIssue({ code: "custom", path: ["password"], message: "密码不能包含用户名（不区分大小写）" });
		}
	});
export type CreateMemberRequest = z.infer<typeof CreateMemberRequestSchema>;

export const CreateMemberResponseSchema = z.object({
	data: z.object({ member: MemberViewSchema, initial_password: z.string().optional() }),
});
export type CreateMemberResponse = z.infer<typeof CreateMemberResponseSchema>;

export const MembersQuerySchema = z.object({
	search: z.string().trim().max(254).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(20),
	page_token: z.string().max(2048).optional(),
});
export type MembersQuery = z.infer<typeof MembersQuerySchema>;

export const MembersPageSchema = z.object({
	data: z.array(MemberViewSchema),
	next_page_token: z.string().optional(),
});
export type MembersPage = z.infer<typeof MembersPageSchema>;

export const CatalogMemoryStoreSchema = z.object({
	memory_store_id: z.string().trim().min(1),
	access: z.enum(["read_only", "read_write"]).default("read_write"),
	instructions: z.string().max(4090).optional(),
});
export type CatalogMemoryStore = z.infer<typeof CatalogMemoryStoreSchema>;

/** 管理员从远端资源选择创建调试会话；资源存在性与元数据由服务端重新验证。 */
export const CreateTemplateDebugSessionRequestSchema = z.object({
	remote_agent_id: z.string().trim().min(1),
	/** 显式选择的远端 Agent 版本；省略使用 Provider 最新版，不同于保存时元数据快照。 */
	agent_version: z.number().int().positive().optional(),
	/** 省略时沿用所选 Agent 的默认环境，不固化默认环境的远端 ID。 */
	remote_environment_id: z.string().trim().min(1).optional(),
	title: z.string().max(120).optional(),
	files: z.array(AttachmentRefSchema).max(10).optional(),
	memory_stores: z.array(CatalogMemoryStoreSchema).max(8).optional(),
	vault_ids: z
		.array(
			z
				.string()
				.trim()
				.regex(/^[A-Za-z0-9_-]+$/),
		)
		.max(10)
		.optional(),
});
export type CreateTemplateDebugSessionRequest = z.infer<typeof CreateTemplateDebugSessionRequestSchema>;

/** 只投影可选择的版本号，不向浏览器传递 Agent 配置或 Provider 原始字段。 */
export const RemoteAgentVersionSchema = z.object({ version: z.number().int().positive() });
export type RemoteAgentVersion = z.infer<typeof RemoteAgentVersionSchema>;

/** 指定版本的只读配置投影；敏感字段由服务端脱敏，不包含 Provider 原始属性。 */
export const RemoteAgentVersionDetailSchema = z.object({
	agent_id: z.string(),
	name: z.string(),
	version: z.number().int().positive(),
	created_at: z.string().optional(),
	description: z.string().optional(),
	/** 被脱敏或裁剪的配置区；仅为受控字段名，不能将这些展示值用于另存。 */
	redacted_fields: z
		.array(z.enum(["name", "description", "model", "instructions", "tools", "skills", "mcp_servers", "multiagent"]))
		.optional(),
	configuration: z.object({
		model: z.unknown().optional(),
		instructions: z.string().optional(),
		tools: z.unknown().optional(),
		skills: z.unknown().optional(),
		mcp_servers: z.unknown().optional(),
		multiagent: z.unknown().optional(),
	}),
});
export type RemoteAgentVersionDetail = z.infer<typeof RemoteAgentVersionDetailSchema>;

export const RemoteMemoryStoreSchema = z.object({
	memory_store_id: z.string(),
	name: z.string(),
});
export type RemoteMemoryStore = z.infer<typeof RemoteMemoryStoreSchema>;

/** 只包含密钥库身份与名称，不包含凭据、注入变量或 Provider 原始属性。 */
export const RemoteVaultSchema = z.object({
	vault_id: z.string(),
	name: z.string(),
});
export type RemoteVault = z.infer<typeof RemoteVaultSchema>;

/** 详情只包含可展示的密钥元数据，不含值、auth 或 Provider 原始属性。 */
export const RemoteVaultDetailSchema = RemoteVaultSchema.extend({
	credentials: z.array(
		z.object({
			credential_id: z.string(),
			name: z.string(),
			secret_name: z.string(),
			allowed_hosts: z.array(z.string()),
		}),
	),
});
export type RemoteVaultDetail = z.infer<typeof RemoteVaultDetailSchema>;

export const CatalogAgentInputSchema = z.object({
	slug: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,62}[A-Za-z0-9]$/),
	display_name: z.string().min(1).max(60),
	description: z.string().max(400).optional(),
	icon: z.string().max(512).optional(),
	opening_remarks: z.string().max(2000).optional(),
	suggested_prompts: z.array(z.string().max(200)).max(8).default([]),
	capabilities: AgentCapabilitiesSchema.optional(),
	theme: CatalogThemeSchema.optional(),
	remote_agent_id: z.string().min(1),
	remote_agent_version: z.number().int().optional(),
	/** 新会话的显式版本绑定；null 清除，省略保留已有绑定。 */
	agent_version: z.number().int().positive().nullable().optional(),
	/** 新体验会话使用的远端环境；null 清除覆盖，省略时保留已有配置。 */
	remote_environment_id: z.string().min(1).nullable().optional(),
	/** 管理员选择的默认挂载文件；省略保留，[] 清空。 */
	files: z.array(AttachmentRefSchema).max(10).optional(),
	/** 管理员授权的新会话记忆资源；省略保留，[] 清空 Kit 配置。 */
	memory_stores: z.array(CatalogMemoryStoreSchema).max(8).optional(),
	/** 新会话绑定的既有密钥库；省略保留，[] 清空 Kit 配置。 */
	vault_ids: z
		.array(
			z
				.string()
				.trim()
				.min(1)
				.regex(/^[A-Za-z0-9_-]+$/),
		)
		.max(10)
		.optional(),
	visibility: z.enum(["public", "internal"]).default("public"),
	ordering: z.number().int().default(100),
	category: PlazaCategorySchema.default("general"),
	featured: z.boolean().default(false),
});
export type CatalogAgentInput = z.infer<typeof CatalogAgentInputSchema>;
/** 客户端提交形状：带默认值的字段（suggested_prompts/visibility/ordering/capabilities）可省略。 */
export type CatalogAgentCreateInput = z.input<typeof CatalogAgentInputSchema>;
/** 改展示信息的提交形状（slug 是身份，不可改；status 只经 plan → 确认）。 */
export type CatalogAgentUpdateInput = Partial<Omit<CatalogAgentCreateInput, "slug">>;

export const CatalogAgentViewSchema = CatalogAgentInputSchema.extend({
	id: z.string(),
	status: z.enum(["unlisted", "listed"]),
	created_at: z.string(),
	updated_at: z.string(),
});
export type CatalogAgentView = z.infer<typeof CatalogAgentViewSchema>;

export const RemoteEnvironmentSchema = z.object({
	environment_id: z.string(),
	name: z.string(),
});
export type RemoteEnvironment = z.infer<typeof RemoteEnvironmentSchema>;

/** 环境详情的只读白名单；变量值和初始化脚本只返回脱敏标记。 */
export const RemoteEnvironmentDetailSchema = RemoteEnvironmentSchema.extend({
	description: z.string().optional(),
	/** 只含受控字段路径，标记无法无损填入环境创建表单的配置；原环境仍可直接使用。 */
	copy_restricted_fields: z
		.array(
			z.enum([
				"name",
				"description",
				"metadata",
				"scope",
				"configuration",
				"configuration.type",
				"configuration.networking",
				"configuration.packages",
				"configuration.environment_variables",
				"configuration.setup_script",
			]),
		)
		.optional(),
	metadata: z.record(z.string(), z.string()).optional(),
	package_status: z.enum(["building", "ready"]).optional(),
	scope: z.string().optional(),
	version: z.number().int().positive().optional(),
	type: z.string().optional(),
	created_at: z.string().optional(),
	updated_at: z.string().optional(),
	configuration: z.object({
		type: z.string().optional(),
		networking: z
			.object({
				type: z.string().optional(),
				allow_mcp_servers: z.boolean().optional(),
				allow_package_managers: z.boolean().optional(),
				allowed_hosts: z.array(z.string()).optional(),
			})
			.optional(),
		packages: z
			.object({
				apt: z.array(z.string()).optional(),
				pip: z.array(z.string()).optional(),
				npm: z.array(z.string()).optional(),
				go: z.array(z.string()).optional(),
				cargo: z.array(z.string()).optional(),
				gem: z.array(z.string()).optional(),
			})
			.optional(),
		environment_variables: z.record(z.string(), z.literal("[redacted]")).optional(),
		setup_script: z.literal("[redacted]").optional(),
	}),
});
export type RemoteEnvironmentDetail = z.infer<typeof RemoteEnvironmentDetailSchema>;

/** 仅管理端可读的已上传文件，不含下载地址或 Provider 原始属性。 */
export const RemoteFileSchema = z.object({
	file_id: z.string(),
	filename: z.string(),
	size: z.number().nonnegative().optional(),
	status: z.string().optional(),
	available: z.boolean(),
});
export type RemoteFile = z.infer<typeof RemoteFileSchema>;

export const SetListingRequestSchema = z.object({
	status: z.enum(["listed", "unlisted"]),
	confirm_token: z.string().min(1),
});
export type SetListingRequest = z.infer<typeof SetListingRequestSchema>;

export const PlanDiffEntrySchema = z.object({
	resource: z.string(),
	action: z.enum(["create", "update", "delete", "noop"]),
	destructive: z.boolean().default(false),
	summary: z.string().optional(),
});

export const PlanResponseSchema = z.object({
	plan_id: z.string(),
	confirm_token: z.string(),
	destructive: z.boolean(),
	expires_at: z.number(),
	diff: z.array(PlanDiffEntrySchema),
});
export type PlanResponse = z.infer<typeof PlanResponseSchema>;

export const ApplyRequestSchema = z.object({
	plan_id: z.string().min(1),
	confirm_token: z.string().min(1),
});
export type ApplyRequest = z.infer<typeof ApplyRequestSchema>;

export const OperationViewSchema = z.object({
	operation_id: z.string(),
	kind: z.string(),
	status: z.enum(["pending", "running", "succeeded", "failed", "cancelled"]),
	phase: z.string().optional(),
	progress: z.number().min(0).max(1),
	log: z.array(z.string()).default([]),
	result: z.unknown().optional(),
	error: z.string().optional(),
	publication: PublicationReportSchema.optional(),
	error_details: PublicationErrorDetailsSchema.optional(),
	created_at: z.string(),
	updated_at: z.string(),
});
export type OperationView = z.infer<typeof OperationViewSchema>;

export const AuditLogViewSchema = z.object({
	id: z.number().int(),
	at: z.string(),
	subject: z.string().nullable(),
	action: z.string(),
	target: z.string().nullable(),
	detail: z.string().nullable(),
});
export type AuditLogView = z.infer<typeof AuditLogViewSchema>;

export const AuditLogsQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(200).default(100),
	offset: z.coerce.number().int().min(0).default(0),
});
export type AuditLogsQuery = z.infer<typeof AuditLogsQuerySchema>;

export const AuditLogsPageSchema = z.object({
	data: z.array(AuditLogViewSchema),
	total: z.number().int().nonnegative(),
});
export type AuditLogsPage = z.infer<typeof AuditLogsPageSchema>;

export const ProjectOverviewSchema = z.object({
	name: z.string(),
	project_revision: z.string(),
	active_mutation: z.string().nullable().optional(),
	remote_checked: z.boolean().optional(),
	environments: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
	config_path: z.string().optional(),
	state_path: z.string().optional(),
	aligned: z.boolean(),
	drift: z.array(z.string()).default([]),
	agents: z.array(z.object({ id: z.string(), name: z.string(), model: z.string().optional() })).default([]),
});
export type ProjectOverview = z.infer<typeof ProjectOverviewSchema>;

/** ---- 广场与用量（v1）---- */

export const PlazaAgentStatsSchema = z.object({
	/** 当前身份是否用过（有会话即算）。 */
	mine: z.boolean(),
	/** 近 30 天全局 turn 数（Credits 口径），popular 排序依据。 */
	turns_30d: z.number().int().nonnegative(),
	last_used_at: z.string().optional(),
});
export type PlazaAgentStats = z.infer<typeof PlazaAgentStatsSchema>;

export const PlazaEntrySchema = AgentSummarySchema.extend({
	stats: PlazaAgentStatsSchema,
});
export type PlazaEntry = z.infer<typeof PlazaEntrySchema>;

export const PlazaQuerySchema = z.object({
	category: PlazaCategorySchema.optional(),
	q: z.string().max(64).optional(),
});
export type PlazaQuery = z.infer<typeof PlazaQuerySchema>;

export const PlazaViewSchema = z.object({
	/** 已上架条目（含分类/精选/个人统计），按 category+q 过滤后 ordering 升序。 */
	agents: z.array(PlazaEntrySchema),
	/** 精选 slug 列表（featured=true，ordering 升序）。 */
	featured: z.array(z.string()),
	/** 热门 slug 列表（turns_30d top5；全 0 时回退 ordering）。 */
	popular: z.array(z.string()),
	categories: z.array(z.object({ id: PlazaCategorySchema, name: z.string(), count: z.number().int().nonnegative() })),
});
export type PlazaView = z.infer<typeof PlazaViewSchema>;

export const QuotaPackViewSchema = z.object({
	id: z.string(),
	month: z.string(),
	credits: z.number().int().positive(),
	reason: z.string().optional(),
	granted_by: z.string(),
	created_at: z.string(),
});
export type QuotaPackView = z.infer<typeof QuotaPackViewSchema>;

export const QuotaRequestViewSchema = z.object({
	id: z.string(),
	subject_id: z.string(),
	requested_credits: z.number().int().positive(),
	reason: z.string().optional(),
	status: z.enum(["pending", "approved", "rejected"]),
	/** 审批通过时的生效方式：override=改长期月度上限；pack=当月加油包。 */
	mode: z.enum(["override", "pack"]).nullable(),
	granted_credits: z.number().int().positive().nullable(),
	review_note: z.string().optional(),
	reviewed_by: z.string().optional(),
	created_at: z.string(),
	reviewed_at: z.string().optional(),
});
export type QuotaRequestView = z.infer<typeof QuotaRequestViewSchema>;

export const QuotaViewSchema = z.object({
	month: z.string(),
	/** 次月 1 日 UTC（ISO）。 */
	reset_at: z.string(),
	unlimited: z.boolean(),
	/** 默认政策值（-1=不限量）。 */
	base_limit: z.number().int(),
	override_limit: z.number().int().nullable(),
	packs: z.array(QuotaPackViewSchema),
	/** 生效月度上限（不含 packs；-1=不限量）。 */
	limit: z.number().int(),
	used: z.number().int().nonnegative(),
	/** 剩余（含 packs）；unlimited 时为 -1。 */
	remaining: z.number().int(),
	per_agent: z.array(z.object({ agent_slug: z.string(), turns: z.number().int().nonnegative() })),
	/** 近 30 天（含今天，UTC 日键升序，零值补全）。 */
	daily: z.array(z.object({ day: z.string(), turns: z.number().int().nonnegative() })),
	pending_request: QuotaRequestViewSchema.nullable(),
});
export type QuotaView = z.infer<typeof QuotaViewSchema>;

export const CreateQuotaRequestSchema = z.object({
	requested_credits: z.number().int().min(1).max(1_000_000),
	reason: z.string().max(400).optional(),
});
export type CreateQuotaRequest = z.infer<typeof CreateQuotaRequestSchema>;

export const ReviewQuotaRequestSchema = z.object({
	action: z.enum(["approve", "reject"]),
	/** approve 必填：长期上限 or 当月加油包（员工申请时不选，审批时二选一）。 */
	mode: z.enum(["override", "pack"]).optional(),
	granted_credits: z.number().int().min(1).max(1_000_000).optional(),
	note: z.string().max(400).optional(),
});
export type ReviewQuotaRequest = z.infer<typeof ReviewQuotaRequestSchema>;

export const QuotaPolicyViewSchema = z.object({
	monthly_credits: z.number().int(),
	updated_at: z.string().optional(),
	updated_by: z.string().optional(),
});
export type QuotaPolicyView = z.infer<typeof QuotaPolicyViewSchema>;

export const PutQuotaPolicySchema = z.object({ monthly_credits: z.number().int().min(-1) });
export type PutQuotaPolicy = z.infer<typeof PutQuotaPolicySchema>;

export const PutQuotaOverrideSchema = z.object({
	monthly_credits: z.number().int().min(-1),
	reason: z.string().max(400).optional(),
});
export type PutQuotaOverride = z.infer<typeof PutQuotaOverrideSchema>;

export const CreateQuotaPackSchema = z.object({
	subject_id: z.string().min(1).max(128),
	credits: z.number().int().min(1).max(1_000_000),
	reason: z.string().max(400).optional(),
});
export type CreateQuotaPack = z.infer<typeof CreateQuotaPackSchema>;

/** 管理端 override 行：附带该 subject 当月用量与加油包，便于直接决策。 */
export const QuotaOverrideViewSchema = z.object({
	subject_id: z.string(),
	monthly_credits: z.number().int(),
	reason: z.string().optional(),
	updated_by: z.string(),
	updated_at: z.string(),
	used: z.number().int().nonnegative(),
	packs: z.array(QuotaPackViewSchema),
	remaining: z.number().int(),
});
export type QuotaOverrideView = z.infer<typeof QuotaOverrideViewSchema>;

export const QuotaUsageRowSchema = z.object({
	subject_id: z.string(),
	used: z.number().int().nonnegative(),
	limit: z.number().int(),
	remaining: z.number().int(),
});
export type QuotaUsageRow = z.infer<typeof QuotaUsageRowSchema>;

/** ---- 评测浏览（控制面只读视图）---- */

export const EvalWorkspaceViewSchema = z.object({
	/** workspace 根路径（`<skill-dir>-workspace`）。 */
	path: z.string(),
	/** 目录名，用作展示标识。 */
	name: z.string(),
	skill_name: z.string().optional(),
	runs: z.number().int().nonnegative(),
});
export type EvalWorkspaceView = z.infer<typeof EvalWorkspaceViewSchema>;

export const EvalRunSummarySchema = z.object({
	run_id: z.string(),
	created_at: z.string(),
	skill: z.object({ name: z.string(), version: z.string() }),
	model: z.string(),
	judge_model: z.string(),
	case_count: z.number().int().nonnegative(),
	pass_rate: z.number(),
	pass_rate_stddev: z.number(),
	baseline_pass_rate: z.number().nullable(),
	delta_pass_rate: z.number().nullable(),
	infra_excluded: z.number().int().nonnegative(),
});
export type EvalRunSummary = z.infer<typeof EvalRunSummarySchema>;

export const EvalRunCaseRowSchema = z.object({
	case_id: z.string(),
	kind: z.string(),
	triggered: z.boolean(),
	turns: z.number().int().nonnegative(),
	duration_ms: z.number().nonnegative(),
	score: z.number(),
	infra_error: z.boolean().optional(),
	error: z.string().optional(),
	assertions: z.array(
		z.object({
			kind: z.enum(["script", "judge"]),
			passed: z.boolean(),
			text: z.string(),
			evidence: z.string(),
		}),
	),
});
export type EvalRunCaseRow = z.infer<typeof EvalRunCaseRowSchema>;

export const EvalRunDetailSchema = z.object({
	summary: EvalRunSummarySchema,
	cases: z.array(EvalRunCaseRowSchema),
	baseline_cases: z.array(EvalRunCaseRowSchema).nullable(),
	/** report.html 原文（console 用 srcdoc 渲染，避免令牌进 URL）。 */
	report_html: z.string(),
});
export type EvalRunDetail = z.infer<typeof EvalRunDetailSchema>;
