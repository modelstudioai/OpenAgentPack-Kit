import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN } from "./helpers.ts";
import { inlineApi, leaveInlineTemplate, openInlinePicker, openInlineTemplate } from "./template-inline-helpers.ts";
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

test("管理端窄屏密钥详情：长变量名与域名完整换行，表头与正文保持对齐", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await installInlineSelectionFixture(page, "vaults", 1);
	const variable = `PROJECT_${"LONG_".repeat(20)}KEY`;
	const host = `${"service".repeat(8)}.${"edge".repeat(12)}.example.test`;
	await page.route(`${inlineApi}/api/admin/remote/vaults/resource_1`, (route) =>
		route.fulfill({
			json: {
				data: {
					vault_id: "resource_1",
					name: "长配置示例",
					credentials: [
						{ credential_id: "credential_long", name: "项目服务", secret_name: variable, allowed_hosts: [host] },
					],
				},
			},
		}),
	);
	await openInlineTemplate(page);
	const picker = await openInlinePicker(page, "密钥库");
	await picker.getByRole("button", { name: "查看详情", exact: true }).click();
	const detail = page.getByRole("dialog", { name: "密钥库详情", exact: true });
	const table = detail.getByRole("table", { name: "密钥名称、变量名和生效域名", exact: true });
	await expect(table.getByRole("cell", { name: variable, exact: true })).toBeVisible();
	await expect(table.getByRole("cell", { name: host, exact: true })).toBeVisible();
	await expect.poll(() => table.evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(390);
	const layout = await table.evaluate((element) => {
		const box = element.getBoundingClientRect();
		const headers = Array.from(element.querySelectorAll("thead th"));
		const cells = Array.from(element.querySelectorAll("tbody td"));
		return {
			right: box.right,
			left: box.left,
			overflow: element.scrollWidth - element.clientWidth,
			columnsAligned: cells.every((cell, index) => {
				const header = headers[index].getBoundingClientRect();
				const value = cell.getBoundingClientRect();
				return Math.abs(header.left - value.left) <= 1 && Math.abs(header.width - value.width) <= 1;
			}),
			textFits: cells.every((cell) => {
				const boundary = cell.getBoundingClientRect();
				const range = document.createRange();
				range.selectNodeContents(cell);
				return Array.from(range.getClientRects()).every(
					(rect) => rect.left >= boundary.left - 1 && rect.right <= boundary.right + 1,
				);
			}),
		};
	});
	expect(layout.left).toBeGreaterThanOrEqual(0);
	expect(layout.right).toBeLessThanOrEqual(390);
	expect(layout.overflow).toBeLessThanOrEqual(1);
	expect(layout.columnsAligned).toBe(true);
	expect(layout.textFits).toBe(true);
	await detail.getByRole("button", { name: "关闭", exact: true }).click();
	await picker.getByRole("button", { name: "取消", exact: true }).click();
});

test("管理端文件选择：名称与标识分列展示，长列表在抽屉内独立滚动", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await installInlineSelectionFixture(page, "files", 23);
	await openInlineTemplate(page);
	const picker = await openInlinePicker(page, "文件");
	const list = picker.getByRole("list", { name: "文件列表", exact: true });
	await expect(list.getByRole("listitem")).toHaveCount(23);
	const first = list.getByRole("button", { name: "选择文件 资料 1.txt（resource_1）", exact: true });
	const name = await first.getByText("资料 1.txt", { exact: true }).boundingBox();
	const id = await first.getByText("resource_1", { exact: true }).boundingBox();
	expect(name).not.toBeNull();
	expect(id).not.toBeNull();
	expect(Math.abs(name!.y - id!.y)).toBeLessThanOrEqual(4);
	expect(id!.x).toBeGreaterThan(name!.x + name!.width);
	const sizes = await list.evaluate((element) => ({
		viewport: element.clientHeight,
		content: element.scrollHeight,
		rowWidth: element.querySelector("button")!.getBoundingClientRect().width,
		width: element.clientWidth,
	}));
	expect(sizes.content).toBeGreaterThan(sizes.viewport);
	expect(sizes.rowWidth).toBeGreaterThanOrEqual(sizes.width - 1);
	await list.hover();
	await page.mouse.wheel(0, sizes.content);
	await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	await expect(picker.getByRole("button", { name: "确认选择", exact: true })).toBeInViewport();
	await picker.getByRole("button", { name: "取消", exact: true }).click();
});

test("管理端键盘导航：Tab 聚焦主按钮时保留可见焦点轮廓", async ({ page }) => {
	const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.searchParams.set("api", inlineApi);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
	const enter = page.getByRole("button", { name: "进入", exact: true });
	for (let index = 0; index < 4 && !(await enter.evaluate((element) => element === document.activeElement)); index++)
		await page.keyboard.press("Tab");
	await expect(enter).toBeFocused();
	const focus = await enter.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			visible: element.matches(":focus-visible"),
			width: Number.parseFloat(style.outlineWidth),
			style: style.outlineStyle,
			color: style.outlineColor,
		};
	});
	expect(focus.visible).toBe(true);
	expect(focus.width).toBeGreaterThan(0);
	expect(focus.style).not.toBe("none");
	expect(focus.color).not.toBe("rgba(0, 0, 0, 0)");
});
