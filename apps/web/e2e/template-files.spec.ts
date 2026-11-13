import { expect, test } from "./fixtures.ts";
import { inlineSection, leaveInlineTemplate, openInlinePicker, openInlineTemplate } from "./template-inline-helpers.ts";
import { installInlineSelectionFixture } from "./template-inline-selection-fixture.ts";

test.afterEach(async ({ page }) => leaveInlineTemplate(page));

test("文件导入：搜索、多选和取消，未保存上传占用上限，确认后合并草稿与挂载路径", async ({ page }) => {
	await installInlineSelectionFixture(page, "files");
	await openInlineTemplate(page);
	const files = inlineSection(page, "文件");
	await files
		.locator('input[type="file"]')
		.setInputFiles({ name: "资料 1.txt", mimeType: "text/plain", buffer: Buffer.from("local") });
	let picker = await openInlinePicker(page, "文件");
	const search = picker.getByRole("searchbox", { name: "搜索文件", exact: true });
	await search.fill("resource_23");
	await picker.getByRole("button", { name: /^选择文件 / }).click();
	await picker.getByRole("button", { name: "取消", exact: true }).click();
	await expect(files.getByRole("list", { name: "文件配置", exact: true }).getByRole("listitem")).toHaveCount(1);
	picker = await openInlinePicker(page, "文件");
	await search.fill("");
	const available = picker.getByRole("button", { name: /^选择文件 /, pressed: false });
	for (let index = 0; index < 9; index++) await available.first().click();
	await expect(available.first()).toBeDisabled();
	await picker
		.getByRole("button", { name: /^选择文件 /, pressed: true })
		.last()
		.click();
	await expect(available.first()).toBeEnabled();
	await available.first().click();
	await picker.getByRole("button", { name: "确认选择", exact: true }).click();
	await expect(files.getByRole("list", { name: "文件配置", exact: true }).getByRole("listitem")).toHaveCount(10);
	await expect(files.locator('input[type="file"]')).toBeDisabled();
	await expect(inlineSection(page, "已选配置预览")).toContainText("/mnt/session/uploads/资料_1-2.txt");
	await files.getByRole("button", { name: "移除", exact: true }).last().click();
	await expect(files.locator('input[type="file"]')).toBeEnabled();
});

test("文件导入：窄屏错误重试与空列表，不改变主表单的待上传文件", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const state = await installInlineSelectionFixture(page, "files", 0);
	state.listError = true;
	await openInlineTemplate(page);
	const picker = await openInlinePicker(page, "文件");
	await expect(picker).toContainText("文件列表暂不可用");
	state.listError = false;
	await picker.getByRole("button", { name: "重试", exact: true }).click();
	await expect(picker).toContainText("暂无可选文件");
	await picker.getByRole("button", { name: "取消", exact: true }).click();
	await expect(
		inlineSection(page, "文件").getByRole("list", { name: "文件配置", exact: true }).getByRole("listitem"),
	).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
