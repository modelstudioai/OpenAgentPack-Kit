import { expect, test } from "./fixtures.ts";
import {
	inlineNext,
	inlineSection,
	leaveInlineTemplate,
	openInlinePicker,
	openInlineTemplate,
} from "./template-inline-helpers.ts";
import { installInlineSelectionFixture } from "./template-inline-selection-fixture.ts";

test.afterEach(async ({ page }) => leaveInlineTemplate(page));

test("环境导入：搜索后先看详情，取消不选择，确认后回填，未保存改名同步摘要", async ({ page }) => {
	const state = await installInlineSelectionFixture(page, "environments");
	await openInlineTemplate(page);
	expect(state.requests).toEqual([]);
	let picker = await openInlinePicker(page, "环境");
	await expect(picker.getByRole("button", { name: /^选择环境 / })).toHaveCount(23);
	await picker.getByRole("searchbox", { name: "搜索环境", exact: true }).fill("resource_23");
	await picker.getByRole("button", { name: "选择环境 资源 23（resource_23）", exact: true }).click();
	const detail = page.getByRole("dialog", { name: "环境详情", exact: true });
	await expect(detail).toContainText("example.test");
	await detail.getByRole("button", { name: "关闭环境详情", exact: true }).click();
	await picker.getByRole("button", { name: "关闭选择配置", exact: true }).click();
	const environment = inlineSection(page, "环境");
	await expect(environment.getByRole("textbox", { name: "环境名称", exact: true })).toHaveValue("");
	picker = await openInlinePicker(page, "环境");
	await expect(picker.getByRole("searchbox", { name: "搜索环境", exact: true })).toHaveValue("resource_23");
	await picker.getByRole("button", { name: "选择环境 资源 23（resource_23）", exact: true }).press("Enter");
	await detail.getByRole("button", { name: "确认选择", exact: true }).click();
	await expect(picker).toHaveCount(0);
	await expect(environment.getByRole("textbox", { name: "环境名称", exact: true })).toHaveValue("资源 23");
	await environment.getByRole("textbox", { name: "环境名称", exact: true }).fill("改名后的环境");
	await expect(inlineSection(page, "已选配置预览")).toContainText("改名后的环境");
	await environment.getByRole("button", { name: "清空", exact: true }).click();
	await expect(inlineSection(page, "已选配置预览")).toContainText("使用智能体默认环境");
});

test("环境导入：窄屏列表和详情失败可重试，加载不能确认，关闭取消迟到响应", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const state = await installInlineSelectionFixture(page, "environments", 2);
	state.listError = true;
	await openInlineTemplate(page);
	const picker = await openInlinePicker(page, "环境");
	await expect(picker).toContainText("环境列表暂不可用");
	state.listError = false;
	await picker.getByRole("button", { name: "重试", exact: true }).click();
	await picker.getByRole("button", { name: "选择环境 资源 1（resource_1）", exact: true }).click();
	const detail = page.getByRole("dialog", { name: "环境详情", exact: true });
	await expect(detail.getByRole("button", { name: "确认选择", exact: true })).toBeEnabled();
	await detail.getByRole("button", { name: "关闭环境详情", exact: true }).click();
	const gate = Promise.withResolvers<void>();
	state.detailGate = gate.promise;
	await picker.getByRole("button", { name: "选择环境 资源 2（resource_2）", exact: true }).click();
	await expect(detail.getByRole("button", { name: "确认选择", exact: true })).toBeDisabled();
	await detail.getByRole("button", { name: "关闭环境详情", exact: true }).click();
	gate.resolve();
	state.detailGate = undefined;
	state.detailError = true;
	await picker.getByRole("button", { name: "选择环境 资源 2（resource_2）", exact: true }).click();
	await expect(detail).toContainText("环境详情暂不可用");
	state.detailError = false;
	await detail.getByRole("button", { name: "重试", exact: true }).click();
	await detail.getByRole("button", { name: "确认选择", exact: true }).click();
	await expect(inlineSection(page, "环境").getByRole("textbox", { name: "环境名称", exact: true })).toHaveValue(
		"资源 2",
	);
	await expect(inlineNext(page)).toBeEnabled();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
