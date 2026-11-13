import { expect, test } from "./fixtures.ts";

// 文档读者能查看可复制的完整示例，并在切换设备时保留当前演示选择。
test("Message 文档：源码可展开，设备切换保留布局选择", async ({ page }) => {
	await page.goto("/docs/components/general/message/");
	const preview = page
		.locator(".kit-preview")
		.filter({ has: page.locator('iframe[src="/previews/message-workspace/"]') });
	const frame = preview.frameLocator("iframe");
	const layout = frame.getByRole("combobox", { name: "消息布局", exact: true });
	await layout.selectOption("default");
	await preview.getByRole("button", { name: "源码", exact: true }).click();
	await expect(preview.getByLabel("组件示例源码")).toContainText("export function MessageExample()");
	await expect(preview.getByRole("button", { name: "复制源码", exact: true })).toBeVisible();
	await preview.getByRole("button", { name: "手机", exact: true }).click();
	await expect(layout).toHaveValue("default");
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(frame.getByText("请说明 **Message** 的用途。", { exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// 状态由公开 props 控制：流式追加可见，完成才显示复制，失败按消息角色呈现。
test("Message 状态演示：追加、完成、失败和中断", async ({ page }) => {
	await page.goto("/previews/message-status/");
	const status = page.getByRole("combobox", { name: "消息状态", exact: true });
	await expect(page.getByText("生成中…", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "复制", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "追加内容", exact: true }).click();
	await expect(page.getByText(/正在整理消息内容。\s*新增一段内容。/)).toBeVisible();
	await status.selectOption("done");
	await expect(page.getByText("生成中…", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "复制", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "追加内容", exact: true })).toBeDisabled();
	await status.selectOption("failed");
	await expect(page.getByText("生成失败", { exact: true })).toBeVisible();
	await page.getByRole("combobox", { name: "角色", exact: true }).selectOption("user");
	await expect(page.getByText("发送失败", { exact: true })).toBeVisible();
	await status.selectOption("pending");
	await expect(page.getByText("发送中…", { exact: true })).toBeVisible();
	await status.selectOption("interrupted");
	await expect(page.getByText("已中断", { exact: true })).toBeVisible();
});

// 用户可通过键盘阅读执行详情，文件与复制把真实回调参数交给本地演示宿主。
test("Message 内容演示：展开执行详情，区分文件预览、下载和原文复制", async ({ page }) => {
	await page.goto("/previews/message-parts/");
	const execution = page.locator('details[aria-label="执行过程"]');
	await expect(execution).toHaveJSProperty("open", false);
	await execution.locator(":scope > summary").focus();
	await page.keyboard.press("Enter");
	const reasoning = execution.locator('details[aria-label="思考过程"]');
	await expect(reasoning).toHaveJSProperty("open", false);
	await reasoning.locator("summary").click();
	await expect(reasoning.locator(":scope > div")).toContainText("先读取数据，再汇总关键指标。");
	const tool = execution.locator("details").filter({ hasText: "输入参数" });
	await tool.locator("summary").click();
	await expect(tool.getByText("输入参数", { exact: true })).toBeVisible();
	await expect(tool.getByText("执行结果", { exact: true })).toBeVisible();

	await page.goto("/previews/message-files/");
	await expect(page.getByText("data.csv", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: /^(打开|下载) data\.csv$/ })).toHaveCount(0);
	await page.getByRole("button", { name: "打开 weekly-report.md", exact: true }).click();
	await expect(page.getByRole("status").filter({ hasText: "打开文件：file-report（text/markdown）" })).toBeVisible();
	await page.getByRole("button", { name: "下载 weekly-report.md", exact: true }).click();
	await expect(page.getByRole("status").filter({ hasText: "下载文件：file-report" })).toBeVisible();
	await page.getByRole("button", { name: "复制", exact: true }).click();
	await expect(page.getByRole("status").filter({ hasText: "复制原文：" })).toHaveText(
		"复制原文：周报已生成。\n\n**要点**：本周会话量增长 12%。",
	);
});

// 名单只控制已知 token 的还原，未知技能内容不能静默丢失。
test("Message 技能演示：已知技能还原，未知技能保留原文", async ({ page }) => {
	await page.goto("/previews/message-skills/");
	await expect(page.getByText("summarize", { exact: true })).toBeVisible();
	await expect(page.getByText(/\[使用 Skill:unknown\]/)).toBeVisible();
	await page.getByRole("checkbox", { name: "提供 summarize 技能名单", exact: true }).uncheck();
	await expect(page.getByText("summarize", { exact: true })).toHaveCount(0);
	await expect(page.getByText(/\[使用 Skill:summarize\].*\[使用 Skill:unknown\]/)).toBeVisible();
});
