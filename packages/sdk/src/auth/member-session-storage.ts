import type { MemberSessionStorage, StoredMemberSession } from "./member-auth.ts";

/** 凭据属于完整服务地址；路径前缀不同的 Kit Server 不能共享登录态。 */
export function normalizeMemberApiBaseUrl(value: string, origin: string): string {
	let url: URL;
	try {
		url = new URL(value, origin);
	} catch {
		throw new Error("服务地址无效，请检查地址后重试");
	}
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
		throw new Error("服务地址须为不含凭据、查询参数或片段的 HTTP(S) 地址");
	}
	return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function isStoredSession(value: unknown): value is StoredMemberSession {
	if (!value || typeof value !== "object") return false;
	const session = value as Partial<StoredMemberSession>;
	return (
		typeof session.access_token === "string" &&
		session.access_token.length > 0 &&
		typeof session.expires_at === "string" &&
		Number.isFinite(Date.parse(session.expires_at))
	);
}

/** 密码不持久化；仅保存当前标签页恢复登录所需的令牌和到期时间。 */
export function createMemberSessionStorage(
	baseUrl: string,
	getStorage: () => {
		getItem(key: string): string | null;
		setItem(key: string, value: string): void;
		removeItem(key: string): void;
	},
): MemberSessionStorage {
	const key = `kit_member_session:${normalizeMemberApiBaseUrl(baseUrl, baseUrl)}`;
	const save = (session: StoredMemberSession | null) => {
		try {
			if (session) {
				getStorage().setItem(
					key,
					JSON.stringify({ access_token: session.access_token, expires_at: session.expires_at }),
				);
			} else getStorage().removeItem(key);
		} catch {
			throw new Error("无法保存登录状态，请允许浏览器使用会话存储后重试");
		}
	};
	return {
		load() {
			let raw: string | null;
			try {
				raw = getStorage().getItem(key);
			} catch {
				throw new Error("无法读取登录状态，请允许浏览器使用会话存储后重试");
			}
			if (!raw) return null;
			try {
				const parsed: unknown = JSON.parse(raw);
				if (isStoredSession(parsed)) return { access_token: parsed.access_token, expires_at: parsed.expires_at };
			} catch {
				// 损坏的记录不作为登录凭据，且不把内容放进错误消息。
			}
			save(null);
			return null;
		},
		save,
	};
}
