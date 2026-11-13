import { KitError } from "@openagentpack/kit-sdk/protocol";
import type { MemberSessionRecord } from "../store/member-sessions.ts";
import type { AuthStreamBinding, MemberAuthService } from "./member-auth.ts";

/** 本地登录可主动撤销；兼容 JWT 也在自身 exp 到期后结束长连接。 */
export function createAuthStreamGuard(
	auth: MemberAuthService,
	session?: MemberSessionRecord,
	expiresAt?: string,
): AuthStreamBinding {
	if (session) return auth.bindStream(session);
	const controller = new AbortController();
	const expires = expiresAt ? Date.parse(expiresAt) : undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	function expire() {
		if (expires === undefined) return;
		const remaining = expires - Date.now();
		if (remaining <= 0) controller.abort(new KitError("unauthorized", "登录已过期，请重新登录"));
		else {
			timer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
			timer.unref();
		}
	}
	expire();
	return {
		signal: controller.signal,
		assertActive() {
			if (expires !== undefined && expires <= Date.now()) throw new KitError("unauthorized", "登录已过期，请重新登录");
		},
		close: () => clearTimeout(timer),
	};
}
