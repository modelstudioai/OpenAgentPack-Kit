import { createHash, randomBytes } from "node:crypto";
import {
	KitError,
	type MemberAuthView,
	type MemberLoginRequest,
	MemberLoginRequestSchema,
	type MemberLoginResult,
} from "@openagentpack/kit-sdk/protocol";
import type { AuditLog } from "../store/audit.ts";
import type { MemberSessionRecord, MemberSessionStore } from "../store/member-sessions.ts";
import type { MemberStore } from "../store/members.ts";
import { verifyPassword } from "./passwords.ts";
import { createRateLimiter } from "./rate-limit.ts";

export const MEMBER_TOKEN_PREFIX = "kit_member_";
export const MEMBER_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^kit_member_[A-Za-z0-9_-]{43}$/;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const unauthorized = () => new KitError("unauthorized", "登录状态无效或已过期，请重新登录");

export interface AuthStreamBinding {
	signal: AbortSignal;
	assertActive(): void;
	close(): void;
}

export function createMemberAuthService({
	members,
	sessions,
	audit,
}: {
	members: MemberStore;
	sessions: MemberSessionStore;
	audit: AuditLog;
}) {
	const accountLimiter = createRateLimiter({ rps: 1 / 60, burst: 10 });
	const globalLimiter = createRateLimiter({ rps: 5, burst: 50 });
	const streams = new Map<string, Set<AbortController>>();
	let checkingPasswords = 0;

	function failLimited(seconds: number): never {
		throw new KitError("rate_limited", "登录尝试过于频繁，请稍后重试", {
			retryable: true,
			details: { retry_after: seconds },
		});
	}

	function assertActive(record: MemberSessionRecord) {
		const current = sessions.find(record.token_hash);
		const member = current && members.findById(current.member_id);
		if (!current || Date.parse(current.expires_at) <= Date.now() || !member || member.status !== "active") {
			throw unauthorized();
		}
		return { current, member };
	}

	return {
		async login(input: MemberLoginRequest): Promise<MemberLoginResult> {
			const parsed = MemberLoginRequestSchema.safeParse(input);
			if (!parsed.success) throw new KitError("invalid_request", "请输入有效的用户名和密码");
			const { username, password } = parsed.data;
			const global = globalLimiter.take("login");
			if (!global.ok) failLimited(global.retryAfterSeconds);
			const account = accountLimiter.take(digest(username));
			if (!account.ok) failLimited(account.retryAfterSeconds);
			// 未鉴权入口不能无限排队消耗 scrypt 线程池和内存；匿名 cookie 不参与此限流。
			if (checkingPasswords >= 4) failLimited(1);
			checkingPasswords += 1;
			let credential: ReturnType<MemberStore["findCredentials"]>;
			let valid: boolean;
			try {
				credential = members.findCredentials(username);
				valid = await verifyPassword(password, credential?.passwordHash);
			} finally {
				checkingPasswords -= 1;
			}
			if (!valid || !credential || credential.member.status !== "active") {
				throw new KitError("unauthorized", "用户名或密码错误");
			}
			const accessToken = `${MEMBER_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
			const now = new Date();
			const expiresAt = new Date(now.getTime() + MEMBER_SESSION_TTL_MS).toISOString();
			sessions.create({
				token_hash: digest(accessToken),
				member_id: credential.member.member_id,
				created_at: now.toISOString(),
				expires_at: expiresAt,
			});
			audit.append({
				subject: credential.member.member_id,
				action: "member.auth.login",
				target: credential.member.member_id,
			});
			return { access_token: accessToken, token_type: "Bearer", expires_at: expiresAt, member: credential.member };
		},
		resolve(token: string): { view: MemberAuthView; session: MemberSessionRecord } {
			if (!TOKEN_PATTERN.test(token)) throw unauthorized();
			const session = sessions.find(digest(token));
			if (!session) throw unauthorized();
			const { member } = assertActive(session);
			return {
				session,
				view: {
					identity: { subjectId: member.member_id, displayName: member.display_name, tier: "member" },
					member,
					expires_at: session.expires_at,
				},
			};
		},
		logout(token: string | undefined) {
			if (!token || !TOKEN_PATTERN.test(token)) return;
			const tokenHash = digest(token);
			const session = sessions.find(tokenHash);
			sessions.revoke(tokenHash);
			for (const controller of streams.get(tokenHash) ?? []) controller.abort(unauthorized());
			streams.delete(tokenHash);
			if (session)
				audit.append({ subject: session.member_id, action: "member.auth.logout", target: session.member_id });
		},
		/** 每条 SSE 订阅独立取消；撤销一个登录态不会中断成员另一设备或云端 Agent。 */
		bindStream(record: MemberSessionRecord): AuthStreamBinding {
			assertActive(record);
			const controller = new AbortController();
			const owned = streams.get(record.token_hash) ?? new Set<AbortController>();
			owned.add(controller);
			streams.set(record.token_hash, owned);
			const timer = setTimeout(
				() => controller.abort(unauthorized()),
				Math.max(0, Date.parse(record.expires_at) - Date.now()),
			);
			timer.unref();
			return {
				signal: controller.signal,
				assertActive: () => assertActive(record),
				close() {
					clearTimeout(timer);
					owned.delete(controller);
					if (!owned.size) streams.delete(record.token_hash);
				},
			};
		},
	};
}

export type MemberAuthService = ReturnType<typeof createMemberAuthService>;
