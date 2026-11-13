import type { ServerConfig } from "./config.ts";
import type { ProviderGateway } from "./gateway/types.ts";
import type { Identity } from "./identity/types.ts";
import type { ConfirmGate } from "./services/confirm-gate.ts";
import type { DebugService } from "./services/debug.ts";
import type { DraftResourceService } from "./services/draft-resources.ts";
import type { EvalService } from "./services/eval.ts";
import type { EventBufferRegistry } from "./services/event-buffer.ts";
import type { FileService } from "./services/files.ts";
import type { GroupService } from "./services/groups.ts";
import type { MemberAuthService } from "./services/member-auth.ts";
import type { MemberUsageService } from "./services/member-usage.ts";
import type { MemberService } from "./services/members.ts";
import type { Metrics } from "./services/metrics.ts";
import type { OperationRunner } from "./services/operations.ts";
import type { PresetPackService } from "./services/preset-packs.ts";
import type { QuotaService } from "./services/quota.ts";
import type { RateLimiter } from "./services/rate-limit.ts";
import type { ResourceDraftService } from "./services/resource-drafts.ts";
import type { SessionService } from "./services/sessions.ts";
import type { TemplateService } from "./services/templates.ts";
import type { UsageLimitService } from "./services/usage-limits.ts";
import type { AuditLog } from "./store/audit.ts";
import type { BrandingStore } from "./store/branding.ts";
import type { CatalogStore } from "./store/catalog.ts";
import type { MemberSessionRecord } from "./store/member-sessions.ts";
import type { OperationStore } from "./store/operations.ts";
import type { SessionIndex } from "./store/sessions.ts";

export interface KitServices {
	config: ServerConfig;
	branding: BrandingStore;
	gateway: ProviderGateway;
	buffers: EventBufferRegistry;
	catalog: CatalogStore;
	sessionIndex: SessionIndex;
	operations: OperationStore;
	audit: AuditLog;
	sessions: SessionService;
	quota: QuotaService;
	usageLimits: UsageLimitService;
	members: MemberService;
	groups: GroupService;
	templates: TemplateService;
	presetPacks: PresetPackService;
	memberUsage: MemberUsageService;
	memberAuth: MemberAuthService;
	files: FileService;
	eval: EvalService;
	resourceDrafts: ResourceDraftService;
	debug: DebugService;
	runner: OperationRunner;
	gate: ConfirmGate;
	limiter: RateLimiter;
	metrics: Metrics;
}

export type AdminRole = "admin" | "auditor";

/**
 * 管理端主体。类型定义放在这里（而不是 services/identity.ts）是因为 AppEnv 要引用它，
 * 而 identity.ts 又引用 AppEnv——放一起会形成循环依赖（dependency-cruiser `no-circular`）。
 */
export interface AdminIdentity {
	/** 审计主体：`admin:<role>:<令牌指纹>`，不含令牌原文。 */
	subject: string;
	role: AdminRole;
}

export interface AppEnv {
	Variables: {
		draftResources: DraftResourceService;
		identity: Identity;
		services: KitServices;
		/** 仅 /api/admin/* 设置：已解析的管理端主体与角色。 */
		admin: AdminIdentity;
		/** 本地登录态的服务端记录，不包含 Bearer token 原文。 */
		memberSession?: MemberSessionRecord;
		/** 本地登录 / 可信 JWT 的截止时间，供流式连接主动到期。 */
		authExpiresAt?: string;
	};
}
