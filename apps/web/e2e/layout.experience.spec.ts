import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const drawerOf = (page: Page) => page.getByRole("dialog", { name: "导航菜单", exact: true });
const menuOf = (page: Page) => page.getByRole("button", { name: "打开导航菜单", exact: true });

async function openFixture(page: Page, baseURL: string | undefined) {
	if (!baseURL) throw new Error("Layout 回归需要配置 baseURL");
	const origin = new URL(baseURL).origin;
	const errors: string[] = [];
	const unexpectedRequests: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	// 此夹具不需要服务端；拦截意外业务或外部请求，避免回归访问当前开发中的 Cloud 服务。
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		if (url.origin !== origin || url.pathname.startsWith("/api/")) {
			unexpectedRequests.push(`${url.origin}${url.pathname}`);
			return route.abort();
		}
		return route.continue();
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/e2e/fixtures/layout.html");
	await expect(menuOf(page)).toBeVisible();
	await expect(page.getByLabel("消息输入", { exact: true })).toBeVisible();
	return { errors, unexpectedRequests };
}

// 保护抽取后的公开 Layout：断点切换不重挂正文，也不留下隐藏模态层阻止背景操作。
test("Layout：移动抽屉跨桌面恢复，选择会话与导航后关闭且保留正文草稿", async ({ page, baseURL }) => {
	const evidence = await openFixture(page, baseURL);
	const input = page.getByLabel("消息输入", { exact: true });
	const drawer = drawerOf(page);
	const state = page.getByTestId("layout-state");
	await input.fill("跨断点仍保留的草稿");
	await menuOf(page).click();
	await expect(drawer).toBeVisible();
	await expect(drawer.getByText("本地回归用户", { exact: true })).toBeVisible();

	await page.setViewportSize({ width: 1280, height: 844 });
	await expect(drawer).toHaveCount(0);
	await expect(menuOf(page)).toHaveCount(0);
	await expect(page.getByRole("navigation", { name: "最近会话", exact: true })).toHaveCount(1);
	await expect(page.getByText("布局回归品牌", { exact: true })).toHaveCount(1);
	await expect(input).toHaveValue("跨断点仍保留的草稿");
	await page.getByRole("button", { name: "执行本地动作", exact: true }).click();
	await expect(page.getByTestId("body-actions")).toHaveText("本地动作：1");

	await page.setViewportSize({ width: 390, height: 844 });
	await expect(menuOf(page)).toBeVisible();
	await expect(drawer).toHaveCount(0);
	await menuOf(page).click();
	// 目录的「智能体」分组与「最近」都渲染同一批会话；行点击与行菜单都收窄到「最近」导航。
	await drawer
		.getByRole("navigation", { name: "最近会话", exact: true })
		.getByRole("button", { name: "第二段会话", exact: true })
		.click();
	await expect(drawer).toHaveCount(0);
	await expect(state).toContainText('"activeId":"session-two"');
	await expect(input).toHaveValue("跨断点仍保留的草稿");
	await menuOf(page).click();
	await drawer.getByRole("navigation", { name: "夹具导航" }).getByRole("button", { name: "用量", exact: true }).click();
	await expect(drawer).toHaveCount(0);
	await expect(state).toContainText('"view":"用量"');
	await expect(input).toHaveValue("跨断点仍保留的草稿");
	await expect(page.getByTestId("body-actions")).toHaveText("本地动作：1");
	expect(evidence.errors).toEqual([]);
	expect(evidence.unexpectedRequests).toEqual([]);
});

// 保护受控 pending：嵌套确认取消后还焦点，手机切桌面时确认流程不丢、不重复执行。
test("Layout：抽屉内确认保留到桌面，取消恢复焦点且确认只触发一次", async ({ page, baseURL }) => {
	const evidence = await openFixture(page, baseURL);
	const drawer = drawerOf(page);
	const confirm = page.getByRole("alertdialog", { name: "确认归档", exact: true });
	const state = page.getByTestId("layout-state");
	await menuOf(page).click();
	// 操作收进「更多操作」菜单；菜单弹层 Portal 到 body，菜单项不在 drawer 子树内。
	const actions = drawer
		.getByRole("navigation", { name: "最近会话", exact: true })
		.getByRole("button", { name: "更多操作", exact: true })
		.first();
	await actions.focus();
	await actions.click();
	await page.getByRole("menuitem", { name: "归档", exact: true }).click();
	await expect(confirm).toBeVisible();
	await expect(confirm).toContainText("归档 第一段会话");
	await confirm.getByRole("button", { name: "取消", exact: true }).click();
	await expect(confirm).toHaveCount(0);
	await expect(drawer).toBeVisible();
	await expect(actions).toBeFocused();

	await actions.click();
	await page.getByRole("menuitem", { name: "归档", exact: true }).click();
	await expect(confirm).toBeVisible();
	await page.setViewportSize({ width: 1280, height: 844 });
	await expect(drawer).toHaveCount(0);
	await expect(confirm).toHaveCount(1);
	await expect(confirm).toBeVisible();
	await expect(confirm).toContainText("归档 第一段会话");
	await expect.poll(() => confirm.evaluate((element) => element.contains(document.activeElement))).toBe(true);
	await confirm.getByRole("button", { name: "确认", exact: true }).click();
	await expect(confirm).toHaveCount(0);
	await expect(state).toContainText('"pending":null,"confirmed":1,"cancelled":1');
	await page.getByRole("button", { name: "执行本地动作", exact: true }).click();
	await expect(page.getByTestId("body-actions")).toHaveText("本地动作：1");
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(menuOf(page)).toBeVisible();
	await expect(drawer).toHaveCount(0);
	await expect(confirm).toHaveCount(0);
	await expect(state).toContainText('"confirmed":1,"cancelled":1');
	expect(evidence.errors).toEqual([]);
	expect(evidence.unexpectedRequests).toEqual([]);
});
