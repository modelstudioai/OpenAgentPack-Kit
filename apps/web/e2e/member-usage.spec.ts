import {
	type AdminMembersPage,
	type MemberSessionUsage,
	type MemberUsageLimitView,
	type MemberUsageSummary,
	type MemberView,
	type ModelUsagePage,
	PROTOCOL_VERSION,
	SESSION_USAGE_METRICS,
} from "@openagentpack/kit-sdk/protocol";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { openConsoleNavigation } from "./helpers.ts";

const apiBase = "https://member-usage.example/kit";
function summary(count: number, value: number | null): MemberUsageSummary {
	return {
		session_count: count,
		deleted_session_count: count ? 1 : 0,
		metrics: Object.fromEntries(
			SESSION_USAGE_METRICS.map((metric) => [metric, { value, covered_sessions: value === null ? 0 : count }]),
		) as MemberUsageSummary["metrics"],
		agents: count ? ["agent-a", "agent-b"] : [],
		refresh_status: "idle",
		completed_sessions: count,
		refreshed_at: "2026-10-23T01:00:00Z",
	};
}
function member(id: string, name: string, usage: MemberUsageSummary): MemberView {
	return {
		member_id: id,
		username: id,
		display_name: name,
		auth_type: "local",
		status: "active",
		created_at: "2026-10-23T00:00:00Z",
		updated_at: "2026-10-23T00:00:00Z",
		usage_summary: usage,
	};
}

function sessionsPage(url: URL) {
	if (url.searchParams.get("agent_slug") === "agent-b") return { data: [session("Agent B 会话", "agent-b")] };
	if (url.searchParams.get("cursor")) return { data: [session("最后一页的已删除会话", "agent-a", true)] };
	return { data: [session("第一页会话", "agent-a")], next_cursor: "page-2" };
}
function session(id: string, agent: string, deleted = false): MemberSessionUsage {
	return {
		session_id: id,
		member_id: "member-a",
		agent_slug: agent,
		title: id,
		created_at: "2026-10-23T00:00:00Z",
		...(deleted ? { deleted_at: "2026-10-23T02:00:00Z" } : {}),
		usage: { input_tokens: 10, output_tokens: 5 },
		collection_status: "partial",
		captured_at: "2026-10-23T01:00:00Z",
	};
}

function adminContextFixture(url: URL): unknown {
	if (url.pathname.endsWith("/identity")) return { role: "admin", subject: "admin:admin:usage-fixture" };
	if (/\/usage\/(model-usage|tool-usage)$/.test(url.pathname)) {
		return {
			items: [],
			total: 0,
			total_call_count: 0,
			page_no: 1,
			page_size: 20,
			data_updated_at: Date.parse("2026-10-23T01:00:00Z"),
		} satisfies ModelUsagePage;
	}
	if (url.pathname.endsWith("/templates/daily-trend"))
		return { days: 7, from_day: "2026-10-17", to_day: "2026-10-23", since_day: null, data: [] };
	if (url.pathname.endsWith("/usage-limits/policy")) {
		return { limits: { monthly_tokens: null, monthly_active_seconds: null } };
	}
	if (!url.pathname.endsWith("/usage-limit")) return undefined;
	return {
		member_id: url.pathname.split("/").at(-2) ?? "",
		month: "2026-10",
		reset_at: "2026-11-01T00:00:00Z",
		limits: { monthly_tokens: null, monthly_active_seconds: null },
		override: null,
		tokens: { limit: null, used: 0, remaining: null, status: "ok" },
		active_seconds: { limit: null, used: 0, remaining: null, status: "ok" },
		accounting_started_at: "2026-10-26T00:00:00Z",
	} satisfies MemberUsageLimitView;
}

async function bootstrap(
	page: Page,
	consoleUrl: string,
	members: MemberView[],
	handler: (url: URL) => unknown,
	options: {
		tab?: "usage" | "members";
		list?: (url: URL) => Promise<{ status?: number; json: unknown }>;
	} = {},
) {
	const quotaRequests: string[] = [];
	const knownMembers = new Map(members.map((value) => [value.member_id, value]));
	async function listMembers(url: URL) {
		const response = options.list ? await options.list(url) : { json: { data: members } };
		for (const value of (response.json as Partial<AdminMembersPage>).data ?? [])
			knownMembers.set(value.member_id, value);
		return response;
	}
	page.on("request", (request) => {
		if (new URL(request.url()).pathname.includes("/quota")) quotaRequests.push(request.url());
	});
	await page.route(`${apiBase}/api/**`, async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname.endsWith("/config"))
			return route.fulfill({ json: { data: { apiBaseUrl: apiBase, protocolVersion: PROTOCOL_VERSION } } });
		expect(route.request().headers().authorization).toBe("Bearer usage-admin");
		const context = adminContextFixture(url);
		if (context !== undefined) return route.fulfill({ json: { data: context } });
		if (url.pathname.endsWith("/members")) return route.fulfill(await listMembers(url));
		if (/\/members\/[^/]+$/.test(url.pathname))
			return route.fulfill({ json: { data: knownMembers.get(decodeURIComponent(url.pathname.split("/").at(-1)!)) } });
		if (/\/members\/[^/]+\/(usage|sessions)$/.test(url.pathname)) return route.fulfill({ json: handler(url) });
		return route.fulfill({ json: { data: [] } });
	});
	await page.goto(`${consoleUrl}/?api=${encodeURIComponent(apiBase)}`);
	await page.getByPlaceholder("ADMIN_TOKEN").fill("usage-admin");
	await page.getByRole("button", { name: "进入", exact: true }).click();
	const tab = options.tab ?? "usage";
	await openConsoleNavigation(page);
	await page.getByTestId(`${tab}-tab`).click();
	await expect(
		page.getByRole("heading", { name: tab === "usage" ? "Session 用量" : "成员管理", exact: true }),
	).toBeVisible();
	if (tab === "usage") {
		await page.getByText("成员用量", { exact: true }).click();
		await expect(page.getByRole("radio", { name: "成员用量", exact: true })).toBeChecked();
	}
	return quotaRequests;
}

test("Session 用量入口展示全部指标，明细支持 Agent 筛选、分页与刷新", async ({ page }, testInfo) => {
	const total = summary(21, 2100);
	const values = [2100, 1100, 120, 50, 33.5, 90];
	SESSION_USAGE_METRICS.forEach((metric, index) => {
		total.metrics[metric].value = values[index] ?? 0;
	});
	let refreshStarted = false;
	let refreshCalls = 0;
	const quotaRequests = await bootstrap(
		page,
		String(testInfo.config.metadata.consoleUrl ?? "http://localhost:5174"),
		[member("member-a", "统计成员", total)],
		(url) => {
			const filtered = url.searchParams.get("agent_slug") === "agent-b";
			if (url.pathname.endsWith("/sessions")) return sessionsPage(url);
			const data = summary(filtered ? 1 : 21, filtered ? 300 : refreshStarted ? 2200 : 2100);
			if (url.searchParams.get("refresh") === "1") {
				refreshCalls += 1;
				refreshStarted = true;
				data.refresh_status = "refreshing";
			}
			return { data };
		},
	);
	const row = page.getByRole("row", { name: /统计成员/ });
	const labels = ["输入 Token", "输出 Token", "缓存读取 Token", "缓存写入 Token", "执行时长（秒）", "会话时长（秒）"];
	for (const [index, label] of labels.entries()) {
		await expect(page.getByRole("columnheader", { name: label, exact: true })).toBeVisible();
		const cell = row.getByRole("cell").nth(index + 2);
		await expect(cell).toContainText((values[index] ?? 0).toLocaleString("zh-CN"));
		await expect(cell).toContainText("覆盖 21 / 21 个会话");
	}
	await expect(page.getByText(/Credits|加油包|配额策略/)).toHaveCount(0);
	expect(quotaRequests).toEqual([]);
	await row.getByRole("button", { name: "会话明细" }).click();
	await expect(page.getByRole("heading", { name: "统计成员的会话用量" })).toBeVisible();
	await expect(page.getByTestId("usage-input_tokens")).toContainText("2,100");
	await page.getByRole("navigation", { name: "成员会话分页" }).getByRole("button", { name: "下一页" }).click();
	await expect(page.getByRole("region", { name: "会话用量明细", exact: true })).toContainText("已删除（用量保留）");
	await expect(page.getByTestId("usage-input_tokens")).toContainText("2,100");
	await page.getByLabel("Agent 筛选").click();
	await page.getByText("agent-b", { exact: true }).click();
	await expect(page.getByTestId("usage-input_tokens")).toContainText("300");
	await expect(page.getByRole("heading", { name: "Agent B 会话", exact: true })).toBeVisible();
	await expect(page.getByRole("navigation", { name: "成员会话分页" })).toHaveCount(0);
	await page.getByLabel("Agent 筛选").click();
	await page.getByText("全部 Agent", { exact: true }).click();
	await expect(page.getByRole("heading", { name: "第一页会话", exact: true })).toBeVisible();
	await page.getByRole("button", { name: /刷新用量/ }).click();
	await expect(page.getByRole("button", { name: /采集中/ })).toBeVisible();
	await expect(page.getByTestId("usage-input_tokens")).toContainText("2,200");
	await expect(page.getByRole("button", { name: /刷新用量/ })).toBeEnabled();
	expect(refreshCalls).toBe(1);
});

test("Session 用量：空成员为零，未返回与部分覆盖明确标注，手机页面不横向溢出", async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const partial = summary(2, null);
	partial.metrics.input_tokens = { value: 100, covered_sessions: 1 };
	partial.refresh_status = "partial";
	const empty = summary(0, 0);
	await bootstrap(
		page,
		String(testInfo.config.metadata.consoleUrl ?? "http://localhost:5174"),
		[member("member-a", "缺失成员", partial), member("member-empty", "空成员", empty)],
		(url) => {
			if (url.pathname.endsWith("/sessions")) return { data: [] };
			return { data: url.pathname.includes("member-empty") ? empty : partial };
		},
	);
	const missing = page.getByRole("row", { name: /缺失成员/ });
	await expect(missing.getByRole("cell").nth(2)).toContainText("100（部分缺失）");
	await expect(missing.getByRole("cell").nth(2)).toContainText("覆盖 1 / 2 个会话");
	await expect(missing.getByText("待获取", { exact: true })).toHaveCount(5);
	await expect(missing.getByText("覆盖 0 / 2 个会话", { exact: true })).toHaveCount(5);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
		await page.evaluate(() => document.documentElement.clientWidth),
	);
	await missing.getByRole("button", { name: "会话明细" }).click();
	await expect(page.getByTestId("usage-input_tokens")).toContainText("100（部分缺失）");
	await expect(page.getByTestId("usage-input_tokens")).toContainText("覆盖 1 / 2 个会话");
	await expect(page.getByTestId("usage-output_tokens")).toContainText("待获取");
	await expect(page.getByText(/合计可能不完整/)).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
		await page.evaluate(() => document.documentElement.clientWidth),
	);
	await page.getByRole("button", { name: "返回用量列表", exact: true }).click();
	await page
		.getByRole("row", { name: /空成员/ })
		.getByRole("button", { name: "会话明细" })
		.click();
	await expect(page.getByTestId("usage-input_tokens")).toContainText("覆盖 0 / 0 个会话");
	await expect(page.getByTestId("usage-input_tokens").locator("dd").first()).toHaveText("0");
	await expect(page.getByText("该成员开始使用体验页后，将在这里统计会话用量。", { exact: true })).toBeVisible();
});

test("成员列表：刷新失败后保留旧用量，同时显示采集状态和最近成功采集时间", async ({ page }, testInfo) => {
	// 采集失败会保留完整旧快照；覆盖率本身不能说明本次刷新成功。
	const retained = summary(2, 2100);
	retained.refresh_status = "partial";
	const refreshing = summary(1, 100);
	refreshing.refresh_status = "refreshing";
	const failed = summary(1, null);
	failed.refresh_status = "failed";
	delete failed.refreshed_at;
	await bootstrap(
		page,
		String(testInfo.config.metadata.consoleUrl ?? "http://localhost:5174"),
		[
			member("member-retained", "旧快照成员", retained),
			member("member-refreshing", "采集中成员", refreshing),
			member("member-failed", "失败成员", failed),
		],
		() => ({ data: [] }),
		{ tab: "members" },
	);
	await expect(page.getByRole("columnheader", { name: "账号状态", exact: true })).toBeVisible();
	await expect(page.getByRole("columnheader", { name: "用量采集", exact: true })).toBeVisible();
	const retainedRow = page.getByRole("row", { name: /旧快照成员/ });
	await expect(retainedRow.getByRole("cell", { name: "2,100", exact: true })).toHaveCount(2);
	await expect(retainedRow.getByRole("status", { name: "用量采集状态" })).toHaveText("部分统计，可能含旧数据");
	await expect(retainedRow.getByText("最近成功采集：", { exact: false })).toBeVisible();
	await expect(retainedRow.locator(`time[datetime="${retained.refreshed_at}"]`)).toBeVisible();
	await expect(page.getByRole("row", { name: /采集中成员/ }).getByRole("status", { name: "用量采集状态" })).toHaveText(
		"采集中…",
	);
	const failedRow = page.getByRole("row", { name: /失败成员/ });
	await expect(failedRow.getByRole("status", { name: "用量采集状态" })).toHaveText("采集失败");
	await expect(failedRow.getByText("尚未成功采集", { exact: true })).toBeVisible();
});

test("Session 用量列表：加载失败可重试，搜索分页及明细返回保留条件，刷新与空态可达", async ({ page }, testInfo) => {
	let releaseFirst = () => {};
	const firstResponse = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	let requests = 0;
	let refreshed = false;
	let noMembers = false;
	await bootstrap(
		page,
		String(testInfo.config.metadata.consoleUrl ?? "http://localhost:5174"),
		[],
		(url) => (url.pathname.endsWith("/sessions") ? { data: [] } : { data: summary(2, 2100) }),
		{
			list: async (url) => {
				if (++requests === 1) {
					await firstResponse;
					return { status: 503, json: { error: { code: "provider_error", message: "用量列表暂不可用" } } };
				}
				const search = url.searchParams.get("search");
				if (noMembers || search === "不存在的成员") return { json: { data: [] } };
				if (search === "统计" && url.searchParams.get("page_token") === "members-page-2") {
					return { json: { data: [member("member-b", "统计第二页成员", summary(2, refreshed ? 2300 : 2100))] } };
				}
				return {
					json: {
						data: [member("member-a", "统计第一页成员", summary(1, 100))],
						...(search === "统计" ? { next_page_token: "members-page-2" } : {}),
					},
				};
			},
		},
	);
	releaseFirst();
	await expect(page.getByText("用量列表暂不可用", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "重试", exact: true }).click();
	await expect(page.getByRole("row", { name: /统计第一页成员/ })).toBeVisible();

	await page.getByRole("textbox", { name: "用户名或显示名搜索" }).fill("统计");
	await page.getByRole("button", { name: "搜索", exact: true }).click();
	const pagination = page.getByRole("navigation", { name: "用量列表分页" });
	await pagination.getByRole("button", { name: "下一页", exact: true }).click();
	const secondRow = page.getByRole("row", { name: /统计第二页成员/ });
	await expect(secondRow).toContainText("2,100");
	await expect(pagination).toContainText("第 2 页");
	await expect(pagination.getByRole("button", { name: "下一页", exact: true })).toBeDisabled();
	await secondRow.getByRole("button", { name: "会话明细", exact: true }).click();
	await expect(page.getByRole("heading", { name: "统计第二页成员的会话用量" })).toBeVisible();
	await expect(page.getByText("该成员开始使用体验页后，将在这里统计会话用量。", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "返回用量列表", exact: true }).click();
	await expect(page.getByRole("textbox", { name: "用户名或显示名搜索" })).toHaveValue("统计");
	await expect(secondRow).toContainText("2,100");
	await expect(pagination).toContainText("第 2 页");

	refreshed = true;
	await page.getByRole("button", { name: /刷新列表/ }).click();
	await expect(secondRow).toContainText("2,300");
	await expect(pagination).toContainText("第 2 页");
	await pagination.getByRole("button", { name: "上一页", exact: true }).click();
	await expect(page.getByRole("row", { name: /统计第一页成员/ })).toBeVisible();
	await expect(pagination).toContainText("第 1 页");

	await page.getByRole("textbox", { name: "用户名或显示名搜索" }).fill("不存在的成员");
	await page.getByRole("button", { name: "搜索", exact: true }).click();
	await expect(page.getByText(/未找到匹配的成员/)).toBeVisible();
	await expect(pagination).toHaveCount(0);
	noMembers = true;
	await page.getByRole("textbox", { name: "用户名或显示名搜索" }).fill("");
	await page.getByRole("button", { name: "搜索", exact: true }).click();
	await expect(page.getByText("暂无成员用量", { exact: true })).toBeVisible();
});
