import { expect, test } from "./fixtures.ts";

// 历史消息的交互状态属于用户；其他消息到达不能重置用户已选择的源码视图。
test("Markdown：其他消息更新保留已完成图表的源码选择", async ({ page }) => {
	await page.goto("/e2e/fixtures/markdown.html");
	const diagram = page.getByRole("region", { name: "Mermaid 图表", exact: true });
	await expect(diagram.getByRole("img", { name: "Mermaid 图表", exact: true })).toBeVisible();
	const source = diagram.getByRole("button", { name: "源码", exact: true });
	await source.click();
	await expect(source).toHaveAttribute("aria-pressed", "true");
	await page.getByRole("button", { name: "追加其他消息", exact: true }).click();
	await expect(page.getByText("其他消息 1", { exact: true })).toBeVisible();
	await expect(source).toHaveAttribute("aria-pressed", "true");
	await expect(diagram.locator("code")).toHaveText("flowchart LR\nA-->B");
});

// 同一累计正文继续增长时，也不能覆盖用户当前选择。
test("Markdown：同消息继续流式正文保留源码选择", async ({ page }) => {
	await page.goto("/e2e/fixtures/markdown.html?streaming");
	const diagram = page.getByRole("region", { name: "Mermaid 图表", exact: true });
	const image = diagram.getByRole("img", { name: "Mermaid 图表", exact: true });
	await expect(image).toBeVisible();
	const source = diagram.getByRole("button", { name: "源码", exact: true });
	await source.click();
	await page.getByRole("button", { name: "继续流式正文", exact: true }).click();
	await expect(page.getByText("后续正文 1", { exact: true })).toBeVisible();
	await expect(source).toHaveAttribute("aria-pressed", "true");
	await expect(diagram.locator("code")).toHaveText("flowchart LR\nA-->B");
});

// 图表已渲染成功后，后续文字不能反复卸载图片，造成持续加载与闪烁。
test("Markdown：同消息继续流式正文保留已渲染图像", async ({ page }) => {
	await page.goto("/e2e/fixtures/markdown.html?streaming");
	const diagram = page.getByRole("region", { name: "Mermaid 图表", exact: true });
	const image = diagram.getByRole("img", { name: "Mermaid 图表", exact: true });
	await expect(image).toBeVisible();
	const originalImage = await image.elementHandle();
	const originalSource = await image.getAttribute("src");
	await page.getByRole("button", { name: "继续流式正文", exact: true }).click();
	await expect(page.getByText("后续正文 1", { exact: true })).toBeVisible();
	expect(await originalImage?.evaluate((element) => element.isConnected)).toBe(true);
	await expect(image).toHaveAttribute("src", originalSource as string);
});

// 正文的层级与代码原文属于用户可见合同；装饰、行号和窄屏布局不能改变它们。
test("正文与代码：语义层级、键盘横滚和带行号代码复制", async ({ page, isMobile }, testInfo) => {
	if (isMobile) await page.setViewportSize({ width: 320, height: 844 });
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async (text: string) => {
					sessionStorage.setItem("prose-code-copy", text);
				},
			},
		});
	});
	await page.goto("/e2e/fixtures/prose-code.html");
	const messages = page.getByRole("region", { name: "消息列表", exact: true });
	await expect(messages.getByRole("heading", { name: "客户端会话接入建议", level: 1 })).toBeVisible();
	await expect(messages.getByRole("heading", { name: "建立可靠的事件处理", level: 2 })).toBeVisible();
	await expect(messages.getByRole("heading", { name: "上线前的检查顺序", level: 3 })).toBeVisible();
	await expect(messages.getByText(/^建议将事件接收、消息展示和用户操作分开处理/)).toBeVisible();
	await expect(messages.locator("ul > li > ul")).toContainText("历史回放和实时消息可能交叉到达。");
	await expect(messages.locator("ol")).toHaveAttribute("start", "3");
	await expect(messages.getByRole("checkbox")).toHaveCount(2);
	await expect(messages.getByRole("checkbox").first()).toBeChecked();
	await expect(messages.getByRole("checkbox").first()).toBeDisabled();
	await expect(messages.getByRole("checkbox").last()).not.toBeChecked();
	await expect(messages.getByRole("checkbox").last()).toBeDisabled();
	await expect(messages.locator("blockquote")).toContainText("连接恢复不等于本轮执行完成。");
	const link = messages.getByRole("link", { name: "接入文档", exact: true });
	await expect(link).toHaveAttribute("href", "https://example.com/session-guide");
	await expect(link).toHaveAttribute("rel", "noreferrer noopener");
	await expect(messages.locator("p code").filter({ hasText: "SESSION_STREAM_CURSOR_AFTER_" })).toHaveText(
		`SESSION_STREAM_CURSOR_AFTER_${"abcdefghijklmnopqrstuvwxyz".repeat(6)}`,
	);
	await expect(messages.getByRole("region", { name: "代码块", exact: true }).locator("code")).toContainText(
		"type SessionState = {",
	);

	const code = page
		.getByRole("region", { name: "带行号的代码示例", exact: true })
		.getByRole("region", { name: "代码块", exact: true });
	const content = code.getByRole("region", { name: "代码内容", exact: true });
	const codeTitle = "TypeScript · 客户端会话游标存储与断线恢复示例 · 保留完整的工作区和会话命名空间";
	const title = code.getByTitle(codeTitle, { exact: true });
	const copy = code.getByRole("button", { name: "复制代码", exact: true });
	const source = [
		"type SessionRecord = {",
		"  sessionId: string;",
		"  cursor: string | null;",
		"};",
		"",
		"export function cursorStorageKey(record: SessionRecord): string {",
		`\tconst prefix = "${"SESSION_RECOVERY_CURSOR_NAMESPACE_".repeat(5)}";`,
		'\treturn [prefix, record.sessionId, record.cursor ?? "initial"].join(":");',
		"}",
		"",
	].join("\n");
	await expect(content.locator("code")).toHaveText(source);
	await expect(content.locator('[aria-hidden="true"]')).toHaveText("1\n2\n3\n4\n5\n6\n7\n8\n9\n10");
	await content.scrollIntoViewIfNeeded();
	await expect.poll(() => content.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
	await content.focus();
	await expect(content).toBeFocused();
	await page.keyboard.press("ArrowRight");
	await expect.poll(() => content.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
	await expect(title).toHaveText(codeTitle);
	const [titleBox, copyBox, codeBox] = await Promise.all([title.boundingBox(), copy.boundingBox(), code.boundingBox()]);
	if (!titleBox || !copyBox || !codeBox) throw new Error("代码标题和复制入口必须可见");
	expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(copyBox.x + 1);
	expect(copyBox.x + copyBox.width).toBeLessThanOrEqual(codeBox.x + codeBox.width + 1);
	await copy.click();
	await expect(code.getByRole("status")).toHaveText("已复制");
	expect(await page.evaluate(() => sessionStorage.getItem("prose-code-copy"))).toBe(source);

	for (const theme of ["light", "dark"]) {
		await page.locator("html").evaluate((element, value) => element.setAttribute("data-kit-theme", value), theme);
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
			.toBe(true);
		await expect.poll(() => messages.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
		await messages.screenshot({ path: testInfo.outputPath(`prose-${theme}.png`) });
		await content.evaluate((element) => {
			element.scrollLeft = 0;
		});
		await code.screenshot({ path: testInfo.outputPath(`code-${theme}.png`) });
	}
});
