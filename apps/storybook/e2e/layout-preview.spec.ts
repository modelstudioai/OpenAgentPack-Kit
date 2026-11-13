import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const FRAME = 'iframe[src="/previews/layout/"]';
const DRAFT = "跨设备与页面切换仍保留的草稿";

async function openLayoutPreview(page: Page) {
	await page.goto("/docs/components/layout/");
	const viewport = page.locator(FRAME);
	await expect(viewport).toHaveCount(1);
	const preview = page.frameLocator(FRAME);
	await expect(preview.getByRole("textbox", { name: "消息输入", exact: true })).toBeVisible();
	return {
		viewport,
		preview,
		input: preview.getByRole("textbox", { name: "消息输入", exact: true }),
		menu: preview.getByRole("button", { name: "打开导航菜单", exact: true }),
		drawer: preview.getByRole("dialog", { name: "导航菜单", exact: true }),
	};
}

async function viewportWidth(viewport: Locator) {
	return viewport.evaluate((element) => (element as HTMLIFrameElement).contentWindow?.innerWidth ?? 0);
}

async function expectViewportFits(viewport: Locator) {
	await expect
		.poll(() =>
			viewport.evaluate((element) => {
				const logicalWidth = (element as HTMLIFrameElement).contentWindow?.innerWidth ?? 0;
				const containerWidth = element.parentElement?.clientWidth ?? 0;
				return Math.abs(element.getBoundingClientRect().width - Math.min(logicalWidth, containerWidth));
			}),
		)
		.toBeLessThanOrEqual(1);
}

// 保护真实嵌入边界：设备开关改变 iframe 的浏览器视口，不能重建文档而丢失草稿。
test("Layout 文档预览：1280px 桌面及窗口缩放保持桌面视口，设备与页面切换保留草稿", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	const { viewport, preview, input, menu, drawer } = await openLayoutPreview(page);
	await expect(page.getByRole("button", { name: "桌面", exact: true })).toHaveAttribute("aria-pressed", "true");
	await expect.poll(() => viewportWidth(viewport)).toBeGreaterThanOrEqual(768);
	await expect(menu).toHaveCount(0);
	await expect(preview.getByRole("navigation", { name: "会话列表", exact: true })).toBeVisible();
	await input.fill(DRAFT);
	const originalDocument = await viewport.evaluateHandle((element) => (element as HTMLIFrameElement).contentDocument);
	const desktopWidth = await viewportWidth(viewport);
	for (const width of [1440, 1024, 390, 1280]) {
		await page.setViewportSize({ width, height: 900 });
		await expect.poll(() => viewportWidth(viewport)).toBe(desktopWidth);
		await expectViewportFits(viewport);
		await expect(menu).toHaveCount(0);
		await expect(input).toHaveText(DRAFT);
	}

	await page.getByRole("button", { name: "手机", exact: true }).click();
	await expect.poll(() => viewportWidth(viewport)).toBeLessThan(768);
	await expect(menu).toBeVisible();
	await expect(input).toHaveText(DRAFT);
	await menu.click();
	await expect(drawer).toBeVisible();
	await expect(drawer.getByText("演示用户", { exact: true })).toBeVisible();
	await drawer
		.getByRole("navigation", { name: "预览主导航", exact: true })
		.getByRole("button", { name: "我的用量", exact: true })
		.click();
	await expect(drawer).toHaveCount(0);
	await expect(preview.getByRole("heading", { name: "我的用量", exact: true })).toBeVisible();
	await expect(input).toHaveCount(0);

	await menu.click();
	await drawer
		.getByRole("navigation", { name: "预览主导航", exact: true })
		.getByRole("button", { name: "对话", exact: true })
		.click();
	await expect(drawer).toHaveCount(0);
	await expect(input).toHaveText(DRAFT);
	await menu.click();
	await drawer.getByRole("button", { name: "开发票", exact: true }).click();
	await expect(drawer).toHaveCount(0);
	await expect(preview.getByText("开发票", { exact: true })).toBeVisible();
	await expect(input).toHaveText(DRAFT);

	await page.getByRole("button", { name: "桌面", exact: true }).click();
	await expect.poll(() => viewportWidth(viewport)).toBeGreaterThanOrEqual(768);
	await expect(drawer).toHaveCount(0);
	await expect(menu).toHaveCount(0);
	await expect(preview.getByRole("button", { name: "开发票", exact: true })).toHaveAttribute("aria-current", "true");
	await expect(input).toHaveText(DRAFT);
	expect(
		await viewport.evaluate(
			(element, original) => (element as HTMLIFrameElement).contentDocument === original,
			originalDocument,
		),
	).toBe(true);
	await originalDocument.dispose();
});

// 保护受控确认状态跨断点迁移：取消不删数据，显式确认才删除，随后正文仍可交互。
test("Layout 文档预览：抽屉内删除跨设备后仍可取消与确认", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	const { preview, input, menu, drawer } = await openLayoutPreview(page);
	const session = preview.getByRole("button", { name: "订单 2026101 物流异常", exact: true });
	const confirmation = preview.getByRole("alertdialog", { name: "删除会话", exact: true });
	await expect(session).toBeVisible();
	await input.fill(DRAFT);

	for (const action of ["取消", "确认"] as const) {
		await page.getByRole("button", { name: "手机", exact: true }).click();
		await menu.click();
		await expect(drawer.getByRole("button", { name: "订单 2026101 物流异常", exact: true })).toBeVisible();
		// 菜单弹层 Portal 到 iframe body，不在 drawer 子树内。
		await drawer.getByRole("button", { name: "更多操作", exact: true }).first().click();
		await preview.getByRole("menuitem", { name: "删除", exact: true }).first().click();
		await expect(confirmation).toBeVisible();
		await expect(confirmation).toContainText("订单 2026101 物流异常");
		await expect(confirmation).toContainText("仅修改演示数据，不调用后端");
		await page.getByRole("button", { name: "桌面", exact: true }).click();
		await expect(drawer).toHaveCount(0);
		await expect(confirmation).toHaveCount(1);
		await expect(confirmation).toBeVisible();
		await page.setViewportSize({ width: 390, height: 844 });
		await expect(confirmation).toBeVisible();
		await page.setViewportSize({ width: 1280, height: 900 });
		await confirmation.getByRole("button", { name: action, exact: true }).click();
		await expect(confirmation).toHaveCount(0);
		await expect(input).toHaveText(DRAFT);
		if (action === "取消") await expect(session).toBeVisible();
		else await expect(session).toHaveCount(0);
	}
	await preview.getByRole("button", { name: "开发票", exact: true }).click();
	await expect(input).toBeEditable();
	await expect(input).toHaveText(DRAFT);
});

// 保护窄屏阅读与源码入口：长示例只能在代码区内部滚动，不能撑宽父文档。
test("Layout 文档在 390px 无横向溢出，源码入口展示实际 Layout 示例", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const { viewport, preview, menu } = await openLayoutPreview(page);
	await expect.poll(() => viewportWidth(viewport)).toBeGreaterThanOrEqual(768);
	await expectViewportFits(viewport);
	await expect(menu).toHaveCount(0);
	const overflow = () =>
		page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	await expect.poll(overflow).toBeLessThanOrEqual(1);
	await page.getByRole("button", { name: "手机", exact: true }).click();
	await expect.poll(() => viewportWidth(viewport)).toBeLessThanOrEqual(390);
	await expect(menu).toBeVisible();
	await expect.poll(overflow).toBeLessThanOrEqual(1);
	await expect
		.poll(() => preview.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth))
		.toBeLessThanOrEqual(1);

	const sourceButton = page.getByRole("button", { name: "源码", exact: true });
	await sourceButton.click();
	await expect(sourceButton).toHaveAttribute("aria-expanded", "true");
	const sourceId = await sourceButton.getAttribute("aria-controls");
	expect(sourceId).toBeTruthy();
	const source = page.locator(`[id="${sourceId}"]`);
	await expect(source).toContainText("<Layout");
	await expect(source).toContainText("closeSidebar");
	await expect.poll(overflow).toBeLessThanOrEqual(1);
});
