import type { Page } from "@playwright/test";
import { expect } from "./fixtures.ts";
import { ADMIN_TOKEN } from "./helpers.ts";

export async function openTemplateAgentPicker(page: Page) {
	const dialog = page.getByRole("dialog", { name: "选择配置", exact: true });
	if (!(await dialog.isVisible())) {
		await page
			.getByRole("region", { name: "基础配置", exact: true })
			.getByRole("button", { name: "导入现有配置", exact: true })
			.click();
	}
	await expect(dialog).toBeVisible();
	return dialog;
}

export async function closeTemplateAgentPicker(page: Page) {
	const dialog = page.getByRole("dialog", { name: "选择配置", exact: true });
	await dialog.getByRole("button", { name: "关闭", exact: true }).click();
	await expect(dialog).toHaveCount(0);
}

export async function confirmTemplateAgentSelection(page: Page) {
	const dialog = page.getByRole("dialog", { name: /^智能体详情(?:\s|$)/ });
	await dialog.getByRole("button", { name: "确认选择", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByRole("dialog", { name: "选择配置", exact: true })).toHaveCount(0);
}

/** 资源配置场景所需的最小 Agent 配置；详情字段和错误恢复由 template-create 单独覆盖。 */
export async function installTemplateAgentDetailFixture(page: Page, apiBase: string) {
	await page.route(`${apiBase}/api/admin/remote/agents/*/versions/*`, (route) => {
		const request = route.request();
		const match = /\/remote\/agents\/([^/]+)\/versions\/(\d+)$/.exec(new URL(request.url()).pathname);
		expect(request.method()).toBe("GET");
		expect(request.headers().authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
		expect(match).not.toBeNull();
		return route.fulfill({
			json: { data: { agent_id: match![1], name: match![1], version: Number(match![2]), configuration: {} } },
		});
	});
}
