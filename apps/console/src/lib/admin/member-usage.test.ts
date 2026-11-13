import {
	type MemberSessionUsage,
	type MemberUsageSummary,
	SESSION_USAGE_METRICS,
} from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "./client.ts";
import { createMemberUsageController } from "./member-usage.ts";

function summary(value: number, count = 21, status: MemberUsageSummary["refresh_status"] = "idle"): MemberUsageSummary {
	return {
		session_count: count,
		deleted_session_count: 1,
		metrics: Object.fromEntries(
			SESSION_USAGE_METRICS.map((key) => [key, { value, covered_sessions: count }]),
		) as MemberUsageSummary["metrics"],
		agents: ["agent/a", "agent-b"],
		refresh_status: status,
		completed_sessions: count,
	};
}
function session(id: string): MemberSessionUsage {
	return {
		session_id: id,
		member_id: "member one",
		agent_slug: "agent/a",
		title: id,
		created_at: "2026-10-23T00:00:00Z",
		usage: { input_tokens: 1 },
		collection_status: "complete",
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("成员用量查询编排", () => {
	afterEach(() => vi.useRealTimers());
	it("翻页只改变明细，不以当前页重算合计；切换 Agent 重置游标且两端采用同一筛选", async () => {
		const urls: URL[] = [];
		const client = createAdminClient({
			baseUrl: "https://backend.example/kit",
			fetchImpl: async (input) => {
				const url = new URL(String(input));
				urls.push(url);
				if (url.pathname.endsWith("/usage"))
					return Response.json({ data: summary(url.searchParams.has("agent_slug") ? 500 : 9000) });
				return Response.json({
					data: [session(url.searchParams.get("cursor") ? "last" : "first")],
					...(url.searchParams.has("cursor") ? {} : { next_cursor: "page:2" }),
				});
			},
		});
		const controller = createMemberUsageController(client, "member one");
		await controller.start();
		expect(controller.getSnapshot().summary?.metrics.input_tokens.value).toBe(9000);
		controller.next();
		await vi.waitFor(() => expect(controller.getSnapshot().sessions[0]?.session_id).toBe("last"));
		expect(controller.getSnapshot().summary?.metrics.input_tokens.value).toBe(9000);
		expect(controller.getSnapshot().page).toBe(2);
		controller.setAgent("agent/a");
		await vi.waitFor(() => expect(controller.getSnapshot().summary?.metrics.input_tokens.value).toBe(500));
		expect(controller.getSnapshot()).toMatchObject({ page: 1, agentSlug: "agent/a", agents: ["agent/a", "agent-b"] });
		for (const url of urls.slice(-2)) {
			expect(url.pathname).toContain("/kit/api/admin/members/member%20one/");
			expect(url.searchParams.get("agent_slug")).toBe("agent/a");
			expect(url.searchParams.has("cursor")).toBe(false);
		}
		controller.dispose();
	});
	it("翻页失败不复用旧页的下一页游标；重试与前后翻页保持明细和页码一致", async () => {
		const requestedPages: number[] = [];
		let failPage: number | undefined;
		const client = createAdminClient({
			baseUrl: "https://backend.example",
			fetchImpl: async (input) => {
				const url = new URL(String(input));
				if (url.pathname.endsWith("/usage")) return Response.json({ data: summary(9000, 41) });
				const page = Number(url.searchParams.get("cursor")?.split(":")[1] ?? 1);
				requestedPages.push(page);
				if (page === failPage) throw new Error("分页暂不可用");
				return Response.json({
					data: [session(`page-${page}`)],
					...(page < 3 ? { next_cursor: `page:${page + 1}` } : {}),
				});
			},
		});
		const controller = createMemberUsageController(client, "member one");
		await controller.start();
		const expectPage = (page: number, hasNext: boolean) =>
			expect(controller.getSnapshot()).toMatchObject({
				page,
				hasNext,
				loading: false,
				error: null,
				sessions: [{ session_id: `page-${page}` }],
				summary: { metrics: { input_tokens: { value: 9000 } } },
			});
		expectPage(1, true);
		failPage = 2;
		controller.next();
		await vi.waitFor(() =>
			expect(controller.getSnapshot()).toMatchObject({
				page: 2,
				loading: false,
				error: "分页暂不可用",
				sessions: [],
				hasNext: false,
			}),
		);
		controller.next();
		expect(requestedPages).toEqual([1, 2]);
		expect(controller.getSnapshot().page).toBe(2);
		failPage = undefined;
		await controller.start();
		expectPage(2, true);
		controller.next();
		await vi.waitFor(() => expectPage(3, false));
		controller.previous();
		await vi.waitFor(() => expectPage(2, true));
		failPage = 1;
		controller.previous();
		await vi.waitFor(() =>
			expect(controller.getSnapshot()).toMatchObject({
				page: 1,
				loading: false,
				error: "分页暂不可用",
				sessions: [],
				hasNext: false,
			}),
		);
		controller.next();
		expect(requestedPages).toEqual([1, 2, 2, 3, 2, 1]);
		expect(controller.getSnapshot().page).toBe(1);
		failPage = undefined;
		await controller.start();
		expectPage(1, true);
		controller.next();
		await vi.waitFor(() => expectPage(2, true));
		expect(requestedPages).toEqual([1, 2, 2, 3, 2, 1, 1, 2]);
		controller.dispose();
	});
	it("刷新触发采集仅一次；轮询更新快照并在完成和卸载时停止", async () => {
		vi.useFakeTimers();
		const queries: URL[] = [];
		let collecting = false;
		const client = createAdminClient({
			baseUrl: "https://backend.example",
			fetchImpl: async (input) => {
				const url = new URL(String(input));
				queries.push(url);
				if (url.pathname.endsWith("/sessions")) return Response.json({ data: [session("first")] });
				if (url.searchParams.get("refresh") === "1") {
					collecting = true;
					return Response.json({ data: summary(100, 1, "refreshing") });
				}
				return Response.json({ data: summary(collecting ? 200 : 100, 1) });
			},
		});
		const controller = createMemberUsageController(client, "member one");
		await controller.start();
		await controller.refresh();
		expect(controller.getSnapshot().summary?.refresh_status).toBe("refreshing");
		await vi.advanceTimersByTimeAsync(2_000);
		expect(controller.getSnapshot().summary?.metrics.input_tokens.value).toBe(200);
		expect(queries.filter((url) => url.searchParams.get("refresh") === "1")).toHaveLength(1);
		const completedRequests = queries.length;
		await vi.advanceTimersByTimeAsync(10_000);
		expect(queries).toHaveLength(completedRequests);
		await controller.refresh();
		controller.dispose();
		const disposedRequests = queries.length;
		await vi.advanceTimersByTimeAsync(10_000);
		expect(queries).toHaveLength(disposedRequests);
	});
	it("旧筛选的迟到结果无法污染新筛选；失败保留已有统计供重试", async () => {
		const old = deferred<Response>();
		let reject = false;
		const client = createAdminClient({
			baseUrl: "https://backend.example",
			fetchImpl: async (input) => {
				const url = new URL(String(input));
				if (reject) throw new Error("网络暂不可用");
				if (url.pathname.endsWith("/sessions")) return Response.json({ data: [session("filtered")] });
				if (!url.searchParams.has("agent_slug")) return old.promise;
				return Response.json({ data: summary(300, 1) });
			},
		});
		const controller = createMemberUsageController(client, "member one");
		const first = controller.start();
		controller.setAgent("agent-b");
		await vi.waitFor(() => expect(controller.getSnapshot().summary?.metrics.input_tokens.value).toBe(300));
		old.resolve(Response.json({ data: summary(9000) }));
		await first;
		expect(controller.getSnapshot().summary?.metrics.input_tokens.value).toBe(300);
		reject = true;
		await controller.refresh();
		expect(controller.getSnapshot()).toMatchObject({ error: "网络暂不可用", summary: { session_count: 1 } });
		reject = false;
		await controller.start();
		expect(controller.getSnapshot().error).toBeNull();
		controller.dispose();
	});
});
