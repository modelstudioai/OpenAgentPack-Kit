import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { KitError } from "@openagentpack/kit-sdk/protocol";
import type { Context } from "hono";
import type { AdminIdentity, AdminRole, AppEnv } from "../app-env.ts";
import type { ServerConfig } from "../config.ts";
import { ANONYMOUS_COOKIE, type Identity } from "../identity/types.ts";
import { MEMBER_TOKEN_PREFIX } from "./member-auth.ts";

function b64url(input: Buffer | string): string {
	return Buffer.from(input).toString("base64url");
}

function parseCookies(header: string | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	for (const part of (header ?? "").split(";")) {
		const idx = part.indexOf("=");
		if (idx > 0) {
			try {
				out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
			} catch {
				// 畸形旧匿名 cookie 不影响登录；按未设置处理。
			}
		}
	}
	return out;
}

/** HS256 JWT 校验（v1 内置实现；接企业 SSO 时替换 IdentityProvider）。 */
function identityFromClaims(payload: Record<string, unknown>): { identity: Identity; expiresAt?: string } | null {
	if (payload.exp !== undefined && (typeof payload.exp !== "number" || !Number.isFinite(payload.exp))) return null;
	if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) return null;
	if (typeof payload.sub !== "string" || !payload.sub || payload.sub.startsWith("member_")) return null;
	return {
		identity: {
			subjectId: payload.sub,
			...(typeof payload.name === "string" ? { displayName: payload.name } : {}),
			...(typeof payload.tier === "string" ? { tier: payload.tier } : {}),
		},
		...(typeof payload.exp === "number" ? { expiresAt: new Date(payload.exp * 1000).toISOString() } : {}),
	};
}

function verifyJwtClaims(token: string, secret: string): { identity: Identity; expiresAt?: string } | null {
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	const [headerB64, payloadB64, sigB64] = parts;
	if (!headerB64 || !payloadB64 || !sigB64) return null;
	const expected = createHmac("sha256", secret).update(`${headerB64}.${payloadB64}`).digest("base64url");
	const given = Buffer.from(sigB64, "base64url");
	const want = Buffer.from(expected, "base64url");
	if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
	try {
		const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")) as Record<string, unknown>;
		if (header.alg !== "HS256") return null;
		const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Record<string, unknown>;
		return identityFromClaims(payload);
	} catch {
		return null;
	}
}

export function verifyJwt(token: string, secret: string): Identity | null {
	return verifyJwtClaims(token, secret)?.identity ?? null;
}

export function signJwt(payload: Record<string, unknown>, secret: string, ttlSeconds = 3600): string {
	const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const body = b64url(
		JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
	);
	const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
	return `${header}.${body}.${sig}`;
}

/**
 * 终端用户身份解析：本地登录 / 可信 JWT；默认拒绝未登录请求。
 * 匿名 cookie 仅用于显式演示模式，不能命中成员命名空间；无效 Bearer 不降级。
 */
export function resolveIdentity(c: Context<AppEnv>, config: ServerConfig): Identity {
	const auth = c.req.header("authorization");
	if (auth) {
		if (!auth.startsWith("Bearer ")) throw new KitError("unauthorized", "登录状态无效或已过期，请重新登录");
		const token = auth.slice(7);
		if (token.startsWith(MEMBER_TOKEN_PREFIX)) {
			const resolved = c.get("services").memberAuth.resolve(token);
			c.set("memberSession", resolved.session);
			c.set("authExpiresAt", resolved.session.expires_at);
			return resolved.view.identity;
		}
		const jwt = config.jwtSecret ? verifyJwtClaims(token, config.jwtSecret) : null;
		if (jwt) {
			c.set("authExpiresAt", jwt.expiresAt);
			return jwt.identity;
		}
		throw new KitError("unauthorized", "登录状态无效或已过期，请重新登录");
	}
	if (config.authMode !== "anonymous") throw new KitError("unauthorized", "请先登录");
	const cookies = parseCookies(c.req.header("cookie"));
	let subjectId = cookies[ANONYMOUS_COOKIE];
	if (!subjectId || subjectId.startsWith("member_") || subjectId.startsWith("kit_member_") || subjectId.length > 256) {
		subjectId = `anon_${randomBytes(9).toString("base64url")}`;
		c.header("Set-Cookie", `${ANONYMOUS_COOKIE}=${subjectId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
	}
	return { subjectId, displayName: "访客", tier: "anonymous" };
}

function principalId(token: string, role: AdminRole): string {
	return `admin:${role}:${createHash("sha256").update(token).digest("hex").slice(0, 8)}`;
}

function bearerOf(c: Context<AppEnv>): string {
	const auth = c.req.header("authorization");
	if (!auth?.startsWith("Bearer ")) throw new KitError("unauthorized", "缺少管理端令牌");
	return auth.slice(7);
}

/**
 * 管理端身份：多令牌 + 角色（`ADMIN_TOKEN` 恒为 admin，`KIT_ADMIN_TOKENS` 可追加 auditor）。
 * 常量时间比较；命中后只暴露指纹，令牌本身不进上下文、不进审计、不进日志。
 * 接企业 SSO/RBAC 时替换本函数即可。
 */
export function resolveAdminIdentity(c: Context<AppEnv>, config: ServerConfig): AdminIdentity {
	if (config.adminPrincipals.length === 0) {
		throw new KitError("unauthorized", "服务端未配置 ADMIN_TOKEN / KIT_ADMIN_TOKENS");
	}
	const given = Buffer.from(bearerOf(c));
	for (const principal of config.adminPrincipals) {
		const want = Buffer.from(principal.token);
		if (given.length === want.length && timingSafeEqual(given, want)) {
			return { subject: principalId(principal.token, principal.role), role: principal.role };
		}
	}
	throw new KitError("forbidden", "管理端令牌无效");
}

/** 路由内取管理端身份：中间件（app.ts）已解析并做过角色闸门，这里优先复用上下文。 */
export function requireAdmin(c: Context<AppEnv>, config: ServerConfig): AdminIdentity {
	return c.get("admin") ?? resolveAdminIdentity(c, config);
}

/**
 * 写操作闸门：auditor 是**只读**角色（看转写、看运营数据、导出），不能改 agent、不能放量、
 * 不能执行任何破坏性动作。中间件已按 method 统一拦截，这里给需要显式声明的路由做纵深防御。
 */
export function requireAdminWrite(c: Context<AppEnv>, config: ServerConfig): AdminIdentity {
	const identity = requireAdmin(c, config);
	if (identity.role !== "admin") throw new KitError("forbidden", "auditor 是只读角色，不能执行写操作");
	return identity;
}
