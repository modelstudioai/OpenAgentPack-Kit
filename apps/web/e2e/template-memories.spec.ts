import { expect, test } from "./fixtures.ts";
import { inlineSection, leaveInlineTemplate, openInlinePicker, openInlineTemplate } from "./template-inline-helpers.ts";
import { installInlineSelectionFixture } from "./template-inline-selection-fixture.ts";

test.afterEach(async ({ page }) => leaveInlineTemplate(page));

test("记忆导入：跨搜索多选和上限，确认加载条目，权限和说明独立且重开取消保留", async ({ page }) => {
	await installInlineSelectionFixture(page, "memory-stores");
	await openInlineTemplate(page);
	let picker = await openInlinePicker(page, "记忆库");
	const search = picker.getByRole("searchbox", { name: "搜索记忆库", exact: true });
	await search.fill("resource_23");
	await picker.getByRole("button", { name: "选择记忆库 资源 23（resource_23）", exact: true }).click();
	await search.fill("");
	const available = picker.getByRole("button", { name: /^选择记忆库 /, pressed: false });
	for (let index = 0; index < 7; index++) await available.first().click();
	await expect(available.first()).toBeDisabled();
	await picker
		.getByRole("button", { name: /^选择记忆库 /, pressed: true })
		.first()
		.click();
	await expect(available.first()).toBeEnabled();
	await available.first().click();
	await picker.getByRole("button", { name: "确认选择", exact: true }).click();
	const memory = inlineSection(page, "记忆库");
	await expect(memory.getByRole("textbox", { name: "记忆库名称", exact: true })).toHaveCount(8);
	await expect(memory).toContainText("正文 resource_23");
	const access = memory.getByRole("combobox", { name: "权限", exact: true }).first();
	await access.click();
	await access.press("ArrowUp");
	await access.press("Enter");
	await memory.getByRole("textbox", { name: "说明", exact: true }).first().fill("只检索项目知识");
	picker = await openInlinePicker(page, "记忆库");
	await picker
		.getByRole("button", { name: /^选择记忆库 /, pressed: true })
		.first()
		.click();
	await picker.getByRole("button", { name: "取消", exact: true }).click();
	await expect(access.locator("..").getByText("只读", { exact: true })).toBeVisible();
	await expect(memory.getByRole("textbox", { name: "说明", exact: true }).first()).toHaveValue("只检索项目知识");
	await memory.getByRole("button", { name: "移除记忆 8", exact: true }).click();
	await expect(memory.getByRole("button", { name: "添加记忆库", exact: true })).toBeEnabled();
});

test("记忆导入：窄屏列表失败重试，未选择确认不增加默认空表单", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const state = await installInlineSelectionFixture(page, "memory-stores", 0);
	state.listError = true;
	await openInlineTemplate(page);
	const picker = await openInlinePicker(page, "记忆库");
	await expect(picker).toContainText("记忆库列表暂不可用");
	state.listError = false;
	await picker.getByRole("button", { name: "重试", exact: true }).click();
	await expect(picker).toContainText("暂无可选记忆库");
	await picker.getByRole("button", { name: "确认选择", exact: true }).click();
	await expect(inlineSection(page, "记忆库").getByRole("textbox", { name: "记忆库名称", exact: true })).toHaveValue("");
});
