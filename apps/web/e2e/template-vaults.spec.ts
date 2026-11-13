import { expect, test } from "./fixtures.ts";
import { inlineSection, leaveInlineTemplate, openInlinePicker, openInlineTemplate } from "./template-inline-helpers.ts";
import { installInlineSelectionFixture } from "./template-inline-selection-fixture.ts";

test.afterEach(async ({ page }) => {
	const detail = page.getByRole("dialog", { name: "密钥库详情", exact: true });
	if (await detail.isVisible()) {
		await detail.getByRole("button", { name: "关闭", exact: true }).click();
		await expect(detail).toBeHidden();
	}
	const picker = page.getByRole("dialog", { name: "选择配置", exact: true });
	if (await picker.isVisible()) await picker.getByRole("button", { name: "取消", exact: true }).click();
	await leaveInlineTemplate(page);
});

test("密钥库导入：详情查看不选择，确认保留多选与上限，元数据回填且原密钥值为空", async ({ page }) => {
	await installInlineSelectionFixture(page, "vaults");
	await openInlineTemplate(page);
	const picker = await openInlinePicker(page, "密钥库");
	await picker.getByRole("searchbox", { name: "搜索密钥库", exact: true }).fill("resource_23");
	await picker.getByRole("button", { name: "查看详情", exact: true }).click();
	const detail = page.getByRole("dialog", { name: "密钥库详情", exact: true });
	await expect(detail).toContainText("PROJECT_KEY");
	await expect(detail).toContainText("api.example.test");
	await detail.getByRole("button", { name: "关闭", exact: true }).click();
	await expect(picker.getByRole("button", { name: /^选择密钥库 /, pressed: true })).toHaveCount(0);
	await picker.getByRole("searchbox", { name: "搜索密钥库", exact: true }).fill("");
	const available = picker.getByRole("button", { name: /^选择密钥库 /, pressed: false });
	for (let index = 0; index < 10; index++) await available.first().click();
	await expect(available.first()).toBeDisabled();
	await picker
		.getByRole("button", { name: /^选择密钥库 /, pressed: true })
		.last()
		.click();
	await expect(available.first()).toBeEnabled();
	await available.first().click();
	await picker.getByRole("button", { name: "确认选择", exact: true }).click();
	const vault = inlineSection(page, "密钥库");
	await expect(vault.getByRole("textbox", { name: "密钥库名称", exact: true })).toHaveCount(10);
	await expect(vault.getByRole("button", { name: "添加密钥库", exact: true })).toBeDisabled();
	await vault.getByRole("button", { name: "编辑密钥 项目服务", exact: true }).first().click();
	const editor = page.getByRole("dialog", { name: "编辑密钥", exact: true });
	await expect(editor.getByLabel("变量值")).toHaveValue("");
	await editor.getByRole("button", { name: "取消", exact: true }).click();
	await vault.getByRole("button", { name: "移除密钥库 10", exact: true }).click();
	await expect(vault.getByRole("button", { name: "添加密钥库", exact: true })).toBeEnabled();
});

test("密钥库导入：窄屏详情失败可重试，取消不改变原表单", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const state = await installInlineSelectionFixture(page, "vaults", 1);
	state.detailError = true;
	await openInlineTemplate(page);
	const picker = await openInlinePicker(page, "密钥库");
	await picker.getByRole("button", { name: "查看详情", exact: true }).click();
	const detail = page.getByRole("dialog", { name: "密钥库详情", exact: true });
	await expect(detail).toContainText("密钥库详情暂不可用");
	state.detailError = false;
	await detail.getByRole("button", { name: "重试", exact: true }).click();
	await expect(detail).toContainText("PROJECT_KEY");
	await detail.getByRole("button", { name: "关闭", exact: true }).click();
	await picker.getByRole("button", { name: "取消", exact: true }).click();
	await expect(inlineSection(page, "密钥库").getByRole("textbox", { name: "密钥库名称", exact: true })).toHaveValue("");
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
