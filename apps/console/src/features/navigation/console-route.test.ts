import { describe, expect, it } from "vitest";
import {
	type ConsoleRoute,
	consoleRouteHref,
	consoleRouteTab,
	parseConsoleRoute,
	sameTemplateForm,
} from "./console-route.ts";

const base = "https://console.example.test/?api=https%3A%2F%2Fapi.example.test%2Fprefix&host=desktop#anchor";
const parse = (path: string) => parseConsoleRoute(new URL(path, base));

describe("管理端页面深链", () => {
	it("预设包定位可刷新，切换包需要独立草稿，离开创建页清除定位", () => {
		const route: ConsoleRoute = { page: "template-create", preset: "preset_one" };
		expect(sameTemplateForm(route, { ...route, step: "preview" })).toBe(true);
		expect(sameTemplateForm(route, { ...route, preset: "preset_two" })).toBe(false);
		expect(sameTemplateForm(route, { page: "template-create" })).toBe(false);
		const next = consoleRouteHref({ page: "members" }, new URL(consoleRouteHref(route, base), base).href);
		expect(next).not.toContain("preset=");
		expect(new URL(next, base).searchParams.get("api")).toBe("https://api.example.test/prefix");
	});
	it.each<ConsoleRoute>([
		{ page: "template-create", step: "preview" },
		{ page: "template-create", preset: "preset_one" },
		{ page: "template-list" },
		{ page: "template-detail", id: "模版/?#%", version: 2, tab: "debug" },
		{ page: "template-edit", id: "t1" },
		{ page: "member-create" },
		{ page: "member-usage", id: "m1", from: "usage", limits: "edit" },
		{ page: "operations" },
		{ page: "usage" },
		{ page: "members" },
		{ page: "branding" },
		{ page: "eval", workspace: "/tmp/评测", run: "run-1" },
	])("页面与资源标识可往返解析：%j", (route) => {
		const href = consoleRouteHref(route, base);
		expect(parse(href)).toEqual(route);
		expect(new URL(href, base).searchParams.get("api")).toBe("https://api.example.test/prefix");
		expect(href).toContain("host=desktop");
		expect(href).toContain("#anchor");
	});
	it("切换一级页面清除资源定位，保留后端地址；根地址与非法路径回到管理首页", () => {
		const detail = consoleRouteHref({ page: "template-detail", id: "t1", version: 2 }, base);
		const next = consoleRouteHref({ page: "members" }, new URL(detail, base).href);
		expect(parse(next)).toEqual({ page: "members" });
		expect(next).not.toContain("version");
		for (const path of ["/", "/missing", "/templates/%E0%A4%A", "/sessions", "/sessions/s1/timeline"]) {
			expect(parse(path).page).toBe("template-list");
		}
		for (const version of ["0", "-1", "1.2", "1e2", "Infinity", "9007199254740992"]) {
			expect(parse(`/templates/t1?version=${version}`).version).toBeUndefined();
		}
		expect(consoleRouteTab(parse("/templates/t1/edit"))).toBe("template-list");
		expect(consoleRouteTab(parse("/members/m1/usage?from=usage"))).toBe("usage");
	});
	it.each(["/groups", "/groups/", "/groups/g1", "/groups/%E0%A4%A"])(
		"旧用户组入口回到成员列表并清除资源定位：%s",
		(path) => {
			const legacy = new URL(path, base);
			legacy.searchParams.set("api", "https://api.example.test/prefix");
			legacy.searchParams.set("id", "g1");
			legacy.searchParams.set("page", "groups");
			const route = parseConsoleRoute(legacy);
			expect(route).toEqual({ page: "members" });
			expect(consoleRouteTab(route)).toBe("members");
			const target = new URL(consoleRouteHref(route, legacy.href), base);
			expect(target.pathname).toBe("/members");
			expect(target.searchParams.has("id")).toBe(false);
			expect(target.searchParams.has("page")).toBe(false);
			expect(target.searchParams.get("api")).toBe("https://api.example.test/prefix");
		},
	);
	it.each([
		"/?agent=kit-demo-reviewer",
		"/project",
		"/project/changes",
		"/project/versions",
		"/project/debug",
		"/catalog",
		"/preset-packs/import",
	])("已移除页面的旧入口回到模版列表并清除 Agent 定位：%s", (path) => {
		const legacy = new URL(path, base);
		legacy.searchParams.set("agent", "kit-demo-reviewer");
		legacy.searchParams.set("api", "https://api.example.test/prefix");
		const route = parseConsoleRoute(legacy);
		expect(route).toEqual({ page: "template-list" });
		const target = new URL(consoleRouteHref(route, legacy.href), base);
		expect(target.pathname).toBe("/templates");
		expect(target.searchParams.has("agent")).toBe(false);
		expect(target.searchParams.get("api")).toBe("https://api.example.test/prefix");
	});
});
