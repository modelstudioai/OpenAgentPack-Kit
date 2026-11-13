import type { SessionSummary } from "@openagentpack/kit-sdk/protocol";
import { expect, test } from "./fixtures.ts";
import { openSessionList, scrollSessionDirectoryDown as scrollDown, seedListedAgent } from "./helpers.ts";

function rows(slug: string, count: number): SessionSummary[] {
	return Array.from({ length: count }, (_, i) => ({
		session_id: `recent-${i}`,
		agent_slug: slug,
		title: `最近历史 ${i + 1}`,
		status: "idle",
		created_at: "2026-01-01T00:00:00.000Z",
	}));
}

test("最近：全局每页十条，触底追加去重，切换会话保留已加载页", async ({ page, request, isMobile }) => {
	const prefix = `recent-${Date.now()}`;
	const current = `${prefix}-current`;
	const other = `${prefix}-other`;
	await seedListedAgent(request, current, current);
	await seedListedAgent(request, other, other);
	const created = await page.request.post("/api/kit/sessions", { data: { agent_slug: other, title: "最近历史 20" } });
	expect(created.ok()).toBe(true);
	const { data: detail } = await created.json();
	const sessions = rows(other, 25);
	sessions[19] = { ...sessions[19]!, session_id: detail.session_id };
	const tokens: (string | null)[] = [];
	let release = () => {};
	const second = new Promise<void>((resolve) => {
		release = resolve;
	});
	// 分组查询失败仍可独立使用「最近」，导航从全局结果解析正确的智能体。
	await page.route("**/api/kit/session-agents", (route) =>
		route.fulfill({ status: 503, json: { error: { code: "internal", message: "分组查询失败" } } }),
	);
	await page.route(
		(url) => url.pathname === "/api/kit/sessions",
		async (route) => {
			const query = new URL(route.request().url()).searchParams;
			expect(query.has("agent_slug")).toBe(false);
			expect(query.get("limit")).toBe("10");
			expect(query.get("include_archived")).toBe("false");
			const token = query.get("page_token");
			tokens.push(token);
			if (token === "10") await second;
			const offset = Number(token ?? 0);
			await route.fulfill({
				json: {
					data: offset === 20 ? sessions.slice(19) : sessions.slice(offset, offset + 10),
					next_page_token: offset < 20 ? String(offset + 10) : null,
				},
			});
		},
	);
	await page.goto(`/?agent=${current}`);
	await expect(page.getByLabel("消息输入")).toBeVisible();
	await openSessionList(page);
	const recent = page.getByRole("navigation", { name: "最近会话", exact: true });
	const history = recent.getByRole("button", { name: /^最近历史 \d+$/ });
	await expect(history).toHaveCount(10);
	await expect(page.getByText("历史会话加载失败，请重试。", { exact: true })).toBeVisible();
	expect(tokens).toEqual([null]);
	await scrollDown(page, isMobile);
	await expect(page.getByText("正在加载更多会话…", { exact: true })).toBeVisible();
	await scrollDown(page, isMobile);
	await scrollDown(page, isMobile);
	expect(tokens).toEqual([null, "10"]);
	release();
	await expect(history).toHaveCount(20);
	await scrollDown(page, isMobile);
	await expect(history).toHaveCount(25);
	await expect(page.getByTestId("recent-sessions-load-more")).toHaveCount(0);
	const opened = page.waitForResponse(
		(response) => new URL(response.url()).pathname === `/api/kit/sessions/${detail.session_id}`,
	);
	await recent.getByRole("button", { name: "最近历史 20", exact: true }).click();
	expect((await opened).ok()).toBe(true);
	await expect(page).toHaveURL(new RegExp(`agent=${other}&session=${detail.session_id}`));
	await openSessionList(page);
	await expect(history).toHaveCount(25);
	await expect(page.getByTestId("recent-sessions-load-more")).toHaveCount(0);
	await scrollDown(page, isMobile);
	await page.waitForTimeout(200);
	expect(tokens).toEqual([null, "10", "20"]);
});

test("最近：翻页失败保留十条，重试原游标恢复", async ({ page, request, isMobile }) => {
	const slug = `recent-retry-${Date.now()}`;
	await seedListedAgent(request, slug, slug);
	const sessions = rows(slug, 20);
	let fail = true;
	const tokens: (string | null)[] = [];
	await page.route("**/api/kit/session-agents", (route) => route.fulfill({ json: { data: [slug] } }));
	await page.route(
		(url) => url.pathname === "/api/kit/sessions",
		(route) => {
			const query = new URL(route.request().url()).searchParams;
			if (query.has("agent_slug")) return route.fulfill({ json: { data: sessions, next_page_token: null } });
			const token = query.get("page_token");
			tokens.push(token);
			if (token && fail)
				return route.fulfill({ status: 503, json: { error: { code: "internal", message: "分页查询失败" } } });
			return route.fulfill({
				json: {
					data: sessions.slice(token ? 10 : 0, token ? 20 : 10),
					next_page_token: token ? null : "10",
				},
			});
		},
	);
	await page.goto(`/?agent=${slug}`);
	await expect(page.getByLabel("消息输入")).toBeVisible();
	await openSessionList(page);
	const history = page
		.getByRole("navigation", { name: "最近会话", exact: true })
		.getByRole("button", { name: /^最近历史 \d+$/ });
	await expect(history).toHaveCount(10);
	await scrollDown(page, isMobile);
	const error = page.getByRole("alert").filter({ hasText: "更多会话加载失败，请重试。" });
	await expect(error).toBeVisible();
	await expect(history).toHaveCount(10);
	await scrollDown(page, isMobile);
	await page.waitForTimeout(200);
	expect(tokens).toEqual([null, "10"]);
	fail = false;
	await error.getByRole("button", { name: "重试", exact: true }).click();
	await expect(history).toHaveCount(20);
	await expect(error).toHaveCount(0);
	expect(tokens).toEqual([null, "10", "10"]);
});

// 同一会话会出现在两个分区；选中态必须跟随真实点击来源，跨页面和抽屉重挂载后仍只高亮一处。
test("最近：从广场打开后保持来源高亮，分组与抽屉切换不串台", async ({ page, request, isMobile }) => {
	const slug = `recent-selection-${Date.now()}`;
	const title = `${slug} history`;
	await seedListedAgent(request, slug, slug);
	const created = await page.request.post("/api/kit/sessions", { data: { agent_slug: slug, title } });
	expect(created.ok()).toBe(true);
	const { data: session } = await created.json();
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Agent 广场", exact: true })).toBeVisible();
	await openSessionList(page);
	const groupToggle = page.getByTestId(`sidebar-group-${slug}`);
	const groupRow = page.getByTestId(`group-sessions-${slug}`).getByRole("button", { name: title, exact: true });
	const recentRow = page
		.getByRole("navigation", { name: "最近会话", exact: true })
		.getByRole("button", { name: title, exact: true });
	await expect(groupToggle).toHaveAttribute("aria-expanded", "false");
	await expect(recentRow).toBeVisible();
	await recentRow.click();
	await expect(page).toHaveURL(new RegExp(`agent=${slug}&session=${session.session_id}`));
	await expect(page.getByRole("main")).toContainText(title);
	await openSessionList(page);
	await expect(recentRow).toHaveAttribute("aria-current", "true");
	await expect(groupToggle).toHaveAttribute("aria-expanded", "false");
	await groupToggle.click();
	await expect(groupRow).toBeVisible();
	await expect(groupRow).not.toHaveAttribute("aria-current", "true");
	await expect(recentRow).toHaveAttribute("aria-current", "true");

	// 会话地址相同也能切换来源；手机关闭并重新打开抽屉后仍保留选中位置。
	await groupRow.click();
	await openSessionList(page);
	await expect(groupRow).toHaveAttribute("aria-current", "true");
	await expect(recentRow).not.toHaveAttribute("aria-current", "true");
	await recentRow.click();
	await openSessionList(page);
	await expect(recentRow).toHaveAttribute("aria-current", "true");
	await expect(page.getByTestId("experience-sidebar").locator('[aria-current="true"]')).toHaveCount(1);

	await page.setViewportSize(isMobile ? { width: 1280, height: 900 } : { width: 390, height: 844 });
	await openSessionList(page);
	await expect(recentRow).toHaveAttribute("aria-current", "true");
	await expect(page.getByTestId("experience-sidebar").locator('[aria-current="true"]')).toHaveCount(1);
	// 刷新不保留临时点击来源，深链仍按既有行为定位到智能体分组。
	await page.reload();
	await expect(page.getByRole("main")).toContainText(title);
	await openSessionList(page);
	await expect(groupRow).toHaveAttribute("aria-current", "true");
	await expect(recentRow).not.toHaveAttribute("aria-current", "true");
});
