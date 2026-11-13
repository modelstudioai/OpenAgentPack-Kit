import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openSessionList, seedListedAgent } from "./helpers.ts";

async function prepareSidebar(page: Page, request: APIRequestContext) {
	const prefix = `sidebar-availability-${Date.now()}`;
	const current = `${prefix}-current`;
	const target = `${prefix}-target`;
	for (const slug of [current, target]) {
		await seedListedAgent(request, slug, slug);
		const created = await page.request.post("/api/kit/sessions", {
			data: { agent_slug: slug, title: `${slug} history` },
		});
		expect(created.ok()).toBe(true);
	}
	await page.goto(`/?agent=${current}`);
	await expect(page.getByLabel("消息输入")).toBeVisible();
	await openSessionList(page);
	await expect(page.getByTestId(`sidebar-group-new-${target}`)).toBeVisible();
	return { current, target };
}

// 保护分组新建的目标身份：已上架可进入；已下架时保留原页面、草稿与旧会话入口。
test("侧栏新建：下架前后均核对目标智能体，拒绝时提示并保留草稿", async ({ page, request, isMobile }) => {
	const { current, target } = await prepareSidebar(page, request);
	await page.getByTestId(`sidebar-group-new-${target}`).click();
	await expect(page).toHaveURL(`/?agent=${target}`);
	await expect(page.getByRole("region", { name: "消息列表", exact: true })).toContainText(`和 ${target} 聊聊`);
	await openSessionList(page);
	await page.getByTestId(`sidebar-group-new-${current}`).click();
	await expect(page).toHaveURL(`/?agent=${current}`);
	await page.getByLabel("消息输入").fill("保留当前智能体的草稿");

	// 页面仍缓存已上架目录时，在服务端下架目标，点击必须使用当前状态。
	const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };
	const planned = await request.post(`/api/admin/agents/${target}/plan`, {
		headers,
		data: { action: "listing", status: "unlisted" },
	});
	expect(planned.ok()).toBe(true);
	const { data: plan } = await planned.json();
	const unlisted = await request.patch(`/api/admin/agents/${target}`, {
		headers,
		data: { status: "unlisted", plan_id: plan.plan_id, confirm_token: plan.confirm_token },
	});
	expect(unlisted.ok()).toBe(true);
	await openSessionList(page);
	const checked = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/kit/agents");
	await page.getByTestId(`sidebar-group-new-${target}`).click();
	await (await checked).finished();
	const notice = page.getByRole("alert").filter({ hasText: "该智能体已下架，暂时无法新建会话。" });
	await expect(notice).toBeVisible();
	await expect(page).toHaveURL(`/?agent=${current}`);
	await notice.getByRole("button", { name: "关闭错误提示", exact: true }).click();
	await expect(notice).toHaveCount(0);
	if (isMobile) await page.getByRole("button", { name: "关闭导航菜单", exact: true }).click();
	await expect(page.getByLabel("消息输入")).toHaveValue("保留当前智能体的草稿");

	// 刷新后目录已经排除目标，但历史会话仍形成分组，点击同样只提示。
	await page.reload();
	await expect(page.getByLabel("消息输入")).toBeVisible();
	await page.getByLabel("消息输入").fill("刷新后的草稿");
	await openSessionList(page);
	await page.getByTestId(`sidebar-group-new-${target}`).click();
	await expect(notice).toBeVisible();
	await expect(page).toHaveURL(`/?agent=${current}`);
	if (isMobile) await page.getByRole("button", { name: "关闭导航菜单", exact: true }).click();
	await expect(page.getByLabel("消息输入")).toHaveValue("刷新后的草稿");
	await openSessionList(page);
	await page
		.getByRole("navigation", { name: "最近会话", exact: true })
		.getByRole("button", { name: `${target} history`, exact: true })
		.click();
	await expect(page).toHaveURL(new RegExp(`agent=${target}&session=`));
});

// 状态查询失败不能触发回退导航；关闭提示后可再次点击并正常进入目标。
test("侧栏新建：上架状态查询失败保留页面，重试后可进入", async ({ page, request }) => {
	const { current, target } = await prepareSidebar(page, request);
	await page.route("**/api/kit/agents", (route) =>
		route.fulfill({ status: 503, json: { error: { code: "provider_error", message: "暂不可用" } } }),
	);
	await page.getByTestId(`sidebar-group-new-${target}`).click();
	const notice = page.getByRole("alert").filter({ hasText: "无法确认智能体上架状态，请稍后重试。" });
	await expect(notice).toBeVisible();
	await expect(page).toHaveURL(`/?agent=${current}`);
	await page.unroute("**/api/kit/agents");
	await page.getByTestId(`sidebar-group-new-${target}`).click();
	await expect(page).toHaveURL(`/?agent=${target}`);
	await expect(page.getByRole("region", { name: "消息列表", exact: true })).toContainText(`和 ${target} 聊聊`);
	await expect(notice).toHaveCount(0);
});
