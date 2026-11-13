import type { SessionSummary } from "@openagentpack/kit-sdk/protocol";
import { expect, test } from "./fixtures.ts";
import { openSessionList, scrollSessionDirectoryDown as scrollDown, seedListedAgent } from "./helpers.ts";

function sessionsFor(slug: string, count: number): SessionSummary[] {
	return Array.from({ length: count }, (_, index) => ({
		session_id: `${slug}-${index}`,
		agent_slug: slug,
		title: `分组历史 ${index + 1}`,
		status: "idle",
		created_at: "2026-01-01T00:00:00.000Z",
	}));
}

test("分组：展开才读取十条，触底分页且独立缓存，较早会话可直达", async ({ page, request, isMobile }) => {
	const prefix = `groups-${Date.now()}`;
	const large = `${prefix}-large`;
	const small = `${prefix}-small`;
	await seedListedAgent(request, large, large);
	await seedListedAgent(request, small, small);
	const created = await page.request.post("/api/kit/sessions", { data: { agent_slug: large, title: "分组历史 25" } });
	expect(created.ok()).toBe(true);
	const { data: detail } = await created.json();
	const rows = sessionsFor(large, 25);
	rows[24] = { ...rows[24]!, session_id: detail.session_id };
	const tokens: (string | null)[] = [];
	const smallTokens: (string | null)[] = [];
	let release = () => {};
	const second = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/kit/session-agents", (route) => route.fulfill({ json: { data: [large, small] } }));
	await page.route(
		(url) => url.pathname === "/api/kit/sessions",
		async (route) => {
			const query = new URL(route.request().url()).searchParams;
			if (query.get("q")) {
				expect(query.get("limit")).toBe("50");
				expect(query.get("include_archived")).toBe("false");
				return route.fulfill({
					json: {
						data: rows.filter((row) => row.title?.includes(query.get("q") as string)),
						next_page_token: null,
					},
				});
			}
			expect(query.get("limit")).toBe("10");
			expect(query.get("include_archived")).toBe("false");
			const slug = query.get("agent_slug");
			if (!slug) return route.fulfill({ json: { data: [], next_page_token: null } });
			const token = query.get("page_token");
			if (slug === small) {
				smallTokens.push(token);
				return route.fulfill({ json: { data: sessionsFor(small, 1), next_page_token: null } });
			}
			expect(slug).toBe(large);
			tokens.push(token);
			if (token === "10") await second;
			const offset = Number(token ?? 0);
			return route.fulfill({
				json: {
					data: offset === 20 ? rows.slice(19) : rows.slice(offset, offset + 10),
					next_page_token: offset < 20 ? String(offset + 10) : null,
				},
			});
		},
	);
	await page.goto(`/?agent=${large}`);
	await expect(page.getByLabel("消息输入")).toBeVisible();
	await openSessionList(page);
	const group = page.getByTestId(`group-sessions-${large}`);
	const history = group.getByRole("button", { name: /^分组历史 \d+$/ });
	await expect(page.getByTestId(`sidebar-group-${small}`)).toBeVisible();
	expect(tokens).toEqual([]);
	expect(smallTokens).toEqual([]);
	await page.getByTestId("sidebar-new-chat").click();
	await expect(page.getByTestId(`new-recent-${small}`)).toBeVisible();
	await page.getByTestId(`new-recent-${large}`).click();
	await expect(page.getByLabel("消息输入")).toBeVisible();
	await openSessionList(page);
	expect(tokens).toEqual([]);
	expect(smallTokens).toEqual([]);
	await page.getByTestId(`sidebar-group-${large}`).click();
	await expect(history).toHaveCount(10);
	await expect(page.getByTestId(`sidebar-group-${large}`)).toContainText("10+");
	expect(tokens).toEqual([null]);
	await scrollDown(page, isMobile);
	await expect(group.getByText("正在加载更多会话…", { exact: true })).toBeVisible();
	await scrollDown(page, isMobile);
	expect(tokens).toEqual([null, "10"]);
	expect(smallTokens).toEqual([]);
	release();
	await expect(history).toHaveCount(20);
	await scrollDown(page, isMobile);
	await expect(history).toHaveCount(25);
	await expect(group.getByTestId(`group-sessions-${large}-load-more`)).toHaveCount(0);
	await page.getByTestId(`sidebar-group-${large}`).click();
	await page.getByTestId(`sidebar-group-${large}`).click();
	await expect(history).toHaveCount(25);
	await page.getByTestId(`sidebar-group-${small}`).click();
	await expect(
		page.getByTestId(`group-sessions-${small}`).getByRole("button", { name: "分组历史 1", exact: true }),
	).toBeVisible();
	expect(smallTokens).toEqual([null]);
	await expect(history).toHaveCount(25);
	const opened = page.waitForResponse(
		(response) => new URL(response.url()).pathname === `/api/kit/sessions/${detail.session_id}`,
	);
	await group.getByRole("button", { name: "分组历史 25", exact: true }).click();
	expect((await opened).ok()).toBe(true);
	await expect(page).toHaveURL(new RegExp(`agent=${large}&session=${detail.session_id}`));
	await openSessionList(page);
	await expect(history).toHaveCount(25);
	expect(tokens).toEqual([null, "10", "20"]);
	await page.getByTestId("sidebar-search").fill("分组历史 25");
	const results = page.getByTestId("session-search-results");
	await expect(results.getByRole("button", { name: "分组历史 25", exact: true })).toBeVisible();
	await expect(results.getByRole("button", { name: /^分组历史 \d+$/ })).toHaveCount(1);
	await page.reload();
	await expect(page.getByLabel("消息输入")).toBeVisible();
	await expect(page.getByRole("main")).toContainText("分组历史 25");
	await openSessionList(page);
	await expect(history).toHaveCount(10);
	expect(tokens).toEqual([null, "10", "20", null]);
});

test("搜索：后端检索未展开分组的全部会话，分页与清空恢复目录", async ({ page, request }) => {
	const slug = "search-" + Date.now();
	const other = slug + "-other";
	await seedListedAgent(request, slug, slug);
	await seedListedAgent(request, other, other);
	const created = await page.request.post("/api/kit/sessions", {
		data: { agent_slug: slug, title: "跨页目标会话" },
	});
	expect(created.ok()).toBe(true);
	const { data: detail } = await created.json();
	const rows: SessionSummary[] = [
		{
			session_id: detail.session_id,
			agent_slug: slug,
			title: "跨页目标会话",
			status: "idle",
			created_at: "2026-01-01T00:00:00.000Z",
		},
		...Array.from({ length: 14 }, (_, index) => ({
			session_id: slug + "-fake-" + index,
			agent_slug: index < 9 ? slug : other,
			title: "跨页历史 " + (index + 1),
			status: "idle",
			created_at: "2026-01-01T00:00:00.000Z",
		})),
	];
	const searchTokens: (string | null)[] = [];
	await page.route("**/api/kit/session-agents", (route) => route.fulfill({ json: { data: [slug, other] } }));
	await page.route(
		(url) => url.pathname === "/api/kit/sessions",
		(route) => {
			const query = new URL(route.request().url()).searchParams;
			if (!query.get("q")) return route.fulfill({ json: { data: [], next_page_token: null } });
			expect(query.get("q")).toBe("跨页");
			expect(query.get("limit")).toBe("50");
			expect(query.get("include_archived")).toBe("false");
			const token = query.get("page_token");
			searchTokens.push(token);
			const offset = Number(token ?? 0);
			return route.fulfill({
				json: {
					data: rows.slice(offset, offset + 10),
					next_page_token: offset === 0 ? "10" : null,
				},
			});
		},
	);
	await page.goto("/?agent=" + slug);
	await expect(page.getByLabel("消息输入")).toBeVisible();
	await openSessionList(page);
	// 分组未展开，普通目录没有发起任何会话查询；搜索结果仍能命中未加载的历史会话。
	await expect(page.getByTestId("group-sessions-" + slug).getByRole("button")).toHaveCount(0);
	await page.getByTestId("sidebar-search").fill("跨页");
	const results = page.getByTestId("session-search-results");
	await expect(results.getByTestId("search-agent-" + slug)).toContainText(slug);
	await expect(results.getByRole("button", { name: "跨页目标会话", exact: true })).toBeVisible();
	await results.getByTestId("search-agent-" + slug).click();
	await page.waitForTimeout(500);
	await expect(results.locator("div.mt-3.grid").first()).toHaveCSS("grid-template-rows", "0px");
	await results.getByTestId("search-agent-" + slug).click();
	await expect(results.getByRole("button", { name: "跨页目标会话", exact: true })).toBeVisible();
	await expect(results.getByRole("button", { name: /^跨页历史 \d+$/ })).toHaveCount(9);
	await page.getByTestId("session-search-results-load-more").click();
	await expect(results.getByRole("button", { name: /^跨页历史 \d+$/ })).toHaveCount(14);
	await expect(results.getByTestId("search-agent-" + other)).toContainText(other);
	expect(searchTokens).toEqual([null, "10"]);
	await results.getByRole("button", { name: "跨页目标会话", exact: true }).click();
	await expect(page).toHaveURL(new RegExp("session=" + detail.session_id));
	await openSessionList(page);
	await page.getByTestId("sidebar-search").fill("");
	await expect(page.getByTestId("session-search-results")).toHaveCount(0);
	await expect(page.getByTestId("recent-sessions")).toBeVisible();
});

test("搜索：从首页点击未加载进目录的结果，直达所属智能体的会话", async ({ page, request }) => {
	const slug = "search-nav-" + Date.now();
	await seedListedAgent(request, slug, slug);
	const created = await page.request.post("/api/kit/sessions", { data: { agent_slug: slug, title: "导航目标会话" } });
	expect(created.ok()).toBe(true);
	const { data: detail } = await created.json();
	const row: SessionSummary = {
		session_id: detail.session_id,
		agent_slug: slug,
		title: "导航目标会话",
		status: "idle",
		created_at: "2026-01-01T00:00:00.000Z",
	};
	await page.route("**/api/kit/session-agents", (route) => route.fulfill({ json: { data: [slug] } }));
	await page.route(
		(url) => url.pathname === "/api/kit/sessions",
		(route) => {
			const query = new URL(route.request().url()).searchParams;
			if (!query.get("q")) return route.fulfill({ json: { data: [], next_page_token: null } });
			return route.fulfill({ json: { data: [row], next_page_token: null } });
		},
	);
	// 首页无 agent 参数：该会话不在任何已加载目录集合里，导航 slug 只能来自点击回传的摘要。
	await page.goto("/");
	await openSessionList(page);
	await expect(page.getByTestId("sidebar-search")).toBeVisible();
	await page.getByTestId("sidebar-search").fill("导航");
	const results = page.getByTestId("session-search-results");
	await expect(results.getByTestId("search-agent-" + slug)).toContainText(slug);
	await results.getByRole("button", { name: "导航目标会话", exact: true }).click();
	await expect(page).toHaveURL(new RegExp("agent=" + slug + "&session=" + detail.session_id));
	await expect(page.getByLabel("消息输入")).toBeVisible();
});

test("状态：切到新会话后，后台回合完成会清除 loading 标记", async ({ page, request }) => {
	const slug = `status-${Date.now()}`;
	await seedListedAgent(request, slug, slug);
	await page.goto("/?agent=" + slug);
	await page.getByLabel("消息输入").fill("多智能体任务");
	await page.getByRole("button", { name: "发送", exact: true }).click();
	await expect(page).toHaveURL(/session=/);
	await openSessionList(page);
	await page.getByTestId("sidebar-group-" + slug).click();
	await expect(
		page
			.getByTestId("group-sessions-" + slug)
			.getByRole("button")
			.first(),
	).toBeVisible();
	const startedRow = page
		.getByTestId("group-sessions-" + slug)
		.getByRole("button", { name: "多智能体任务", exact: true })
		.locator("..");
	await expect(startedRow.getByRole("img", { name: "生成中" })).toBeVisible();
	await page.getByTestId("sidebar-new-chat").click();
	await page
		.getByTestId("plaza-card-" + slug)
		.getByRole("button", { name: "开始体验", exact: true })
		.click();
	await page.getByLabel("消息输入").fill("hi");
	await page.getByRole("button", { name: "发送", exact: true }).click();
	await expect(page).toHaveURL(/session=/);
	await openSessionList(page);
	const runningRow = page
		.getByTestId("group-sessions-" + slug)
		.getByRole("button", { name: "多智能体任务", exact: true })
		.locator("..");
	await expect(runningRow.getByRole("img", { name: "生成中" })).toBeVisible();
	// 新会话很快结束，原会话仍在后台运行；轮询合并状态后不应残留任何 loading 标记。
	await expect(page.getByRole("img", { name: "生成中" })).toHaveCount(0, { timeout: 15_000 });
});

test("状态：当前会话完成但目录摘要滞后时，轮询会清除 loading", async ({ page, request }) => {
	const slug = `active-status-${Date.now()}`;
	await seedListedAgent(request, slug, slug);
	let sessionId: string | null = null;
	let stale = false;
	await page.route(
		(url) => url.pathname === "/api/kit/sessions",
		async (route) => {
			if (stale && sessionId)
				return route.fulfill({
					json: {
						data: [
							{
								session_id: sessionId,
								agent_slug: slug,
								title: "hi",
								status: "running",
								created_at: "2026-01-01T00:00:00.000Z",
							},
						],
						next_page_token: null,
					},
				});
			return route.fulfill({ response: await route.fetch() });
		},
	);
	await page.goto("/?agent=" + slug);
	await page.getByLabel("消息输入").fill("hi");
	await page.getByRole("button", { name: "发送", exact: true }).click();
	await expect(page).toHaveURL(/session=/);
	sessionId = new URL(page.url()).searchParams.get("session");
	stale = true;
	await expect(page.getByText("空闲", { exact: true })).toBeVisible({ timeout: 15_000 });
	// 离开再回到该会话会清掉「刚完成」对勾；此时若目录摘要仍是 running，应显示 loading。
	await openSessionList(page);
	await page.getByTestId("sidebar-new-chat").click();
	await openSessionList(page);
	const groupHead = page.getByTestId("sidebar-group-" + slug);
	if ((await groupHead.getAttribute("aria-expanded")) === "false") await groupHead.click();
	await page
		.getByTestId("group-sessions-" + slug)
		.getByRole("button", { name: "hi", exact: true })
		.click();
	await expect(page).toHaveURL(new RegExp("session=" + sessionId));
	await expect(page.getByText("空闲", { exact: true })).toBeVisible({ timeout: 15_000 });
	await openSessionList(page);
	const row = page
		.getByTestId("group-sessions-" + slug)
		.getByRole("button", { name: "hi", exact: true })
		.locator("..");
	await expect(row.getByRole("img", { name: "生成中" })).toBeVisible();
	stale = false;
	await expect(page.getByRole("img", { name: "生成中" })).toHaveCount(0, { timeout: 15_000 });
});

test("状态：已加载会话开始运行后切走，行内 loading 仍保留", async ({ page, request }) => {
	const slug = `kept-running-${Date.now()}`;
	await seedListedAgent(request, slug, slug);
	const created = await page.request.post("/api/kit/sessions", {
		data: { agent_slug: slug, title: "已有会话" },
	});
	expect(created.ok()).toBe(true);
	const { data: detail } = await created.json();
	await page.goto(`/?agent=${slug}&session=${detail.session_id}`);
	await expect(page.getByLabel("消息输入")).toBeVisible();
	await openSessionList(page);
	const groupHead = page.getByTestId("sidebar-group-" + slug);
	if ((await groupHead.getAttribute("aria-expanded")) === "false") await groupHead.click();
	const row = page
		.getByTestId("group-sessions-" + slug)
		.getByRole("button", { name: "已有会话", exact: true })
		.locator("..");
	await expect(row.getByRole("img", { name: "生成中" })).toHaveCount(0);
	if ((page.viewportSize()?.width ?? 1280) < 768) await page.keyboard.press("Escape");
	await page.getByLabel("消息输入").fill("多智能体任务");
	await page.getByRole("button", { name: "发送", exact: true }).click();
	await openSessionList(page);
	await expect(row.getByRole("img", { name: "生成中" })).toBeVisible();
	await page.getByTestId("sidebar-new-chat").click();
	await openSessionList(page);
	if ((await groupHead.getAttribute("aria-expanded")) === "false") await groupHead.click();
	// 切走后该行不再是当前会话，必须继续用缓存中的 running 状态展示 loading。
	await expect(row.getByRole("img", { name: "生成中" })).toBeVisible();
	await expect(page.getByRole("img", { name: "生成中" })).toHaveCount(0, { timeout: 15_000 });
});

test("分组：翻页失败保留十条，其他组可用，原游标重试恢复", async ({ page, request, isMobile }) => {
	const prefix = `groups-retry-${Date.now()}`;
	const failed = `${prefix}-failed`;
	const other = `${prefix}-other`;
	await seedListedAgent(request, failed, failed);
	await seedListedAgent(request, other, other);
	const rows = sessionsFor(failed, 20);
	const tokens: (string | null)[] = [];
	let fail = true;
	await page.route("**/api/kit/session-agents", (route) => route.fulfill({ json: { data: [failed, other] } }));
	await page.route(
		(url) => url.pathname === "/api/kit/sessions",
		(route) => {
			const query = new URL(route.request().url()).searchParams;
			const slug = query.get("agent_slug");
			if (!slug) return route.fulfill({ json: { data: [], next_page_token: null } });
			if (slug === other) return route.fulfill({ json: { data: sessionsFor(other, 1), next_page_token: null } });
			const token = query.get("page_token");
			tokens.push(token);
			if (token && fail)
				return route.fulfill({ status: 503, json: { error: { code: "internal", message: "分组翻页失败" } } });
			return route.fulfill({
				json: {
					data: rows.slice(token ? 10 : 0, token ? 20 : 10),
					next_page_token: token ? null : "10",
				},
			});
		},
	);
	await page.goto(`/?agent=${failed}`);
	await expect(page.getByLabel("消息输入")).toBeVisible();
	await openSessionList(page);
	await page.getByTestId(`sidebar-group-${failed}`).click();
	const group = page.getByTestId(`group-sessions-${failed}`);
	const history = group.getByRole("button", { name: /^分组历史 \d+$/ });
	await expect(history).toHaveCount(10);
	await scrollDown(page, isMobile);
	const error = group.getByRole("alert");
	await expect(error).toContainText("更多会话加载失败，请重试。");
	await expect(history).toHaveCount(10);
	await scrollDown(page, isMobile);
	await page.waitForTimeout(200);
	expect(tokens).toEqual([null, "10"]);
	await page.getByTestId(`sidebar-group-${other}`).click();
	await expect(
		page.getByTestId(`group-sessions-${other}`).getByRole("button", { name: "分组历史 1", exact: true }),
	).toBeVisible();
	fail = false;
	await error.getByRole("button", { name: "重试", exact: true }).click();
	await expect(history).toHaveCount(20);
	await expect(error).toHaveCount(0);
	expect(tokens).toEqual([null, "10", "10"]);
});

test("分区隔离：从「最近」打开会话，不在「智能体」分组里展开或选中", async ({ page, request }) => {
	const slug = `recent-scope-${Date.now()}`;
	await seedListedAgent(request, slug, slug);
	const created = await page.request.post("/api/kit/sessions", { data: { agent_slug: slug, title: "分区隔离会话" } });
	expect(created.ok()).toBe(true);
	const { data: detail } = await created.json();
	const row: SessionSummary = {
		session_id: detail.session_id,
		agent_slug: slug,
		title: "分区隔离会话",
		status: "idle",
		created_at: "2026-01-01T00:00:00.000Z",
	};
	await page.route("**/api/kit/session-agents", (route) => route.fulfill({ json: { data: [slug] } }));
	await page.route(
		(url) => url.pathname === "/api/kit/sessions",
		(route) => route.fulfill({ json: { data: [row], next_page_token: null } }),
	);
	await page.goto(`/?agent=${slug}`);
	await expect(page.getByLabel("消息输入")).toBeVisible();
	await openSessionList(page);
	const groupHead = page.getByTestId(`sidebar-group-${slug}`);
	await expect(groupHead).toHaveAttribute("aria-expanded", "false");
	const recent = page.getByRole("navigation", { name: "最近会话", exact: true });
	const recentRow = recent.getByRole("button", { name: "分区隔离会话", exact: true });
	const opened = page.waitForResponse(
		(response) => new URL(response.url()).pathname === `/api/kit/sessions/${detail.session_id}`,
	);
	await recentRow.click();
	expect((await opened).ok()).toBe(true);
	await expect(page).toHaveURL(new RegExp(`session=${detail.session_id}`));
	await openSessionList(page);
	// 高亮留在点击来源「最近」；分组既不自动展开，也不会把同一会话行标成当前。
	await expect(recent.getByRole("button", { name: "分区隔离会话", exact: true })).toHaveAttribute(
		"aria-current",
		"true",
	);
	await expect(groupHead).toHaveAttribute("aria-expanded", "false");
	await expect(page.getByTestId(`group-sessions-${slug}`).locator('[aria-current="true"]')).toHaveCount(0);
});

test("分组：智能体目录失败提示重试，恢复后展开加载", async ({ page, request }) => {
	const slug = `groups-index-retry-${Date.now()}`;
	await seedListedAgent(request, slug, slug);
	let fail = true;
	await page.route("**/api/kit/session-agents", (route) =>
		fail
			? route.fulfill({ status: 503, json: { error: { code: "internal", message: "目录查询失败" } } })
			: route.fulfill({ json: { data: [slug] } }),
	);
	await page.route(
		(url) => url.pathname === "/api/kit/sessions",
		(route) =>
			route.fulfill({
				json: {
					data: new URL(route.request().url()).searchParams.has("agent_slug") ? sessionsFor(slug, 1) : [],
					next_page_token: null,
				},
			}),
	);
	await page.goto(`/?agent=${slug}`);
	await expect(page.getByLabel("消息输入")).toBeVisible();
	await openSessionList(page);
	const error = page.getByRole("alert").filter({ hasText: "历史会话加载失败，请重试。" });
	await expect(error).toBeVisible();
	await expect(page.getByText("还没有会话记录", { exact: true })).toHaveCount(0);
	fail = false;
	await error.getByRole("button", { name: "重试", exact: true }).click();
	await page.getByTestId(`sidebar-group-${slug}`).click();
	await expect(
		page.getByTestId(`group-sessions-${slug}`).getByRole("button", { name: "分组历史 1", exact: true }),
	).toBeVisible();
	await expect(error).toHaveCount(0);
});
