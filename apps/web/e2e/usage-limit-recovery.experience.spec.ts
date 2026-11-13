import { fileURLToPath } from "node:url";
import type { MemberUsageLimitView, QuotaRequestView, QuotaView } from "@openagentpack/kit-sdk/protocol";
import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { seedListedAgent } from "./helpers.ts";

// 即使浏览器运行在其他时区，用户端仍固定展示北京时间。
test.use({ timezoneId: "America/Los_Angeles" });

function limitView(): MemberUsageLimitView {
	return {
		member_id: "member-limits",
		month: "2026-10",
		reset_at: "2026-11-01T00:00:00Z",
		limits: { monthly_tokens: 1000, monthly_active_seconds: 60, daily_tokens: 100, daily_active_seconds: null },
		override: null,
		tokens: { limit: 1000, used: 200, remaining: 800, status: "ok" },
		active_seconds: { limit: 60, used: 5.5, remaining: 54.5, status: "ok" },
		day_state: {
			day: "2026-10-26",
			reset_at: "2026-10-27T00:00:00Z",
			tokens: { limit: 100, used: 20, remaining: 80, status: "ok" },
			active_seconds: { limit: null, used: 5.5, remaining: null, status: "ok" },
		},
		accounting_started_at: "2026-10-26T00:00:00Z",
		refreshed_at: "2026-10-26T01:00:00Z",
		daily: Array.from({ length: 371 }, (_, index) => ({
			day: new Date(Date.UTC(2026, 9, 26) - (370 - index) * 86_400_000).toISOString().slice(0, 10),
			tokens: index === 370 ? 20 : 0,
			active_seconds: index === 370 ? 5.5 : 0,
		})),
	};
}

async function expectMetric(card: Locator, label: string, value: string) {
	await expect(card.getByText(label, { exact: true }).locator("..").locator("dd")).toHaveText(value);
}

// 此处使用默认 anonymous mock server，并替换额度响应验证浏览器分流；真实成员受理规则由专用配置验证。
test("每日 Token：日额度已达限而月额度可用，刷新失败保留展示，次日状态恢复", async ({ page }, info) => {
	let current = limitView();
	current.day_state.tokens = { limit: 100, used: 120, remaining: -20, status: "exceeded" };
	current.refreshed_at = "2026-10-26T20:30:45Z";
	current.daily.at(-1)!.tokens = 120;
	let fail = false;
	await page.route(
		(url) => url.pathname === "/api/kit/usage-limits",
		(route) =>
			fail
				? route.fulfill({ status: 503, json: { error: { code: "provider_error", message: "额度采集暂不可用" } } })
				: route.fulfill({ json: { data: current } }),
	);
	await page.goto("/?view=usage");
	const daily = page.getByTestId("limit-daily-tokens");
	const monthly = page.getByTestId("limit-tokens");
	await expect(daily.getByRole("heading", { name: "每日 Token 用量", exact: true })).toBeVisible();
	await expectMetric(daily, "今日已用", "120 Token");
	await expectMetric(daily, "每日上限", "100 Token");
	await expectMetric(daily, "剩余额度", "0 Token");
	await expect(daily.getByRole("status")).toHaveText("已达限额");
	await expect(daily).toContainText("2026-10-26 08:00:00 起 · 2026-10-27 08:00:00 重置");
	await expect(page.getByTestId("member-usage-limits")).toContainText("2026-11-01 08:00:00 重置");
	await expect(page.getByTestId("member-usage-limits")).toContainText("最近采集：2026-10-27 04:30:45");
	await expect(page.getByTestId("member-usage-limits")).not.toContainText("UTC");
	await expect(page.getByTestId("member-usage-limits")).not.toContainText("北京时间");
	await expect(monthly.getByRole("status")).toHaveText("可继续使用");
	await expectMetric(monthly, "本月已用", "200 Token");
	await expectMetric(monthly, "月度上限", "1K Token");
	await expect(page.getByTestId("limit-active_seconds")).toContainText("5.5 秒");
	await expect(page.getByText(/不回填历史用量/)).toBeVisible();
	await expect(page.getByText(/Credits|去申请/)).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
		await page.evaluate(() => document.documentElement.clientWidth),
	);
	await page.getByTestId("member-usage-limits").screenshot({
		path: fileURLToPath(new URL(`../../../.scratch/daily-token-usage/${info.project.name}.png`, import.meta.url)),
	});
	fail = true;
	await page.getByRole("button", { name: "刷新用量", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("额度采集暂不可用");
	await expectMetric(daily, "今日已用", "120 Token");
	await expect(daily.getByRole("status")).toHaveText("已达限额");
	await expectMetric(monthly, "本月已用", "200 Token");
	await expect(page.getByText(/Credits|去申请/)).toHaveCount(0);
	fail = false;
	current = limitView();
	current.day_state.day = "2026-10-27";
	current.day_state.reset_at = "2026-10-28T00:00:00Z";
	await page.getByRole("button", { name: "刷新用量", exact: true }).click();
	await expectMetric(daily, "今日已用", "20 Token");
	await expectMetric(daily, "剩余额度", "80 Token");
	await expect(daily.getByRole("status")).toHaveText("可继续使用");
	await expect(daily).toContainText("2026-10-27 08:00:00 起 · 2026-10-28 08:00:00 重置");
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("每日 Token：不限量、零上限和用量待确认分别展示", async ({ page }) => {
	const current = limitView();
	current.limits.daily_tokens = null;
	current.day_state.tokens = { limit: null, used: 20, remaining: null, status: "ok" };
	await page.route(
		(url) => url.pathname === "/api/kit/usage-limits",
		(route) => route.fulfill({ json: { data: current } }),
	);
	await page.goto("/?view=usage");
	const daily = page.getByTestId("limit-daily-tokens");
	await expectMetric(daily, "今日已用", "20 Token");
	await expectMetric(daily, "每日上限", "不限量");
	await expectMetric(daily, "剩余额度", "不限量");
	current.limits.daily_tokens = 0;
	current.day_state.tokens = { limit: 0, used: 0, remaining: 0, status: "exceeded" };
	await page.getByRole("button", { name: "刷新用量", exact: true }).click();
	await expectMetric(daily, "每日上限", "0 Token");
	await expectMetric(daily, "今日已用", "0 Token");
	await expect(daily.getByRole("status")).toHaveText("已达限额");
	current.limits.daily_tokens = 100;
	current.day_state.tokens = { limit: 100, used: null, remaining: null, status: "unavailable" };
	await page.getByRole("button", { name: "刷新用量", exact: true }).click();
	await expect(daily.getByRole("status")).toHaveText("用量待确认");
	await expectMetric(daily, "今日已用", "待获取");
	await expectMetric(daily, "剩余额度", "待确认");
	await expect(daily.getByRole("progressbar")).toHaveCount(0);
});

test("Token 数量：卡片及热力图统一 K/M/B，悬停保留完整值，秒数不缩写", async ({ page, isMobile }, info) => {
	const current = limitView();
	current.limits.daily_tokens = 2_000_000;
	current.limits.monthly_tokens = 2_000_000_000;
	current.day_state.tokens = { limit: 2_000_000, used: 1_234_567, remaining: 765_433, status: "ok" };
	current.tokens = { limit: 2_000_000_000, used: 1_234_567_890, remaining: 765_432_110, status: "ok" };
	current.daily.at(-1)!.tokens = 1_234_567;
	await page.route(
		(url) => url.pathname === "/api/kit/usage-limits",
		(route) => route.fulfill({ json: { data: current } }),
	);
	await page.goto("/?view=usage");
	const daily = page.getByTestId("limit-daily-tokens");
	const monthly = page.getByTestId("limit-tokens");
	await expectMetric(daily, "今日已用", "1.23M Token");
	await expectMetric(daily, "每日上限", "2M Token");
	await expectMetric(daily, "剩余额度", "765.43K Token");
	await expect(daily.getByText("今日已用", { exact: true }).locator("..").locator("dd")).toHaveAttribute(
		"title",
		"1,234,567 Token",
	);
	await expect(daily.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1234567");
	await expect(daily.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "2000000");
	await expectMetric(monthly, "本月已用", "1.23B Token");
	await expectMetric(monthly, "月度上限", "2B Token");
	await expectMetric(monthly, "剩余额度", "765.43M Token");
	await expectMetric(page.getByTestId("limit-active_seconds"), "本月已用", "5.5 秒");
	await page.getByTestId("member-usage-limits").screenshot({
		path: fileURLToPath(
			new URL(`../../../.scratch/daily-token-usage/compact-${info.project.name}.png`, import.meta.url),
		),
	});
	const cell = page.getByTestId("usage-activity").locator('[data-day="2026-10-26"]');
	await expect(cell).toHaveAttribute("title", "1,234,567 Token");
	await expect(cell.getByRole("tooltip", { includeHidden: true })).toHaveText("2026-10-26 08:00:00 起 · 1.23M Token");
	if (!isMobile) {
		await cell.hover();
		await expect(cell.getByRole("tooltip")).toBeVisible();
	}
});

test("申请与审批记录、兼容额度重置时间均显示北京时间", async ({ page }) => {
	const quota: QuotaView = {
		month: "2026-10",
		reset_at: "2026-11-01T00:00:00Z",
		unlimited: false,
		base_limit: 100,
		override_limit: null,
		packs: [],
		limit: 100,
		used: 20,
		remaining: 80,
		per_agent: [],
		daily: [],
		pending_request: null,
	};
	const requests: QuotaRequestView[] = [
		{
			id: "request-time",
			subject_id: "fixture-subject",
			requested_credits: 100,
			status: "approved",
			mode: "override",
			granted_credits: 100,
			created_at: "2026-10-31T20:00:00Z",
			reviewed_at: "2026-10-31T21:30:00Z",
		},
	];
	await page.route(
		(url) => url.pathname === "/api/kit/usage-limits",
		(route) => route.fulfill({ json: { data: null } }),
	);
	await page.route(
		(url) => url.pathname === "/api/kit/quota",
		(route) => route.fulfill({ json: { data: quota } }),
	);
	await page.route(
		(url) => url.pathname === "/api/kit/quota/requests",
		(route) => route.fulfill({ json: { data: requests } }),
	);
	await page.goto("/?view=usage");
	await expect(page.getByTestId("usage-meter")).toContainText("2026-11-01 08:00:00 重置");
	const history = page.getByTestId("usage-request-approved");
	await expect(history).toContainText("2026-11-01 04:00:00");
	await expect(history).toContainText("审批于 2026-11-01 05:30:00");
	await expect(history).not.toContainText("UTC");
	await expect(history).not.toContainText("北京时间");
});

test("Token 超限保留草稿，另一指标未确认或检查失败不解禁，全部恢复后可发送", async ({ page, request }) => {
	const slug = `limit-recovery-${Date.now()}`;
	await seedListedAgent(request, slug, slug);
	const initial = limitView();
	await page.route("**/api/kit/sessions/*/messages", (route) =>
		route.fulfill({
			status: 403,
			json: {
				error: {
					code: "quota_exceeded",
					message: "本月 Token 已达限额",
					details: {
						month: initial.month,
						reset_at: initial.reset_at,
						metric: "tokens",
						limit: 1000,
						used: 1200,
						remaining: -200,
					},
				},
			},
		}),
	);
	let checks = 0;
	await page.route(
		(url) => url.pathname === "/api/kit/usage-limits",
		(route) => {
			checks += 1;
			if (checks === 2) {
				return route.fulfill({
					status: 503,
					json: { error: { code: "provider_error", message: "检查失败，请稍后重试" } },
				});
			}
			const data = limitView();
			if (checks === 1) data.active_seconds = { limit: 60, used: null, remaining: null, status: "unavailable" };
			return route.fulfill({ json: { data } });
		},
	);
	await page.goto(`/?agent=${slug}`);
	await page.getByLabel("消息输入").fill("额度恢复后保留的草稿");
	await page.getByRole("button", { name: "发送", exact: true }).click();
	const banner = page.getByTestId("quota-banner");
	await expect(banner).toContainText("本月 Token 已达限额");
	await expect(banner).toContainText("2026-11-01 08:00:00 重置");
	await expect(banner).not.toContainText("UTC");
	await expect(banner).not.toContainText("北京时间");
	await expect(banner).toContainText("1.2K/1K");
	await expect(banner.getByText("1.2K/1K", { exact: true })).toHaveAttribute("title", "1,200/1,000 Token");
	await expect(banner).not.toContainText("Credits");
	await expect(banner.getByRole("button", { name: "去申请", exact: true })).toHaveCount(0);
	await expect(page.getByLabel("消息输入")).toBeDisabled();
	await expect(page.getByLabel("消息输入")).toHaveText("额度恢复后保留的草稿", { useInnerText: true });

	await banner.getByRole("button", { name: "重新检查额度", exact: true }).click();
	await expect(banner).toContainText("用量尚未确认");
	await expect(page.getByLabel("消息输入")).toBeDisabled();
	await banner.getByRole("button", { name: "重新检查额度", exact: true }).click();
	await expect(banner).toContainText("检查失败，请稍后重试");
	await expect(page.getByLabel("消息输入")).toBeDisabled();
	await banner.getByRole("button", { name: "重新检查额度", exact: true }).click();
	await expect(banner).toHaveCount(0);
	await expect(page.getByLabel("消息输入")).toBeEnabled();
	await expect(page.getByLabel("消息输入")).toHaveText("额度恢复后保留的草稿", { useInnerText: true });
	await page.unroute("**/api/kit/sessions/*/messages");
	await page.getByRole("button", { name: "发送", exact: true }).click();
	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible();
});
