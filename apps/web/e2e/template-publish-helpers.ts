import type { Page } from "@playwright/test";
import { expect } from "./fixtures.ts";

/** 云端资源直接进入预览，等待会话创建完成或明确失败后打开保存表单。 */
export async function openTemplateSaveDialog(page: Page) {
	const next = page.getByRole("button", { name: "下一步：预览调试", exact: true });
	if (await next.isVisible()) await next.click();
	await expect(page.getByRole("dialog", { name: "确认发布", exact: true })).toHaveCount(0);
	await expect(page.getByRole("region", { name: "模版预览调试", exact: true })).toBeVisible();
	await page
		.locator('footer[aria-label="模版配置操作"]')
		.getByRole("button", { name: /^保存(智能体|修改)$/, includeHidden: true })
		.click();
	await expect(page.getByRole("dialog", { name: /^保存(智能体|修改)$/ })).toBeVisible();
}
