/** 终端用户身份：只由 server 的 IdentityProvider 解析；浏览器不持有该内部结构。 */
export interface Identity {
	subjectId: string;
	displayName?: string;
	tier?: string;
	metadata?: Record<string, unknown>;
}

export interface IdentityContext {
	/** 原始请求头或注入的凭据头。 */
	headers: Record<string, string>;
	/** 客户端提示（cookie / UA / 注入对象） */
	cookies?: Record<string, string>;
}

export interface IdentityProvider {
	readonly name: string;
	resolve(context: IdentityContext): Promise<Identity | null>;
}

export const ANONYMOUS_COOKIE = "kit_subject";
