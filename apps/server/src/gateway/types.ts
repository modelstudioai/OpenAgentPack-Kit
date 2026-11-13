import type {
	AgentMemoryStore,
	AttachmentRef,
	CatalogMemoryStore,
	MemoryStoreConfiguration,
	PresetPackAgentResources,
	PublicationReport,
	RemoteAgentResources,
	RemoteAgentVersion,
	RemoteAgentVersionDetail,
	RemoteEnvironment,
	RemoteEnvironmentDetail,
	RemoteFile,
	RemoteMemoryStore,
	RemoteSkill,
	RemoteSkillSource,
	RemoteSkillVersion,
	RemoteVault,
	RemoteVaultDetail,
	ResourceDraftAgentCreateResult,
	ResourceDraftDeclaration,
	ResourceDraftEnvironmentCreateResult,
	ResourceDraftMemoryStoreCreateResult,
	ResourceDraftOverview,
	ResourceDraftVaultCreateResult,
	SessionEvent,
	SessionStats,
	SessionThreadsResponse,
	SessionUsage,
} from "@openagentpack/kit-sdk/protocol";
import type { ModelUsagePage, ModelUsageRequest, ToolUsagePage, ToolUsageRequest } from "@openagentpack/sdk";
import type { YamlDraftStorage } from "./yaml-draft-document.ts";

export interface GatewaySessionInfo {
	session_id: string;
	status: string;
	title?: string;
	/** Provider 详情中的累计绝对值；缺失不代表零。 */
	usage?: SessionUsage;
	/** Provider 返回的秒数，不转换为毫秒。 */
	stats?: SessionStats;
	/** 详情未返回时仍需通过主会话状态事件识别待审批，不能把 idle 一律视为执行结束。 */
	stop_reason?: { type: string };
	/** 创建时挂载进 sandbox 的附件（provider 不一定回传，缺失时以本地索引为准）。 */
	files?: AttachmentRef[];
}

export interface GatewayCreateSessionInput {
	agentId: string;
	/** 显式绑定的远端 Agent 版本；省略时在创建会话时解析最新版本。 */
	agentVersion?: number;
	/** 经服务端校验的目录或管理员调试环境；省略时使用 Agent 默认环境。 */
	environmentId?: string;
	title?: string;
	/**
	 * 刻意没有 files 字段：创建时 file_resource 回显成功但 sandbox 不物化（实测
	 * 2026-11-03，docs/research/bailian-session-file-mount.md）。附件由服务层在
	 * 建会话后经 `mountSessionResource` 挂载，不要把文件挂载加回创建载荷。
	 */
	/** 来自服务端目录配置或管理员调试校验；不接受体验端自行指定的记忆库。 */
	memoryStores?: CatalogMemoryStore[];
	/** 服务端校验后的密钥库身份，不包含任何凭据值。 */
	vaultIds?: string[];
}

export interface GatewaySendInput {
	text: string;
	clientMessageId?: string;
}

export interface GatewayApprovalInput {
	batch_id: string;
	call_id: string;
	result: "allow" | "deny";
	deny_message?: string;
	session_thread_id?: string;
}

import type {
	DeclarationPreview,
	DeclarationPreviewInput,
	ProjectAgentCreateInput,
	ProjectAgentOptions,
	ProjectDeclaration,
	ProjectEnvironmentCreateInput,
	ProjectFileUpload,
	ProjectFileUploadCommit,
	ProjectFileUploadInput,
	ProjectFileUploadPreview,
	ProjectMemoryStoreCreateInput,
	ProjectOverview,
	ProjectResourceBindingInput,
	ProjectResourceBindings,
	ProjectSkillUpload,
	ProjectSkillUploadCommit,
	ProjectSkillUploadInput,
	ProjectSkillUploadPreview,
	ProjectVaultCreateInput,
} from "@openagentpack/kit-sdk/protocol";
export type ProjectOverviewInfo = ProjectOverview;
export type DeclarationRef = ProjectDeclaration;
/** 本地项目上传暂存内容，仅在服务端保存声明时交给 gateway。 */
export interface ProjectSourceFileUpload extends ProjectFileUpload {
	bytes: Uint8Array;
}
export interface ProjectSourceSkillUpload extends ProjectSkillUpload {
	bytes: Uint8Array;
	files: Array<{ path: string; bytes: Uint8Array }>;
}
export interface ProjectExecutionPlan {
	project_revision: string;
	yaml_hash?: string;
	fingerprint: string;
	diff: PlanDiffEntry[];
}
export interface ProjectFeedback {
	log(line: string): void;
	progress(value: number, phase?: string): void;
	publication?(report: PublicationReport): void;
}
export interface PlanDiffEntry {
	resource: string;
	action: "create" | "update" | "delete" | "noop";
	destructive: boolean;
	summary?: string;
}

/**
 * Provider 数据面抽象。路由层只认这个接口；真实与 mock 走同一条路径，
 * 同一套契约用例跑两遍防漂移。见 AGENTS.md 不变量 1 与 docs/architecture.md。
 */
export interface ProviderGateway {
	resourceDraftDocument(id: string, assetRoot: string, storage: YamlDraftStorage): ResourceDraftGateway;
	readonly mode: "sdk" | "mock";
	createSession(input: GatewayCreateSessionInput): Promise<GatewaySessionInfo>;
	getSession(sessionId: string): Promise<GatewaySessionInfo | null>;
	sendMessage(sessionId: string, input: GatewaySendInput): Promise<{ event_ids: string[] }>;
	respondToolApproval(sessionId: string, input: GatewayApprovalInput): Promise<{ event_ids: string[] }>;
	interrupt(sessionId: string): Promise<void>;
	archiveSession(sessionId: string): Promise<void>;
	deleteSession(sessionId: string): Promise<void>;
	/**
	 * 运行时把已上传文件挂载进**运行中**会话（provider `POST /sessions/:id/resources`，
	 * SDK `mountRemoteSessionResource`）。不产生会话事件；agent 在下一轮即可读取文件。
	 * mountPath 需为 `/mnt/session/uploads/…` 或 `/uploads/…`；扫描就绪由服务层先行保证。
	 */
	mountSessionResource(
		sessionId: string,
		input: { fileId: string; mountPath: string },
	): Promise<{ resourceId: string; mountPath: string }>;
	/** 卸载运行时挂载并清除 provider 内部文件副本（不可恢复）。创建时挂载的资源没有资源 id。 */
	unmountSessionResource(sessionId: string, resourceId: string): Promise<void>;
	uploadFile(input: {
		filename: string;
		bytes: Uint8Array;
		mimeType?: string;
	}): Promise<{ file_id: string; filename: string; size: number }>;
	/**
	 * 附件扫描状态：provider 上传后要过安全扫描才可绑定到会话
	 * （实测 bailian `checking → available` 约 15~20s，见 docs/research/bailian-session-file-mount.md）。
	 */
	fileStatus(fileId: string): Promise<{ available: boolean; status?: string }>;
	listEvents(
		sessionId: string,
		options?: { afterId?: string; pageToken?: string; limit?: number; signal?: AbortSignal },
	): Promise<{ events: SessionEvent[]; next_page_token: string | null }>;
	listThreads(
		sessionId: string,
		options?: { pageToken?: string; limit?: number; signal?: AbortSignal },
	): Promise<SessionThreadsResponse>;
	listThreadEvents(
		sessionId: string,
		threadId: string,
		options?: { pageToken?: string; limit?: number; signal?: AbortSignal },
	): Promise<{ events: SessionEvent[]; next_page_token: string | null }>;
	streamEvents(
		sessionId: string,
		options?: { afterId?: string; signal?: AbortSignal; onReady?: () => void },
	): AsyncIterable<SessionEvent>;
	downloadFile(fileId: string): Promise<{ body: Uint8Array; contentType: string; filename: string }>;
	listRemoteAgents(): Promise<{ agent_id: string; name: string; version?: number; is_coordinator?: boolean }[]>;
	getPresetPackAgentResources(agentId: string, signal?: AbortSignal): Promise<PresetPackAgentResources>;
	/** 远端 Agent 配置资源投影（tools/skills/mcp_servers）；远端不存在返回 null。 */
	getRemoteAgentResources(agentId: string): Promise<RemoteAgentResources | null>;
	/** 目录记忆配置的成员侧投影（名称/描述，只读元数据）；查询失败抛错，由路由整体降级省略。 */
	getAgentMemoryStores(config: CatalogMemoryStore[]): Promise<AgentMemoryStore[]>;
	/** 只读 Skill 元数据；聚合全部页供名称/ID 搜索。 */
	listRemoteSkills(source: RemoteSkillSource): Promise<RemoteSkill[]>;
	/** 固定版本复核；不存在返回 null，不回退最新版。 */
	getRemoteSkillVersion(skillId: string, version: string): Promise<RemoteSkillVersion | null>;
	listRemoteAgentVersions(agentId: string): Promise<RemoteAgentVersion[]>;
	/** 精确读取历史快照；不存在或已归档返回 null，不能回退最新版本。 */
	getRemoteAgentVersion(
		agentId: string,
		version: number,
	): Promise<{ agent_id: string; name: string; version?: number } | null>;
	/** 仅用于管理员历史配置查看，服务端投影并脱敏；不影响版本绑定校验的轻量摘要。 */
	getRemoteAgentVersionDetail(agentId: string, version: number): Promise<RemoteAgentVersionDetail | null>;
	listRemoteEnvironments(): Promise<RemoteEnvironment[]>;
	/** 只读安全配置投影，不下发变量值或脚本；不存在或已归档返回 null。 */
	getRemoteEnvironment(environmentId: string): Promise<RemoteEnvironmentDetail | null>;
	/** 仅返回有上传来源证据的文件，保留扫描状态供管理端选择。 */
	listRemoteFiles(): Promise<RemoteFile[]>;
	/** 非上传文件或不存在时返回 null；用于目录保存时重新验证，不信任客户端摘要。 */
	getRemoteFile(fileId: string): Promise<RemoteFile | null>;
	listRemoteMemoryStores(): Promise<RemoteMemoryStore[]>;
	getRemoteMemoryStoreConfiguration(id: string): Promise<MemoryStoreConfiguration | null>;
	/** 不存在或已归档返回 null；只读库元数据，不查询记忆内容。 */
	getRemoteMemoryStore(memoryStoreId: string): Promise<RemoteMemoryStore | null>;
	listRemoteVaults(): Promise<RemoteVault[]>;
	/** 仅元数据校验；不存在或已归档返回 null。 */
	getRemoteVault(vaultId: string): Promise<RemoteVault | null>;
	/** Provider 侧模型用量明细（app-control usage.listModelUsage）；scope 由路由层组装后传入。 */
	listModelUsage(request: ModelUsageRequest, options?: { signal?: AbortSignal }): Promise<ModelUsagePage>;
	/** Provider 侧工具调用明细（app-control usage.listToolUsage）；scope 由路由层组装后传入。 */
	listToolUsage(request: ToolUsageRequest, options?: { signal?: AbortSignal }): Promise<ToolUsagePage>;
	/** 显式查看详情时查询密钥元数据，绝不返回密钥值。 */
	getRemoteVaultDetail(vaultId: string): Promise<RemoteVaultDetail | null>;
}

export interface ResourceDraftGateway {
	publicationBindings(): Promise<ResourceDraftPublishedBinding[]>;

	agentOptions(): Promise<ProjectAgentOptions>;

	createAgent(input: ProjectAgentCreateInput): Promise<ResourceDraftAgentCreateResult>;
	memoryStoreConfiguration(id: string): Promise<MemoryStoreConfiguration>;
	createMemoryStore(input: ProjectMemoryStoreCreateInput): Promise<ResourceDraftMemoryStoreCreateResult>;
	createVault(input: ProjectVaultCreateInput): Promise<ResourceDraftVaultCreateResult>;

	createEnvironment(input: ProjectEnvironmentCreateInput): Promise<ResourceDraftEnvironmentCreateResult>;
	previewSkillUploads(
		input: ProjectSkillUploadInput,
		uploads: ProjectSourceSkillUpload[],
	): Promise<ProjectSkillUploadPreview>;
	commitSkillUploads(
		input: ProjectSkillUploadInput,
		uploads: ProjectSourceSkillUpload[],
	): Promise<ProjectSkillUploadCommit>;
	previewFileUploads(
		input: ProjectFileUploadInput,
		uploads: ProjectSourceFileUpload[],
	): Promise<ProjectFileUploadPreview>;
	commitFileUploads(
		input: ProjectFileUploadInput,
		uploads: ProjectSourceFileUpload[],
	): Promise<ProjectFileUploadCommit>;
	overview(): Promise<ResourceDraftOverview>;
	declarations(): Promise<ResourceDraftDeclaration[]>;
	resourceBindings(): Promise<ProjectResourceBindings>;
	resolveResourceBindings(input: ProjectResourceBindingInput): Promise<ProjectResourceBindings>;
	declaration(type: string, id: string): Promise<ResourceDraftDeclaration>;
	declarationPreview(type: string, id: string, input: DeclarationPreviewInput): Promise<DeclarationPreview>;
	putDeclaration(
		type: string,
		id: string,
		input: { base_revision: string; declaration: Record<string, unknown> },
	): Promise<{ new_revision: string }>;
	deleteDeclaration(type: string, id: string, baseRevision: string): Promise<{ new_revision: string }>;
	validate(): Promise<{ diagnostics: string[]; warnings?: string[] }>;
	plan(): Promise<ProjectExecutionPlan>;
	execute(expected: ProjectExecutionPlan, feedback?: ProjectFeedback): Promise<{ revision?: string }>;
	clearSecrets(): void;
}

import type { ResourceDraftPublishedBinding } from "../resource-draft-types.ts";

export type { ResourceDraftPublishedBinding } from "../resource-draft-types.ts";
