export const CONSOLE_TABS = [
	"template-create",
	"template-list",
	"operations",
	"usage",
	"members",
	"branding",
	"eval",
] as const;
export type ConsoleTab = (typeof CONSOLE_TABS)[number];
const PAGES = [...CONSOLE_TABS, "template-detail", "template-edit", "member-create", "member-usage"] as const;
export type ConsolePage = (typeof PAGES)[number];

/** 只保存可重读的定位信息；草稿、凭据与确认令牌不进入 URL/history.state。 */
export interface ConsoleRoute {
	page: ConsolePage;
	id?: string;
	tab?: "debug" | "information" | "usage";
	version?: number;
	step?: "preview";
	preset?: string;
	from?: "usage";
	limits?: "edit";
	workspace?: string;
	run?: string;
}
const ROUTE_KEYS = [
	"page",
	"id",
	"tab",
	"version",
	"agent",
	"step",
	"preset",
	"from",
	"workspace",
	"run",
	"limits",
] as const;

const PATHS: Record<ConsoleTab, string> = {
	"template-create": "/templates/new",
	"template-list": "/templates",
	operations: "/operations",
	usage: "/usage",
	members: "/members",
	branding: "/branding",
	eval: "/eval",
};

const DETAIL_PATHS: { pattern: RegExp; page: ConsolePage; tab?: "debug" | "usage" }[] = [
	{ pattern: /^\/templates\/([^/]+)\/edit$/, page: "template-edit" },
	{ pattern: /^\/templates\/([^/]+)\/debug$/, page: "template-detail", tab: "debug" },
	{ pattern: /^\/templates\/([^/]+)\/usage$/, page: "template-detail", tab: "usage" },
	{ pattern: /^\/templates\/([^/]+)$/, page: "template-detail" },
	{ pattern: /^\/members\/([^/]+)\/usage$/, page: "member-usage" },
];

function matchPath(path: string): ConsoleRoute {
	const page = CONSOLE_TABS.find((value) => PATHS[value] === path);
	if (page) return { page };
	if (path === "/members/new") return { page: "member-create" };
	if (path === "/groups" || path.startsWith("/groups/")) return { page: "members" };
	for (const entry of DETAIL_PATHS) {
		const match = entry.pattern.exec(path);
		if (!match) continue;
		const id = decodeURIComponent(match[1]!);
		return { page: entry.page, id, ...(entry.tab ? { tab: entry.tab } : {}) };
	}
	return { page: "template-list" };
}

function readTemplateVersion(params: URLSearchParams): number | undefined {
	const raw = params.get("version") ?? "";
	const version = Number(raw);
	return /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(version) ? version : undefined;
}

function readRouteQuery(route: ConsoleRoute, params: URLSearchParams): ConsoleRoute {
	switch (route.page) {
		case "template-detail":
			return { ...route, version: readTemplateVersion(params) };
		case "template-create":
			return {
				...route,
				step: params.get("step") === "preview" ? "preview" : undefined,
				preset: params.get("preset") || undefined,
			};
		case "template-edit":
			return { ...route, step: params.get("step") === "preview" ? "preview" : undefined };
		case "member-usage":
			return {
				...route,
				from: params.get("from") === "usage" ? "usage" : undefined,
				limits: params.get("limits") === "edit" ? "edit" : undefined,
			};
		case "eval":
			return { ...route, workspace: params.get("workspace") || undefined, run: params.get("run") || undefined };
		default:
			return route;
	}
}

export function parseConsoleRoute(location: Pick<Location, "pathname" | "search">): ConsoleRoute {
	try {
		return readRouteQuery(matchPath(location.pathname.replace(/\/+$/, "")), new URLSearchParams(location.search));
	} catch {
		return { page: "template-list" };
	}
}

function detailPath(prefix: string, id: string | undefined, suffix = "") {
	return id ? `${prefix}/${encodeURIComponent(id)}${suffix}` : prefix;
}

function routePath(route: ConsoleRoute): string {
	switch (route.page) {
		case "template-detail":
			return detailPath(
				"/templates",
				route.id,
				route.tab === "debug" ? "/debug" : route.tab === "usage" ? "/usage" : "",
			);
		case "template-edit":
			return detailPath("/templates", route.id, "/edit");
		case "member-create":
			return "/members/new";
		case "member-usage":
			return detailPath("/members", route.id, "/usage");
		default:
			return PATHS[route.page];
	}
}

export function consoleRouteHref(route: ConsoleRoute, base = window.location.href): string {
	const url = new URL(base);
	url.pathname = routePath(route);
	for (const key of ROUTE_KEYS) url.searchParams.delete(key);
	for (const key of ["version", "step", "preset", "from", "workspace", "run", "limits"] as const) {
		if (route[key] !== undefined) url.searchParams.set(key, String(route[key]));
	}
	return `${url.pathname}${url.search}${url.hash}`;
}

export function consoleRouteTab(route: ConsoleRoute): ConsoleTab {
	if (route.page === "template-detail" || route.page === "template-edit") return "template-list";
	if (route.page === "member-usage") return route.from === "usage" ? "usage" : "members";
	if (route.page === "member-create") return "members";
	return route.page;
}

export function sameTemplateForm(a: ConsoleRoute, b: ConsoleRoute) {
	return (
		(a.page === "template-create" || a.page === "template-edit") &&
		a.page === b.page &&
		a.id === b.id &&
		a.preset === b.preset
	);
}
