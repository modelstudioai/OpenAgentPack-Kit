import { describe, expect, it } from "vitest";
import { parseRoute, routeSearch } from "./use-route.ts";

describe("查询参数路由", () => {
	it("agent+session 深链直达具体会话，缺 session 保持新会话语义", () => {
		expect(parseRoute("?agent=demo&session=s1")).toEqual({ view: "chat", agentSlug: "demo", sessionId: "s1" });
		expect(parseRoute("?agent=demo")).toEqual({ view: "chat", agentSlug: "demo", sessionId: null });
		expect(parseRoute("?view=usage")).toEqual({ view: "usage", agentSlug: null, sessionId: null });
		// session 不能脱离 agent 单独成立：无 agent 时仍回落 plaza
		expect(parseRoute("?session=s1")).toEqual({ view: "plaza", agentSlug: null, sessionId: null });
	});

	it("切会话写回 URL 且保留宿主参数，新会话显式清除 session", () => {
		expect(routeSearch({ view: "chat", session: "s1" }, "?agent=demo")).toBe("?agent=demo&session=s1");
		expect(routeSearch({ view: "chat", session: "s2" }, "?api=x&agent=demo&session=s1")).toBe(
			"?api=x&agent=demo&session=s2",
		);
		expect(routeSearch({ view: "chat", session: null }, "?agent=demo&session=s1")).toBe("?agent=demo");
		// 未显式给 session 时留在 chat 沿用当前会话，避免 URL 静默丢会话
		expect(routeSearch({ view: "chat" }, "?agent=demo&session=s1")).toBe("?agent=demo&session=s1");
	});

	it("离开 chat 视图时 agent 与 session 一并清除", () => {
		expect(routeSearch({ view: "usage" }, "?agent=demo&session=s1")).toBe("?view=usage");
		expect(routeSearch({ view: "plaza" }, "?agent=demo&session=s1")).toBe("");
	});
});
