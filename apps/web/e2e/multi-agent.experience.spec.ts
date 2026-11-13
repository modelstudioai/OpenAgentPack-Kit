import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const stats = async (page: Page) => JSON.parse((await page.getByTestId("stats").textContent()) ?? "{}");
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const mainTab = (page: Page) => page.getByRole("tab", { name: "主 Agent", exact: true });
const childTab = (page: Page) => page.getByRole("tab", { name: /资料研究员/ }).first();
const messages = (page: Page) => page.getByRole("region", { name: "消息列表", exact: true });
const scrollTo = async (list: Locator, top: number) => {
	await list.evaluate((element, value) => {
		element.scrollTop = value;
		element.dispatchEvent(new Event("scroll"));
	}, top);
};
const scrollTop = (list: Locator) => list.evaluate((element) => element.scrollTop);

for (const mode of ["normalized", "raw"] as const) {
	// 同一公开组合在两类自建后端工作；没有 KitProvider，也不经过 Kit Server。
	test(`${mode} 自建 Provider：原生 Chat 多 Agent、历史分页与独立阅读位置`, async ({ page, isMobile }, testInfo) => {
		const unexpected: string[] = [];
		const errors: string[] = [];
		page.on("request", (request) => {
			if (request.url().includes("/api/kit/")) unexpected.push(request.url());
		});
		page.on("pageerror", (error) => errors.push(error.message));
		if (isMobile) await page.setViewportSize({ width: 320, height: 844 });
		await page.goto(`/e2e/fixtures/multi-agent.html${mode === "raw" ? "?raw=1" : ""}`);
		await expect(page.getByTestId("state")).toContainText('"connected":true');
		await expect(page.getByRole("tab")).toHaveCount(4);
		await expect(mainTab(page)).toHaveAttribute("aria-selected", "true");
		await page.getByRole("textbox", { name: "消息输入" }).fill("未发送的主 Agent 草稿");
		await scrollTo(messages(page), 120);
		const mainScroll = await scrollTop(messages(page));
		expect(mainScroll).toBeGreaterThan(0);

		await button(page, "延迟历史").click();
		await childTab(page).click();
		await expect(page.getByText("正在加载 Agent 消息…", { exact: true })).toBeVisible();
		await expect(page.getByRole("textbox", { name: "消息输入" })).toHaveCount(0);
		await expect(page.getByRole("tabpanel").getByText("子 Agent 消息仅供查看", { exact: true })).toBeVisible();
		await button(page, "子 Agent 实时消息").click();
		await expect(messages(page).getByText("实时研究结论", { exact: true })).toBeVisible();
		await button(page, "释放历史").click();
		await expect(page.getByText("正在加载 Agent 消息…", { exact: true })).toBeHidden();
		await expect(messages(page).getByText("实时研究结论", { exact: true })).toBeVisible();
		await expect(messages(page).getByText("研究记录 25", { exact: true })).toHaveCount(1);
		await scrollTo(messages(page), 90);
		const childScroll = await scrollTop(messages(page));

		await mainTab(page).click();
		await expect(page.getByRole("textbox", { name: "消息输入" })).toHaveValue("未发送的主 Agent 草稿");
		await expect.poll(() => scrollTop(messages(page))).toBe(mainScroll);
		await childTab(page).click();
		await expect(page.getByText("正在加载 Agent 消息…", { exact: true })).toBeHidden();
		await expect.poll(() => scrollTop(messages(page))).toBe(childScroll);
		await scrollTo(messages(page), 0);
		const anchor = messages(page).getByText("研究记录 25", { exact: true });
		const before = await anchor.boundingBox();
		await button(page, "下次历史失败").click();
		await button(page, "加载更早消息").click();
		await expect(button(page, "重试加载消息")).toBeVisible();
		await button(page, "重试加载消息").click();
		await expect(messages(page).getByText("研究记录 1", { exact: true })).toHaveCount(1);
		expect((await stats(page)).history.slice(-2)).toEqual(["sthr_research/older", "sthr_research/older"]);
		const after = await anchor.boundingBox();
		expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
		await expect(button(page, "加载更早消息")).toHaveCount(0);
		await mainTab(page).click();
		await childTab(page).click();
		await expect(page.getByText("正在加载 Agent 消息…", { exact: true })).toBeHidden();
		await expect(messages(page).getByText("研究记录 1", { exact: true })).toHaveCount(1);

		// 同一个 Agent 的两次委托有独立页签和消息。
		await page
			.getByRole("tab", { name: /资料研究员/ })
			.nth(1)
			.click();
		await expect(messages(page).getByText("复核工作已完成", { exact: true })).toBeVisible();
		await expect(messages(page).getByText("研究记录 25", { exact: true })).toHaveCount(0);
		await page.keyboard.press("Home");
		await expect(mainTab(page)).toBeFocused();
		await expect(mainTab(page)).toHaveAttribute("aria-selected", "true");
		await page.keyboard.press("End");
		await expect(page.getByRole("tab", { name: /事实核验与引用整理 Agent/ })).toHaveAttribute("aria-selected", "true");
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
			.toBe(true);
		if (isMobile)
			await expect
				.poll(() => page.getByRole("tablist").evaluate((element) => element.scrollWidth > element.clientWidth))
				.toBe(true);

		// 审批仍属于主 Agent，子页能回到审批入口；历史错误只重试当前线程。
		await button(page, "显示审批").click();
		await button(page, "查看主 Agent 审批").click();
		await expect(mainTab(page)).toBeFocused();
		await expect(page.getByText("主 Agent 工具审批信息", { exact: true })).toBeVisible();
		await button(page, "下次历史失败").click();
		await childTab(page).click();
		await expect(button(page, "重试加载消息")).toBeVisible();
		await button(page, "重试加载消息").click();
		await expect(button(page, "重试加载消息")).toHaveCount(0);
		await expect(messages(page).getByText("实时研究结论", { exact: true })).toHaveCount(1);
		expect((await stats(page)).opens).toBe(1);
		if (mode === "raw") {
			const paths = (await stats(page)).paths as string[];
			expect(paths.some((path) => path.startsWith("/api/v1/agentstudio/sessions/multi-agent-session/threads?"))).toBe(
				true,
			);
			expect(paths.some((path) => path.includes("/threads/sthr_research/events?") && path.includes("page=older"))).toBe(
				true,
			);
		}
		await page.screenshot({ path: testInfo.outputPath(`multi-agent-${mode}.png`) });
		await button(page, "下次停止失败").click();
		await button(page, "停止执行").click();
		await expect(page.getByRole("alert")).toContainText("停止失败：");
		await button(page, "停止执行").click();
		await expect.poll(async () => (await stats(page)).stops).toBe(1);
		await expect(page.getByTestId("state")).toContainText('"phase":"idle"');
		expect(unexpected).toEqual([]);
		expect(errors).toEqual([]);
	});
}

test("normalized Provider：思考折叠生命周期与手动展开保持", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/e2e/fixtures/multi-agent.html?reasoning=1");
	await expect(page.getByTestId("state")).toContainText('"connected":true');
	await expect(mainTab(page)).toHaveAttribute("aria-selected", "true");
	await button(page, "开始思考").click();
	const reasoning = messages(page).locator('details[aria-label="思考过程"]');
	const content = reasoning.getByText("先核对思考生命周期。", { exact: true });
	await expect(reasoning).toContainText("思考中");
	await expect(reasoning).toHaveJSProperty("open", false);
	await expect(content).toBeHidden();

	await button(page, "完成思考").click();
	await expect(reasoning).toContainText("已思考");
	await expect(reasoning).toHaveJSProperty("open", false);
	await expect(content).toBeHidden();
	await expect(messages(page).getByText("正文第一段。", { exact: true })).toBeVisible();
	// 正文出现说明该轮执行已结束，容器收起；展开容器再打开思考过程
	const run = messages(page).locator('details[aria-label="执行过程"]').first();
	await expect(run).toHaveJSProperty("open", false);
	await run.locator("> summary").click();
	await expect(run).toHaveJSProperty("open", true);
	await reasoning.locator("summary").click();
	await expect(reasoning).toHaveJSProperty("open", true);
	await expect(content).toBeVisible();

	await button(page, "更新正文").click();
	await expect(messages(page).getByText("正文第一段，正文第二段。", { exact: true })).toBeVisible();
	await expect(reasoning).toHaveJSProperty("open", true);
	await expect(content).toBeVisible();
	await button(page, "停止").click();
	await expect(page.getByTestId("state")).toContainText('"phase":"idle"');
	await expect(reasoning).toHaveJSProperty("open", true);
	await expect(content).toBeVisible();
	expect((await stats(page)).stops).toBe(1);
	expect(errors).toEqual([]);
});

test("raw event_start：生成中展示正文，最终快照替换增量且由独立 idle 完成轮次", async ({ page }, testInfo) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/e2e/fixtures/multi-agent.html?raw=1&event-start=1");
	await expect(page.getByTestId("state")).toContainText('"connected":true');
	await expect(mainTab(page)).toHaveAttribute("aria-selected", "true");
	await button(page, "开始原始流").click();
	const reasoning = messages(page).locator('details[aria-label="思考过程"]');
	await expect(reasoning).toContainText("思考中");
	await expect(reasoning).toHaveJSProperty("open", false);
	await expect(reasoning.getByText("先核对事件流。", { exact: true })).toBeHidden();

	await button(page, "发送正文增量").click();
	await expect(messages(page).getByText("正文第一段，", { exact: true })).toBeVisible();
	await expect(reasoning).toContainText("已思考");
	await expect(reasoning).toHaveJSProperty("open", false);
	await expect(reasoning.getByText("先核对事件流。", { exact: true })).toBeHidden();
	// 正文出现说明该轮执行已结束，容器收起；展开容器再打开思考过程
	const run = messages(page).locator('details[aria-label="执行过程"]').first();
	await expect(run).toHaveJSProperty("open", false);
	await run.locator("> summary").click();
	await expect(run).toHaveJSProperty("open", true);
	await reasoning.locator("summary").click();
	await expect(reasoning).toHaveJSProperty("open", true);
	await expect(reasoning.getByText("先核对事件流。", { exact: true })).toBeVisible();
	await expect(messages(page).getByText("处理中")).toBeVisible();
	await expect(page.getByTestId("state")).toContainText('"phase":"running"');
	await expect(messages(page).getByText(/未识别内容：/)).toHaveCount(0);

	await button(page, "追加正文增量").click();
	const body = messages(page).getByText("正文第一段，正文第二段。", { exact: true });
	await expect(body).toBeVisible();
	await expect(reasoning).toHaveJSProperty("open", true);
	await expect(messages(page).getByText("处理中")).toBeVisible();
	await button(page, "发送最终快照").click();
	await expect(body).toHaveCount(1);
	await expect(reasoning.getByText("先核对事件流。", { exact: true })).toHaveCount(1);
	await expect(reasoning).toHaveJSProperty("open", true);
	// 完整 message 只是消息完成；独立 session_status idle 才能结束执行。
	await expect(page.getByTestId("state")).toContainText('"phase":"running"');
	await button(page, "结束原始轮次").click();
	await expect(page.getByTestId("state")).toContainText('"phase":"idle"');
	await expect(page.getByTestId("state")).toContainText('"connected":true');
	await expect(messages(page).getByText("处理中")).toHaveCount(0);
	await expect(body).toHaveCount(1);
	await expect(reasoning).toHaveJSProperty("open", true);
	await expect(messages(page).getByText(/未识别内容：/)).toHaveCount(0);
	expect((await stats(page)).opens).toBe(1);
	expect(errors).toEqual([]);
	await page.screenshot({ path: testInfo.outputPath("raw-event-start.png") });
});

test("旧五方法 Provider 显示已收到的子 Agent，并明确历史查询不可用", async ({ page }) => {
	await page.goto("/e2e/fixtures/multi-agent.html?legacy=1");
	await expect(page.getByTestId("state")).toContainText('"connected":true');
	await childTab(page).click();
	await expect(page.getByText("仅显示本次连接收到的消息，后端未提供线程历史查询。", { exact: true })).toBeVisible();
	await expect(button(page, "加载更早消息")).toHaveCount(0);
	await button(page, "子 Agent 实时消息").click();
	await expect(messages(page).getByText("实时研究结论", { exact: true })).toBeVisible();
	expect((await stats(page)).history).toEqual([]);
	await button(page, "返回主 Agent 发送消息").click();
	await expect(mainTab(page)).toHaveAttribute("aria-selected", "true");
});
