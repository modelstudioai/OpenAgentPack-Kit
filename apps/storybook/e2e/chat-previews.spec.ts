import { expect, test } from "./fixtures.ts";

// 步骤默认收起；生命周期更新保留用户开合，停止后不被迟到的本地流覆盖。
test("Chat 预览：思考默认收起、手动选择保留，停止后保持中断", async ({ page }) => {
	await page.clock.install();
	await page.goto("/previews/chat/");
	const input = page.getByRole("textbox", { name: "消息输入", exact: true });
	const send = page.getByRole("button", { name: "发送", exact: true });
	const stop = page.getByRole("button", { name: "停止", exact: true });
	const reasoning = page.locator('details[aria-label="思考过程"]');
	await input.fill("演示完整轮次");
	await send.click();
	await expect(reasoning).toHaveCount(1);
	await expect(reasoning).toContainText("思考中");
	await expect(reasoning).toHaveJSProperty("open", false);
	await reasoning.locator("summary").click();
	await expect(reasoning).toHaveJSProperty("open", true);
	await expect(reasoning.locator(":scope > div").getByText("先确认问题的目标。", { exact: true })).toBeVisible();
	await expect(reasoning).toContainText("已思考", { timeout: 10_000 });
	await expect(reasoning).toHaveJSProperty("open", true);
	await expect(stop).toHaveCount(0, { timeout: 10_000 });
	await expect(page.getByText(/这是离线预览：没有 server/)).toBeVisible();

	await input.fill("演示中断轮次");
	await send.click();
	await expect(reasoning).toHaveCount(2);
	const interrupted = reasoning.last();
	await expect(interrupted).toContainText("思考中");
	await expect(interrupted).toHaveJSProperty("open", false);
	await stop.click();
	await expect(interrupted).toContainText("已中断");
	await expect(interrupted).toHaveJSProperty("open", false);
	await expect(stop).toHaveCount(0);
	// 仅推进浏览器时钟；不替换 React 状态，确保原先排队的流式任务已被取消。
	await page.clock.fastForward(10_000);
	await expect(interrupted).toContainText("已中断");
	await expect(interrupted).toHaveJSProperty("open", false);
	await expect(page.getByText(/这是离线预览：没有 server/)).toHaveCount(1);
});

// 同阶段正文更新不能重挂 details，或把用户刚刚手动选择的开合状态重置。
test("思考状态预览：追加内容保留手动开合，四种状态可真实切换", async ({ page }) => {
	await page.goto("/previews/tools/");
	const controls = page.getByRole("group", { name: "思考状态演示", exact: true });
	const reasoning = page.locator('details[aria-label="思考过程"]');
	const append = controls.getByRole("button", { name: "追加思考内容", exact: true });
	await expect(reasoning).toContainText("思考中");
	await expect(reasoning).toHaveJSProperty("open", false);
	await append.click();
	await expect(reasoning).toContainText("已补充 1 条核对说明。");
	await expect(reasoning).toHaveJSProperty("open", false);
	await reasoning.locator("summary").click();
	await expect(reasoning).toHaveJSProperty("open", true);

	await controls.getByRole("button", { name: "完成", exact: true }).click();
	await expect(reasoning).toContainText("已思考");
	await expect(reasoning).toHaveJSProperty("open", true);
	await append.click();
	await expect(reasoning).toContainText("已补充 2 条核对说明。");
	await expect(reasoning).toHaveJSProperty("open", true);
	for (const [action, label] of [
		["失败", "思考失败"],
		["中断", "已中断"],
	]) {
		await controls.getByRole("button", { name: "思考中", exact: true }).click();
		await expect(reasoning).toContainText("思考中");
		await expect(reasoning).toHaveJSProperty("open", true);
		await controls.getByRole("button", { name: action, exact: true }).click();
		await expect(reasoning).toContainText(label);
		await expect(reasoning).toHaveJSProperty("open", true);
	}
	await reasoning.locator("summary").click();
	await controls.getByRole("button", { name: "思考中", exact: true }).click();
	await expect(reasoning).toHaveJSProperty("open", false);
});

// 子 Agent 以流内嵌卡呈现；展开即拉取消息，失败可在卡内重试，主输入草稿始终保留。
test("Multi-Agent 预览：卡片展开加载与失败重试保留消息，主输入草稿保留", async ({ page }) => {
	await page.goto("/previews/multi-agent/");
	const input = page.getByRole("textbox", { name: "消息输入", exact: true });
	await input.fill("切换协作 Agent 后继续发送的草稿");
	const research = page.locator('details[aria-label="子 Agent 资料研究员"]');
	await expect(research).toContainText("整理资料并交叉验证来源");
	await research.locator("summary").click();
	await expect(research.getByText("正在加载 Agent 消息…", { exact: true })).toBeVisible();
	await expect(research.getByText(/^资料汇总完成：/)).toBeVisible();
	await research.getByRole("button", { name: "加载更早消息", exact: true }).click();
	await expect(research.getByText("较早记录：已确认任务范围和资料来源。", { exact: true })).toBeVisible();
	await expect(research.getByText(/^资料汇总完成：/)).toHaveCount(1);

	const review = page.locator('details[aria-label="子 Agent 方案审阅员"]');
	await review.locator("summary").click();
	await expect(review.getByText(/^方案检查完成：/)).toBeVisible();
	await page.getByRole("button", { name: "演示消息加载失败", exact: true }).click();
	await expect(review.getByRole("alert")).toContainText("消息加载失败");
	await expect(review.getByText(/^方案检查完成：/)).toBeVisible();
	await review.getByRole("button", { name: "重试", exact: true }).click();
	await expect(review.getByRole("alert")).toHaveCount(0);
	await expect(review.getByText("较早记录：已确认任务范围和资料来源。", { exact: true })).toBeVisible();
	await expect(review.getByRole("button", { name: "加载更早消息", exact: true })).toHaveCount(0);
	await expect(review.getByText(/^方案检查完成：/)).toHaveCount(1);
	await expect(input).toHaveText("切换协作 Agent 后继续发送的草稿");
});
