import { expect, test } from "./fixtures.ts";

// 思考随生命周期展开/收起；同阶段累计更新保留手动选择，不重排正文或吞掉 false/0/null。
test("执行过程：思考生命周期、键盘切换与安全结果", async ({ page, isMobile }, testInfo) => {
	if (isMobile) await page.setViewportSize({ width: 320, height: 844 });
	await page.goto("/e2e/fixtures/execution.html");
	const messages = page.getByRole("region", { name: "消息列表", exact: true });
	// CSS 定位不依赖可见性：容器收起后内部卡片仍在 DOM，open 属性可继续断言
	const reasoning = messages.locator('details[aria-label="思考过程"]');
	const lookupName =
		"finance_workflow__verify_monthly_expense_settlement_references_and_cross_department_approval_records";
	const lookup = messages.locator(`details[aria-label="工具调用 ${lookupName}"]`);
	const failure = messages.locator('details[aria-label="工具调用 读取审批记录"]');
	const originalNodes = await Promise.all([reasoning.elementHandle(), lookup.elementHandle()]);
	const reasoningText = reasoning.locator("summary ~ div").getByText(/^先核对结算单号，再检查审批结果。/);
	const failedOutput = [
		"审批服务暂时不可用，请保留结算单号后重试。",
		'<script>alert("这段日志只能作为文本显示")</script>',
		"追踪编号：EXPENSE_APPROVAL_LOOKUP_20261027_CROSS_DEPARTMENT_COLLABORATION_MONTHLY_SETTLEMENT_REFERENCE_ARCHIVE_PENDING_RECONCILIATION_RETRY",
	].join("\n");
	const assertOrderAndWidth = async () => {
		for (const node of originalNodes) expect(await node?.evaluate((element) => element.isConnected)).toBe(true);
		const ordered = [
			messages.getByText("我会先检查结算记录，再确认是否有遗漏的审批。", { exact: true }),
			reasoning.locator("summary"),
			messages.getByText("先查询这笔费用是否还需要补充材料。", { exact: true }),
			lookup.locator("summary"),
			messages.getByText("接着读取审批记录，查询异常会单独保留。", { exact: true }),
			failure.locator("summary"),
			messages.getByText(/^(已有结果会直接展示|核对完成：费用无需补充材料)/),
		];
		const boxes = await Promise.all(ordered.map((part) => part.boundingBox()));
		for (let index = 0; index < boxes.length; index += 1) {
			const box = boxes[index];
			if (!box) throw new Error("正文和执行摘要必须始终可见");
			if (index > 0) expect(box.y).toBeGreaterThan(boxes[index - 1]?.y ?? 0);
		}
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
			.toBe(true);
		await expect.poll(() => messages.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
	};

	// 出错容器的执行已被正文终结，流式期间也默认收起；先展开，让失败卡片的初始收起状态可测
	const runs = messages.getByRole("group", { name: "执行过程", exact: true });
	await expect(runs).toHaveCount(3);
	await expect(runs.nth(2)).toHaveJSProperty("open", false);
	await runs.nth(2).locator("> summary").click();
	await expect(runs.nth(2)).toHaveJSProperty("open", true);

	// 思考默认收起、同一行露预览；流式期间容器整体展开，但思考行本身收起
	await expect(reasoning).toHaveJSProperty("open", false);
	for (const details of [lookup, failure]) await expect(details).toHaveJSProperty("open", false);
	await expect(reasoning.locator("summary")).toContainText("思考中");
	await expect(lookup.locator("summary")).toContainText("执行中");
	await expect(failure.locator("summary")).toContainText("执行失败");
	await expect(reasoningText).toBeHidden();
	await expect(lookup.locator("pre")).toHaveText(["0"]);
	await expect(lookup.locator("pre")).toBeHidden();
	await expect(failure.locator("pre")).toHaveText(["null", failedOutput]);
	await expect(failure.locator("pre").last()).toBeHidden();
	await assertOrderAndWidth();

	await reasoning.locator("summary").focus();
	await page.keyboard.press("Enter");
	await expect(reasoning).toHaveJSProperty("open", true);
	await expect(reasoningText).toBeVisible();
	await page.getByRole("button", { name: "继续流式更新", exact: true }).click();
	await expect(reasoningText).toContainText("已确认结算单号有效，正在读取审批状态。");
	// 无 open 受控属性后由原生 details 保留用户展开状态；流式更新不改变它
	await expect(reasoning).toHaveJSProperty("open", true);
	await expect(lookup).toHaveJSProperty("open", false);
	await expect(lookup.locator("pre")).toHaveText(["0", "false"]);
	await assertOrderAndWidth();
	await reasoning.locator("summary").focus();
	await page.keyboard.press("Enter");
	await expect(reasoning).toHaveJSProperty("open", false);
	await expect(reasoningText).toBeHidden();

	for (const details of [lookup, failure]) {
		await details.locator("summary").focus();
		await page.keyboard.press("Space");
		await expect(details).toHaveJSProperty("open", true);
		await expect(details.getByText("输入参数", { exact: true })).toBeVisible();
		await expect(details.getByText("执行结果", { exact: true })).toBeVisible();
	}
	await expect(lookup.locator("pre").first()).toBeVisible();
	await expect(lookup.locator("pre").last()).toBeVisible();
	await expect(failure.locator("pre").first()).toBeVisible();
	expect(await failure.locator("pre").last().textContent()).toBe(failedOutput);
	await expect(failure.locator("script")).toHaveCount(0);
	await page.getByRole("button", { name: "完成执行", exact: true }).click();
	await expect(reasoning.locator("summary")).toContainText("已思考");
	await expect(lookup.locator("summary")).toContainText("已完成");
	await expect(reasoning).toHaveJSProperty("open", false);
	await expect(reasoningText).toBeHidden();
	for (const details of [lookup, failure]) await expect(details).toHaveJSProperty("open", true);
	await expect(reasoningText).toContainText("已整理可以确认的结果，失败的查询保留重试信息。");
	await expect(lookup.locator("pre")).toHaveText(["0", "false"]);
	// 消息完成后运行中的容器收起；手动展开过的出错组保留用户选择。
	await expect(runs.nth(0)).toHaveJSProperty("open", false);
	await expect(runs.nth(1)).toHaveJSProperty("open", false);
	await expect(runs.nth(2)).toHaveJSProperty("open", true);
	for (const run of [runs.nth(0), runs.nth(1)]) {
		await run.locator("> summary").click();
		await expect(run).toHaveJSProperty("open", true);
	}
	await assertOrderAndWidth();
	await reasoning.locator("summary").focus();
	await page.keyboard.press("Enter");
	await expect(reasoning).toHaveJSProperty("open", true);
	await expect(reasoningText).toBeVisible();

	for (const theme of ["light", "dark"]) {
		await page.locator("html").evaluate((element, value) => element.setAttribute("data-kit-theme", value), theme);
		await assertOrderAndWidth();
		await messages.screenshot({ path: testInfo.outputPath(`execution-expanded-${theme}.png`) });
	}
	for (const details of [reasoning, lookup]) {
		await details.locator("summary").focus();
		await page.keyboard.press("Enter");
		await expect(details).toHaveJSProperty("open", false);
	}
	await page.getByRole("button", { name: "补充结论", exact: true }).click();
	await expect(messages.getByText("补充说明：重试前请保留完整的追踪编号。", { exact: true })).toBeVisible();
	await expect(reasoning).toHaveJSProperty("open", false);
	await expect(lookup).toHaveJSProperty("open", false);
	await expect(failure).toHaveJSProperty("open", true);
	await expect(reasoningText).toBeHidden();
	await expect(lookup.locator("pre").last()).toBeHidden();
	await assertOrderAndWidth();
});
