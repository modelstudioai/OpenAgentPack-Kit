import type { DatabaseSync } from "node:sqlite";
import type { KitServices } from "../app-env.ts";
import type { ServerConfig } from "../config.ts";
import { createMockGateway, type MockTelemetrySource } from "../gateway/mock.ts";
import { createSdkGateway } from "../gateway/sdk.ts";
import type { ProviderGateway } from "../gateway/types.ts";
import { createAuditLog } from "../store/audit.ts";
import { createBrandingStore } from "../store/branding.ts";
import { createCatalogStore } from "../store/catalog.ts";
import { openDatabase } from "../store/db.ts";
import { createFileStore } from "../store/files.ts";
import { createGroupStore } from "../store/groups.ts";
import { createMemberSessionStore } from "../store/member-sessions.ts";
import { createMemberStore } from "../store/members.ts";
import { createOperationStore } from "../store/operations.ts";
import { createPresetPackStore } from "../store/preset-packs.ts";
import { createQuotaStore } from "../store/quota.ts";
import { createResourceDraftStore } from "../store/resource-drafts.ts";
import { createSessionDeletionStore } from "../store/session-deletions.ts";
import { createSessionUsageStore } from "../store/session-usage.ts";
import { createSessionIndex } from "../store/sessions.ts";
import { createTemplateStore } from "../store/templates.ts";
import { createUsageLimitStore } from "../store/usage-limits.ts";
import { createConfirmGate } from "./confirm-gate.ts";
import { createDebugService } from "./debug.ts";
import { createEvalService } from "./eval.ts";
import { createEventBufferRegistry } from "./event-buffer.ts";
import { createFileService } from "./files.ts";
import { createGroupService } from "./groups.ts";
import { createMemberAuthService } from "./member-auth.ts";
import { createMemberUsageService } from "./member-usage.ts";
import { createMemberService } from "./members.ts";
import { createMetrics } from "./metrics.ts";
import { createOperationRunner } from "./operations.ts";
import { createPresetPackService } from "./preset-packs.ts";
import { createQuotaService } from "./quota.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { createResourceDraftService } from "./resource-drafts.ts";
import { createSessionService } from "./sessions.ts";
import { createTemplateService } from "./templates.ts";
import { createUsageLimitService } from "./usage-limits.ts";

export function createGateway(config: ServerConfig, telemetry?: MockTelemetrySource): ProviderGateway {
	if (config.resolvedGateway === "sdk" && config.bailian) return createSdkGateway(config.bailian);
	return createMockGateway({ fileScanDelayMs: config.mockFileScanDelayMs, telemetry });
}

export function createKitServices(config: ServerConfig, db?: DatabaseSync): KitServices {
	const database = db ?? openDatabase(config.dataDir);
	const branding = createBrandingStore(database);
	const usageSnapshots = createSessionUsageStore(database);
	// mock 网关不读本地库（保持 Provider 抽象分层），账本聚合经注入成为其演示明细的数据源。
	const gateway = createGateway(config, {
		byAgent: () => Promise.resolve(usageSnapshots.telemetryByAgent()),
		bySession: (sessionId) => Promise.resolve(usageSnapshots.telemetryBySession(sessionId)),
	});
	const buffers = createEventBufferRegistry();
	const sessionIndex = createSessionIndex(database);
	const catalog = createCatalogStore(database);
	const operations = createOperationStore(database);
	const audit = createAuditLog(database);
	const memberStore = createMemberStore(database);
	const members = createMemberService({ store: memberStore, audit });
	const memberUsage = createMemberUsageService({
		store: usageSnapshots,
		members: memberStore,
		gateway,
		sessionIndex,
	});
	const memberAuth = createMemberAuthService({
		members: memberStore,
		sessions: createMemberSessionStore(database),
		audit,
	});
	const gate = createConfirmGate(config);
	const groups = createGroupService({ store: createGroupStore(database), audit, gate });
	const templates = createTemplateService({
		store: createTemplateStore(database),
		gateway,
		audit,
		catalog,
		gate,
	});
	const runner = createOperationRunner(operations);
	const limiter = createRateLimiter({ rps: config.rateLimitRps, burst: config.rateLimitBurst });
	const metrics = createMetrics();
	const files = createFileService({ gateway, sessionIndex, store: createFileStore(database), metrics });
	const usageLimits = createUsageLimitService({
		buffers,
		store: createUsageLimitStore(database),
		members: memberStore,
		sessionIndex,
		snapshots: usageSnapshots,
		gateway,
		audit,
	});
	const sessions = createSessionService({
		usageLimits,
		memberUsage,
		deletionStore: createSessionDeletionStore(database),
		gateway,
		buffers,
		sessionIndex,
		pingIntervalMs: config.pingIntervalMs,
		fileScanTimeoutMs: config.fileScanTimeoutMs,
		metrics,
	});
	const evalService = createEvalService(config.evalWorkspaces);
	const quota = createQuotaService({
		store: createQuotaStore(database),
		catalog,
		sessionIndex,
		audit,
		...(config.quotaDefaultMonthly != null ? { defaultMonthly: config.quotaDefaultMonthly } : {}),
	});
	const resourceDrafts = createResourceDraftService({
		config,
		gateway,
		store: createResourceDraftStore(database),
		gate,
		runner,
		audit,
		operations,
	});
	const debug = createDebugService({
		sessions,
		sessionIndex,
		files,
		gateway,
		gate,
		audit,
	});
	return {
		config,
		branding,
		gateway,
		buffers,
		catalog,
		sessionIndex,
		operations,
		audit,
		gate,
		runner,
		sessions,
		quota,
		usageLimits,
		members,
		groups,
		templates,
		presetPacks: createPresetPackService({ store: createPresetPackStore(database), gateway }),
		memberUsage,
		memberAuth,
		files,
		eval: evalService,
		resourceDrafts,
		debug,
		limiter,
		metrics,
	};
}
