import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { UPLOAD_MAX_BYTES } from "@openagentpack/kit-sdk/protocol";

export interface BailianCredentials {
	apiKey: string;
	baseUrl?: string;
	workspaceId?: string;
}

export interface ServerConfig {
	port: number;
	dataDir: string;
	adminToken: string;
	jwtSecret?: string;
	/** 默认要求成员或可信 JWT 身份；匿名演示必须显式开启。 */
	authMode: "member" | "anonymous";
	corsOrigins: string[];
	gatewayMode: "auto" | "mock" | "sdk";
	/** 解析后的实际 gateway 模式（auto 时按凭据有无决定） */
	resolvedGateway: "mock" | "sdk";
	bailian?: BailianCredentials;
	confirmSecret: string;
	pingIntervalMs: number;
	pingTimeoutMs: number;
	/** 对外公开 base url；空串表示「与访问者同源」（反代/壳注入场景） */
	publicBaseUrl: string;
	/** 单文件上传上限（字节）。超限直接 400，避免把大文件读进内存。 */
	uploadMaxBytes: number;
	/** 普通 JSON 请求体上限（字节）；上传路由单独用 uploadMaxBytes。 */
	bodyLimitBytes: number;
	/** 每 subject 的令牌桶速率（请求/秒）与突发容量；0 表示关闭限流。 */
	rateLimitRps: number;
	rateLimitBurst: number;
	/** 建会话时等待附件扫描可用的最长时间（毫秒）；超时返回可重试的 409。 */
	fileScanTimeoutMs: number;
	/** **仅 mock gateway**：模拟 provider 的文件扫描耗时，用来离线测「未就绪 → 409 可重试」。 */
	mockFileScanDelayMs: number;
	/** 管理端令牌与角色：`ADMIN_TOKEN` 恒为 admin，`KIT_ADMIN_TOKENS` 可追加 admin/auditor。 */
	adminPrincipals: AdminPrincipal[];
	/** 默认月度 Credits（`KIT_QUOTA_DEFAULT_MONTHLY`）；仅在政策行未被人工改过时生效。 */
	quotaDefaultMonthly?: number;
	/** 评测 workspace 根目录列表（`KIT_EVAL_WORKSPACES` 逗号分隔）：控制面只读浏览用。 */
	evalWorkspaces: string[];
}

/** 管理端主体：auditor 是只读角色（审计与运营查看），不能触发任何写/破坏性动作。 */
export interface AdminPrincipal {
	token: string;
	role: "admin" | "auditor";
}

/**
 * 解析 `KIT_ADMIN_TOKENS`：`<token>:<role>` 逗号分隔，role 省略为 admin。
 * 令牌只用于比较，不落库、不进日志；审计里记的是 `admin:<指纹>`。
 */
export function parseAdminPrincipals(env: NodeJS.ProcessEnv): AdminPrincipal[] {
	const out: AdminPrincipal[] = [];
	const primary = env.ADMIN_TOKEN?.trim();
	if (primary) out.push({ token: primary, role: "admin" });
	for (const entry of (env.KIT_ADMIN_TOKENS ?? "").split(",")) {
		const item = entry.trim();
		if (!item) continue;
		const sep = item.lastIndexOf(":");
		const role = (sep > 0 ? item.slice(sep + 1) : "admin").trim();
		const token = (sep > 0 ? item.slice(0, sep) : item).trim();
		if (!token) continue;
		if (role !== "admin" && role !== "auditor") {
			throw new Error(`KIT_ADMIN_TOKENS 角色只能是 admin|auditor，收到：${role}`);
		}
		out.push({ token, role });
	}
	return out;
}

function parseGatewayMode(env: NodeJS.ProcessEnv): ServerConfig["gatewayMode"] {
	const mode = (env.KIT_GATEWAY?.trim() || "auto") as ServerConfig["gatewayMode"];
	if (mode !== "auto" && mode !== "mock" && mode !== "sdk") {
		throw new Error(`KIT_GATEWAY 只能是 auto|mock|sdk，收到：${mode}`);
	}
	return mode;
}

function parseAuthMode(env: NodeJS.ProcessEnv): ServerConfig["authMode"] {
	const mode = env.KIT_AUTH_MODE?.trim() || "member";
	if (mode !== "member" && mode !== "anonymous") throw new Error("KIT_AUTH_MODE 只能是 member|anonymous");
	return mode;
}

function parseBailianCredentials(env: NodeJS.ProcessEnv): BailianCredentials | undefined {
	const apiKey = env.BAILIAN_API_KEY?.trim() || undefined;
	if (!apiKey) return undefined;
	const baseUrl = env.BAILIAN_BASE_URL?.trim() || undefined;
	const workspaceId = env.BAILIAN_WORKSPACE_ID?.trim() || undefined;
	return { apiKey, ...(baseUrl ? { baseUrl } : {}), ...(workspaceId ? { workspaceId } : {}) };
}

function resolveGateway(mode: ServerConfig["gatewayMode"], bailian: BailianCredentials | undefined): "mock" | "sdk" {
	const hasCreds = Boolean(bailian?.apiKey && (bailian.baseUrl || bailian.workspaceId));
	const resolved: "mock" | "sdk" = mode === "auto" ? (hasCreds ? "sdk" : "mock") : mode;
	if (resolved === "sdk" && !hasCreds) {
		throw new Error("KIT_GATEWAY=sdk 需要 BAILIAN_API_KEY 与 (BAILIAN_BASE_URL 或 BAILIAN_WORKSPACE_ID)");
	}
	return resolved;
}

function parseCorsOrigins(env: NodeJS.ProcessEnv): string[] {
	return (env.KIT_CORS_ORIGINS?.trim() || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

/** 体积/速率/超时类配置集中解析：`loadConfig` 只负责组装，避免单函数里堆满 `||` 分支。 */
function parseLimits(env: NodeJS.ProcessEnv) {
	return {
		uploadMaxBytes: Number(env.KIT_UPLOAD_MAX_BYTES || UPLOAD_MAX_BYTES),
		bodyLimitBytes: Number(env.KIT_BODY_LIMIT_BYTES || 1024 * 1024),
		rateLimitRps: Number(env.KIT_RATE_LIMIT_RPS ?? 20),
		rateLimitBurst: Number(env.KIT_RATE_LIMIT_BURST ?? 60),
		fileScanTimeoutMs: Number(env.KIT_FILE_SCAN_TIMEOUT_MS ?? 20_000),
		mockFileScanDelayMs: Number(env.KIT_MOCK_FILE_SCAN_DELAY_MS ?? 0),
		pingIntervalMs: Number(env.KIT_PING_INTERVAL_MS || 15_000),
		pingTimeoutMs: Number(env.KIT_PING_TIMEOUT_MS || 45_000),
	};
}

function parseEvalWorkspaces(env: NodeJS.ProcessEnv): string[] {
	return (env.KIT_EVAL_WORKSPACES ?? "")
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean)
		.map((p) => resolve(p));
}

function parseQuotaDefaultMonthly(env: NodeJS.ProcessEnv): number | undefined {
	const raw = env.KIT_QUOTA_DEFAULT_MONTHLY?.trim();
	if (!raw) return undefined;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < -1) {
		throw new Error(`KIT_QUOTA_DEFAULT_MONTHLY 只能是 >= -1 的整数（-1=不限量），收到：${raw}`);
	}
	return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
	const mode = parseGatewayMode(env);
	const bailian = parseBailianCredentials(env);
	const resolvedGateway = resolveGateway(mode, bailian);
	const dataDir = resolve(env.KIT_DATA_DIR?.trim() || ".data");
	mkdirSync(dataDir, { recursive: true });

	return {
		port: Number(env.PORT?.trim() || 8787),
		dataDir,
		adminToken: env.ADMIN_TOKEN?.trim() || "",
		jwtSecret: env.KIT_JWT_SECRET?.trim() || undefined,
		authMode: parseAuthMode(env),
		corsOrigins: parseCorsOrigins(env),
		gatewayMode: mode,
		resolvedGateway,
		...(bailian ? { bailian } : {}),
		confirmSecret: env.KIT_CONFIRM_SECRET?.trim() || randomBytes(24).toString("hex"),
		publicBaseUrl: (env.KIT_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, ""),
		adminPrincipals: parseAdminPrincipals(env),
		evalWorkspaces: parseEvalWorkspaces(env),
		...(() => {
			const quotaDefaultMonthly = parseQuotaDefaultMonthly(env);
			return quotaDefaultMonthly == null ? {} : { quotaDefaultMonthly };
		})(),
		...parseLimits(env),
	};
}

/** 日志/错误脱敏：任何疑似凭据的串都打码。 */
export function redactSecrets(input: string): string {
	return input
		.replace(/(sk-[A-Za-z0-9_-]{6,})/g, "sk-***")
		.replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1***")
		.replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[A-Za-z0-9._-]{8,}/gi, "$1***");
}
