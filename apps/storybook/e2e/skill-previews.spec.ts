import { expect, test } from "./fixtures.ts";

// 保护 contenteditable 的原子 chip、技能载荷与正文提交，避免只加文字说明而没有可操作示例。
test("Sender 技能预览：选择、整体退格与带技能提交", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/previews/sender/");
	const input = page.getByRole("textbox", { name: "消息输入", exact: true });
	const picker = page.getByRole("listbox", { name: "技能列表", exact: true });
	await input.fill("/");
	await expect(picker.getByRole("option", { name: /^summarize/ })).toBeVisible();
	await input.press("Enter");
	await expect(picker).toHaveCount(0);
	await expect(input.getByText("summarize", { exact: true })).toBeVisible();
	await input.press("Backspace");
	await expect(input).toHaveText("");
	await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
	await input.fill("/wri");
	await expect(picker.getByRole("option")).toHaveCount(1);
	await picker.getByRole("option", { name: /^writing/ }).click();
	await input.pressSequentially("整理周报");
	await page.getByRole("button", { name: "发送", exact: true }).click();
	await expect(page.getByRole("status").filter({ hasText: "onSubmit →" })).toHaveText(
		"onSubmit → /writing 整理周报（0 个附件）；技能：writing",
	);
	await expect(input).toHaveText("");
});

// 保护输入候选到主消息流的协议适配：已知 token 还原为 chip，预览不会调用业务 API。
test("Chat 技能预览：chip 单独发送并在用户消息原位还原", async ({ page }) => {
	await page.goto("/previews/chat/");
	const input = page.getByRole("textbox", { name: "消息输入", exact: true });
	await input.fill("/");
	await page.getByRole("option", { name: /^summarize/ }).click();
	await expect(input.getByText("summarize", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "发送", exact: true }).click();
	const messages = page.getByRole("region", { name: "消息列表", exact: true });
	await expect(messages.getByText("summarize", { exact: true })).toBeVisible();
	await expect(messages).not.toContainText("[使用 Skill:");
	await expect(input).toHaveText("");
	await page.getByRole("button", { name: "停止", exact: true }).click();
	await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0);
});
