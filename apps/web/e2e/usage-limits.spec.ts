import {
	type MemberUsageLimitView,
	type MemberUsageSummary,
	type MemberView,
	PROTOCOL_VERSION,
	SESSION_USAGE_METRICS,
	type UsageLimitConfig,
	UsageLimitConfigSchema,
} from "@openagentpack/kit-sdk/protocol";
import type { APIRequestContext, Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation, seedListedAgent } from "./helpers.ts";

const unlimited: UsageLimitConfig = { monthly_tokens: null, monthly_active_seconds: null };
const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };

async function openConsole(page: Page, url: string, apiBase: string, token = ADMIN_TOKEN) {
	await page.goto(`${url}/?api=${encodeURIComponent(apiBase)}`);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(token);
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await openConsoleNavigation(page);
	await page.getByTestId("usage-tab").click();
	await expect(page.getByRole("heading", { name: "Session 用量", exact: true })).toBeVisible();
}

async function fillLimits(page: Page, title: string, tokens: string, hours: string) {
	const form = page.getByRole("form", { name: title, exact: true });
	await form.getByLabel("每月 Token 上限（输入 + 输出）", { exact: true }).fill(tokens);
	await form.getByLabel("每月运行时长上限（小时）", { exact: true }).fill(hours);
	await form.getByRole("button", { name: "保存限额", exact: true }).click();
	return page.getByRole("alertdialog", { name: `确认${title}`, exact: true });
}

async function readMemberLimit(request: APIRequestContext, memberId: string) {
	const result = await request.get(`/api/admin/members/${memberId}/usage-limit`, { headers });
	expect(result.ok()).toBe(true);
	return ((await result.json()) as { data: MemberUsageLimitView }).data;
}

test("月度限额保存与回读：默认、个人与恢复默认；发送达限后调整额度恢复", async ({ page, request }, info) => {
	const suffix = Date.now().toString(36);
	const username = `limit-${suffix}`;
	const displayName = "月度限额回归成员";
	const slug = `limit-agent-${suffix}`;
	const apiBase = String(info.config.metadata.apiBaseUrl);
	const created = await request.post("/api/admin/members", {
		headers,
		data: {
			username,
			display_name: displayName,
			auth_type: "local",
			password_mode: "custom",
			password: "Usage-Limit!2026",
		},
	});
	expect(created.ok()).toBe(true);
	const { member } = (await created.json()).data as { member: MemberView };
	await seedListedAgent(request, slug, "月度限额 Agent");
	await openConsole(page, String(info.config.metadata.consoleUrl), apiBase);
	await page.getByRole("button", { name: "月度限额", exact: true }).click();
	await page.getByRole("button", { name: "设置默认限额", exact: true }).click();
	const policyDialog = await fillLimits(page, "默认月度限额", "200", "");
	await expect(policyDialog).toContainText("修改前：");
	await expect(policyDialog).toContainText("修改后：");
	await expect(policyDialog).toContainText("200 Token");
	await policyDialog.getByRole("button", { name: "取消", exact: true }).click();
	expect((await (await request.get("/api/admin/usage-limits/policy", { headers })).json()).data.limits).toEqual(
		unlimited,
	);
	await page
		.getByRole("form", { name: "默认月度限额", exact: true })
		.getByRole("button", { name: "保存限额", exact: true })
		.click();
	await policyDialog.getByRole("button", { name: "确认保存", exact: true }).click();
	await expect(policyDialog).toHaveCount(0);
	expect((await readMemberLimit(request, member.member_id)).limits).toEqual({
		monthly_tokens: 200,
		monthly_active_seconds: null,
	});
	await page
		.getByRole("row", { name: new RegExp(username) })
		.getByRole("button", { name: "设置限额", exact: true })
		.click();
	const memberPanel = page.getByRole("region", { name: "成员月度限额", exact: true });
	await expect(memberPanel).toContainText("跟随默认限额");
	const memberDialog = await fillLimits(page, "成员月度限额", "400", "0.5");
	await expect(memberDialog).toContainText("1,800 秒");
	await memberDialog.getByRole("button", { name: "确认保存", exact: true }).click();
	await expect(memberDialog).toHaveCount(0);
	expect((await readMemberLimit(request, member.member_id)).override).toEqual({
		monthly_tokens: 400,
		monthly_active_seconds: 1800,
	});
	await memberPanel.getByRole("button", { name: "设置限额", exact: true }).click();
	await page.getByRole("button", { name: "恢复默认", exact: true }).click();
	const resetDialog = page.getByRole("alertdialog", { name: "确认恢复默认限额", exact: true });
	await expect(resetDialog).toContainText("修改前：");
	await expect(resetDialog).toContainText("200 Token");
	await resetDialog.getByRole("button", { name: "确认保存", exact: true }).click();
	await expect(resetDialog).toHaveCount(0);
	expect((await readMemberLimit(request, member.member_id)).override).toBeNull();

	const experience = await page.context().newPage();
	try {
		await experience.goto(`${info.config.metadata.webUrl}/?${new URLSearchParams({ api: apiBase, agent: slug })}`);
		await experience.getByLabel("用户名", { exact: true }).fill(username);
		await experience.getByLabel("密码", { exact: true }).fill("Usage-Limit!2026");
		await experience.getByRole("button", { name: "登录", exact: true }).click();
		await experience.getByLabel("消息输入").fill("第一轮消耗恰好达到 Token 月度限额");
		await experience.getByRole("button", { name: "发送", exact: true }).click();
		await expect(experience.getByText(/mock gateway 的流式回答/).first()).toBeVisible();
		await expect(experience.getByText("空闲", { exact: true })).toBeVisible();
		const denied = experience.waitForResponse(
			(response) => /\/messages$/.test(new URL(response.url()).pathname) && response.status() === 403,
		);
		await experience.getByLabel("消息输入").fill("限额调整后继续这一轮");
		await experience.getByRole("button", { name: "发送", exact: true }).click();
		expect((await (await denied).json()).error).toMatchObject({
			code: "quota_exceeded",
			details: { metric: "tokens" },
		});
		await expect(experience.getByTestId("quota-banner")).toContainText("本月 Token 已达限额");
		await expect(experience.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
		await memberPanel.getByRole("button", { name: "刷新限额状态", exact: true }).click();
		await expect(memberPanel).toContainText("已达限额，后续发送受限");
		await memberPanel.getByRole("button", { name: "设置限额", exact: true }).click();
		const increase = await fillLimits(page, "成员月度限额", "400", "");
		await increase.getByRole("button", { name: "确认保存", exact: true }).click();
		await expect(increase).toHaveCount(0);
		await experience.getByRole("button", { name: "重新检查额度", exact: true }).click();
		await expect(experience.getByTestId("quota-banner")).toHaveCount(0);
		await expect(experience.getByLabel("消息输入")).toHaveValue("限额调整后继续这一轮");
		const accepted = experience.waitForResponse(
			(response) => /\/messages$/.test(new URL(response.url()).pathname) && response.request().method() === "POST",
		);
		await experience.getByRole("button", { name: "发送", exact: true }).click();
		expect((await accepted).ok()).toBe(true);
		await expect(experience.getByText("空闲", { exact: true })).toBeVisible();
	} finally {
		await experience.close();
		await request.put("/api/admin/usage-limits/policy", { headers, data: unlimited });
	}
});

const fixtureBase = "https://usage-limits.example/kit";
const fixtureLimits: UsageLimitConfig = { monthly_tokens: 100, monthly_active_seconds: 3600 };

function fixtureSummary(): MemberUsageSummary {
	return {
		session_count: 0,
		deleted_session_count: 0,
		metrics: Object.fromEntries(
			SESSION_USAGE_METRICS.map((key) => [key, { value: 0, covered_sessions: 0 }]),
		) as MemberUsageSummary["metrics"],
		agents: [],
		refresh_status: "idle",
		completed_sessions: 0,
	};
}

async function fixtureConsole(page: Page, consoleUrl: string, role: "admin" | "auditor") {
	const summary = fixtureSummary();
	const member: MemberView = {
		member_id: "member-limits",
		username: "limit-user",
		display_name: "限额样例成员",
		auth_type: "local",
		status: "active",
		created_at: "2026-10-26T00:00:00Z",
		updated_at: "2026-10-26T00:00:00Z",
		usage_summary: summary,
	};
	let current: MemberUsageLimitView = {
		member_id: member.member_id,
		month: "2026-10",
		reset_at: "2026-11-01T00:00:00Z",
		limits: fixtureLimits,
		override: fixtureLimits,
		tokens: { limit: 100, used: 120, remaining: -20, status: "exceeded" },
		active_seconds: { limit: 3600, used: null, remaining: null, status: "unavailable" },
		accounting_started_at: "2026-10-26T00:00:00Z",
		refreshed_at: "2026-10-26T01:00:00Z",
	};
	const writes: UsageLimitConfig[] = [];
	function respondMemberLimit(route: Route) {
		if (route.request().method() === "PUT") {
			const limits = UsageLimitConfigSchema.parse(route.request().postDataJSON());
			writes.push(limits);
			if (writes.length === 1) {
				return route.fulfill({
					status: 500,
					json: { error: { code: "internal", message: "设置保存失败，请重试", retryable: true } },
				});
			}
			current = {
				...current,
				limits,
				override: limits,
				tokens: { ...current.tokens, limit: limits.monthly_tokens },
				active_seconds: { ...current.active_seconds, limit: limits.monthly_active_seconds },
			};
		}
		return route.fulfill({ json: { data: current } });
	}
	await page.route(`${fixtureBase}/api/**`, async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith("/config"))
			return route.fulfill({ json: { data: { apiBaseUrl: fixtureBase, protocolVersion: PROTOCOL_VERSION } } });
		expect(route.request().headers().authorization).toBe("Bearer limit-ui");
		if (path.endsWith("/identity"))
			return route.fulfill({ json: { data: { role, subject: `admin:${role}:fixture` } } });
		if (path.endsWith("/members")) return route.fulfill({ json: { data: [member] } });
		if (path.endsWith("/usage-limits/policy")) return route.fulfill({ json: { data: { limits: unlimited } } });
		if (path.endsWith("/usage-limit")) return respondMemberLimit(route);
		if (path.endsWith("/usage")) return route.fulfill({ json: { data: summary } });
		return route.fulfill({ json: { data: [] } });
	});
	await openConsole(page, consoleUrl, fixtureBase, "limit-ui");
	return { writes };
}

test("限额设置：采集不可确认仍可编辑，0 有效，保存失败保留差异并显式重试", async ({ page }, info) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const { writes } = await fixtureConsole(page, String(info.config.metadata.consoleUrl), "admin");
	await page
		.getByRole("row", { name: /限额样例成员/ })
		.getByRole("button", { name: "设置限额", exact: true })
		.click();
	const panel = page.getByRole("region", { name: "成员月度限额", exact: true });
	await expect(panel).toContainText("-20 Token");
	await expect(panel).toContainText("用量暂不可确认");
	const form = page.getByRole("form", { name: "成员月度限额", exact: true });
	await fillLimits(page, "成员月度限额", "-1", "0");
	await expect(form).toContainText("Token 限额须为非负安全整数");
	expect(writes).toEqual([]);
	const dialog = await fillLimits(page, "成员月度限额", "0", "0");
	await expect(dialog).toContainText("0 Token");
	expect(writes).toEqual([]);
	await dialog.getByRole("button", { name: "确认保存", exact: true }).click();
	await expect(dialog).toContainText("设置保存失败，请重试");
	await expect(dialog).toContainText("修改后：");
	await dialog.getByRole("button", { name: "确认保存", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	expect(writes).toEqual([
		{ monthly_tokens: 0, monthly_active_seconds: 0 },
		{ monthly_tokens: 0, monthly_active_seconds: 0 },
	]);
	await expect(panel.getByText("0 Token", { exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
		await page.evaluate(() => document.documentElement.clientWidth),
	);
});

test("auditor 可读实际成员限额与采集状态，不显示任何保存或恢复默认入口", async ({ page }, info) => {
	const { writes } = await fixtureConsole(page, String(info.config.metadata.consoleUrl), "auditor");
	const row = page.getByRole("row", { name: /限额样例成员/ });
	await expect(row).toBeVisible();
	await page.getByRole("button", { name: "月度限额", exact: true }).click();
	await expect(page.getByRole("region", { name: "默认月度限额", exact: true })).toContainText("不限量");
	await expect(page.getByRole("button", { name: "设置默认限额", exact: true })).toHaveCount(0);
	await expect(row.getByRole("button", { name: "设置限额", exact: true })).toHaveCount(0);
	await row.getByRole("button", { name: "会话明细", exact: true }).click();
	const panel = page.getByRole("region", { name: "成员月度限额", exact: true });
	await expect(panel).toContainText("-20 Token");
	await expect(panel).toContainText("用量暂不可确认");
	await expect(panel).toContainText("当前身份只读");
	await expect(page.getByRole("button", { name: /^(设置限额|保存限额|恢复默认)$/ })).toHaveCount(0);
	expect(writes).toEqual([]);
});
