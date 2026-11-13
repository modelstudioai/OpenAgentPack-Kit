import { useCallback, useEffect, useState } from "react";

/**
 * 查询参数视图路由（不引 path router，支持静态托管）。
 *
 * 解析规则与既有深链语义兼容（E2E 的 `/?agent=e2e-agent` 必须继续直达 chat）：
 * 1. 有 `agent` 参数 → chat；`session` 参数可选，指向具体会话，刷新/分享直达该会话；
 * 2. `view=usage` → usage；`view=new` → new（新建聊天选择页）；
 * 3. 其余（含空 search）→ plaza（默认首页）。
 *
 * `history.pushState` 不触发 popstate，所以 navigate 之后自己广播一个自定义事件，
 * 让同时存在的多个 useRoute 实例（导航条 / 各视图）一起同步。
 */
export type ViewId = "plaza" | "new" | "chat" | "usage";

export interface RouteTarget {
	view?: ViewId;
	/** chat 深链的 agent slug；留在 chat 时缺省沿用当前值，传 null 显式清除。 */
	agent?: string | null;
	/** chat 深链的会话 id；留在 chat 时缺省沿用当前值，传 null 显式清除。 */
	session?: string | null;
}

export interface RouteState {
	view: ViewId;
	agentSlug: string | null;
	sessionId: string | null;
}

export type NavigateFn = (next: RouteTarget, options?: { replace?: boolean }) => void;

const ROUTE_EVENT = "kit:route-change";

export function parseRoute(search: string): RouteState {
	const params = new URLSearchParams(search);
	const agent = params.get("agent");
	if (agent) return { view: "chat", agentSlug: agent, sessionId: params.get("session") };
	if (params.get("view") === "usage") return { view: "usage", agentSlug: null, sessionId: null };
	if (params.get("view") === "new") return { view: "new", agentSlug: null, sessionId: null };
	return { view: "plaza", agentSlug: null, sessionId: null };
}

/**
 * 生成目标 search：只接管 `agent` / `session` / `view` 三个键，其余参数（如宿主联调用的 `api=`）原样保留。
 * `view: "chat"` 未显式给 agent/session 时沿用当前值，避免产出「view=chat 却没有 agent」这种
 * 按规则会解析回 plaza 的 URL；`session` 让刷新/分享直达当前会话，显式传 null 清除（新会话）。
 */
export function routeSearch(next: RouteTarget, base: string = window.location.search): string {
	const params = new URLSearchParams(base);
	const current = params.get("agent");
	const currentSession = params.get("session");
	params.delete("agent");
	params.delete("view");
	params.delete("session");
	const agent = next.agent !== undefined ? next.agent : next.view === "chat" ? current : null;
	if (agent) params.set("agent", agent);
	else if (next.view === "usage" || next.view === "new") params.set("view", next.view);
	const session = next.session !== undefined ? next.session : next.view === "chat" ? currentSession : null;
	if (session) params.set("session", session);
	const qs = params.toString();
	return qs ? `?${qs}` : "";
}

/** 给 `<a href>` 用的真实 URL：与 navigate 的目标一致，保留中键/新标签打开的能力。 */
export function routeHref(next: RouteTarget): string {
	return `${window.location.pathname}${routeSearch(next)}`;
}

export function useRoute(): RouteState & { navigate: NavigateFn } {
	const [route, setRoute] = useState<RouteState>(() => parseRoute(window.location.search));

	useEffect(() => {
		const sync = () => setRoute(parseRoute(window.location.search));
		window.addEventListener("popstate", sync);
		window.addEventListener(ROUTE_EVENT, sync);
		return () => {
			window.removeEventListener("popstate", sync);
			window.removeEventListener(ROUTE_EVENT, sync);
		};
	}, []);

	const navigate = useCallback<NavigateFn>((next, options) => {
		const url = `${window.location.pathname}${routeSearch(next)}`;
		if (options?.replace) window.history.replaceState(null, "", url);
		else window.history.pushState(null, "", url);
		window.dispatchEvent(new Event(ROUTE_EVENT));
	}, []);

	return { view: route.view, agentSlug: route.agentSlug, sessionId: route.sessionId, navigate };
}
