import { expect, type Page } from "@playwright/test";

/** 管理端 antd Select 使用组合框与浮层选项，不是原生 select。 */
export async function selectConsoleOption(page: Page, label: string, option: string) {
	const select = page.getByRole("combobox", { name: label, exact: true });
	await select.click();
	const choice = page.locator(".ant-select-dropdown:visible").getByText(option, { exact: true });
	if (await select.isEditable()) {
		await select.fill(option);
		await expect(choice).toBeVisible();
		await select.press("Enter");
	} else await choice.click();
}

export function selectedConsoleOption(page: Page, label: string) {
	return page.locator(".ant-select").filter({ has: page.getByRole("combobox", { name: label, exact: true }) });
}
