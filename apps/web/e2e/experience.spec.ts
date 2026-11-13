import { expect, test } from "./fixtures.ts";
import { newSession, openSessionList, seedListedAgent } from "./helpers.ts";

test.beforeEach(async ({ request }, testInfo) => {
	test.skip(testInfo.project.name === "mobile", "移动端本轮不做：恢复随移动端适配批次");
	await seedListedAgent(request);
});

// 全局侧栏常驻所有视图（品牌/新聊天/广场/会话目录/账号）；页头只属于聊天视图。
test("体验外壳：侧栏常驻广场与聊天，usage 深链可达且不溢出", async ({ page, baseURL }) => {
	const apiBase = new URL(baseURL as string).origin;
	const assertPageFits = async () => {
		expect(new URL(page.url()).searchParams.get("api")).toBe(apiBase);
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
			.toBe(true);
	};
	// 广场（默认首页）：侧栏可见且广场导航处于选中态；桌面无抽屉开关。
	await page.goto(`/?api=${encodeURIComponent(apiBase)}`);
	await expect(page.getByRole("heading", { name: "Agent 广场", exact: true })).toBeVisible();
	const sidebar = page.getByTestId("experience-sidebar");
	await expect(sidebar).toBeVisible();
	await expect(sidebar.getByTestId("brand-name")).toContainText(/\S/);
	await expect(sidebar.getByTestId("brand-logo").or(sidebar.getByTestId("brand-logo-fallback"))).toBeVisible();
	await expect(sidebar).not.toContainText("员工端");
	await expect(page.getByTestId("sidebar-nav-plaza")).toHaveAttribute("aria-current", "page");
	await expect(page.getByTestId("sidebar-new-chat")).toBeVisible();
	await expect(page.getByRole("button", { name: "打开导航菜单", exact: true })).toHaveCount(0);
	await assertPageFits();
	// 点卡片「开始体验」→ 聊天视图：侧栏保持，页头出现「返回广场」，无用量导航残留。
	await page.getByTestId("plaza-search").fill("e2e-agent");
	await page.getByTestId("plaza-card-e2e-agent").getByRole("button", { name: "开始体验", exact: true }).click();
	await expect(page).toHaveURL(/agent=e2e-agent/);
	await expect(page.locator("main > header")).toContainText("E2E 助手");
	await expect(page.getByLabel("消息输入")).toBeVisible();
	await expect(sidebar).toBeVisible();
	await expect(page.getByTestId("nav-plaza")).toBeVisible();
	await expect(page.getByTestId("nav-usage")).toHaveCount(0);
	await assertPageFits();
	// 页头返回广场 → 广场选中态回归。
	await page.getByTestId("nav-plaza").click();
	await expect(page.getByRole("heading", { name: "Agent 广场", exact: true })).toBeVisible();
	await expect(page.getByTestId("sidebar-nav-plaza")).toHaveAttribute("aria-current", "page");
	await assertPageFits();
	// usage 深链仍可达（侧栏同样常驻），页面不溢出。
	await page.goto(`/?view=usage&api=${encodeURIComponent(apiBase)}`);
	await expect(page.getByTestId("usage-meter")).toBeVisible();
	await expect(sidebar).toBeVisible();
	await assertPageFits();
});

// 长名称和不可断行错误不能遮挡窄屏导航、Agent 切换或完整状态信息。
test("聊天页头：长名称与长错误保持可操作且不溢出", async ({ page, isMobile }, testInfo) => {
	if (isMobile) await page.setViewportSize({ width: 320, height: 844 });
	await page.goto("/e2e/fixtures/agent-header.html");
	const header = page.locator("header");
	const menu = header.getByRole("button", { name: "打开导航菜单", exact: true });
	const picker = header.getByRole("combobox", { name: "切换 Agent", exact: true });
	const status = header.getByRole("status");
	const fullError = `连接异常：无法建立会话流：UPSTREAM_CONNECTION_LOST_${"abcdef0123456789".repeat(16)}`;
	await expect(menu).toBeVisible();
	await expect(picker).toHaveValue("writer-long");
	await expect(status).toHaveText(fullError);
	await expect(status).toHaveAttribute("title", fullError);

	const assertHeaderFits = async () => {
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
			.toBe(true);
		await expect.poll(() => header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
		const [headerBox, menuBox, pickerBox, statusBox] = await Promise.all([
			header.boundingBox(),
			menu.boundingBox(),
			picker.boundingBox(),
			status.boundingBox(),
		]);
		if (!headerBox || !menuBox || !pickerBox || !statusBox) throw new Error("页头交互区域必须可见");
		expect(menuBox.width).toBeGreaterThan(0);
		expect(pickerBox.width).toBeGreaterThan(0);
		expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(pickerBox.x + 1);
		expect(pickerBox.x + pickerBox.width).toBeLessThanOrEqual(statusBox.x + 1);
		expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 1);
	};
	await assertHeaderFits();
	await menu.focus();
	await expect(menu).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(picker).toBeFocused();
	await picker.selectOption("reviewer-long");
	await expect(picker).toHaveValue("reviewer-long");
	await assertHeaderFits();
	await page.screenshot({ path: testInfo.outputPath("header-boundary.png") });

	await page.locator("html").evaluate((element) => element.setAttribute("data-kit-theme", "dark"));
	await assertHeaderFits();
	// 名称含颜色过渡，等待它与宿主深色前景一致后再验收截图。
	await expect(picker).toHaveCSS(
		"color",
		await page.locator("body").evaluate((element) => getComputedStyle(element).color),
	);
	await page.screenshot({ path: testInfo.outputPath("header-boundary-dark.png") });
});

test("首屏 → 发送 → 流式回答 + 工具卡 + artifact", async ({ page }) => {
	// 复用浏览器主题偏好；宿主无法保存时，仍通过浏览器桥实际下载文件。
	await page.emulateMedia({ colorScheme: "dark" });
	await page.addInitScript(() => {
		window.__OPENAGENTPACK_KIT_BRIDGE__ = {
			kind: "desktop",
			saveFile: async () => false,
		};
	});
	await page.goto("/?agent=e2e-agent");
	await expect(page.locator("html")).toHaveAttribute("data-kit-theme", "dark");
	// 页头标题显示当前 Agent（无会话时取 display_name）
	await expect(page.locator("main header")).toContainText("E2E 助手");

	await page.getByLabel("消息输入").fill("给我一份报告 artifact");
	await page.getByRole("button", { name: "发送" }).click();

	// 用户气泡（乐观消息）与流式回答
	await expect(page.getByText("给我一份报告 artifact").first()).toBeVisible();
	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible({ timeout: 15_000 });
	// 工具卡与 artifact 卡：已执行的容器默认收起，展开后核对动词行
	const run = page.getByRole("group", { name: "执行过程", exact: true }).last();
	await expect(run.locator("> summary")).toContainText("已执行");
	await run.locator("> summary").click();
	await expect(page.getByText("echo", { exact: true }).first()).toBeVisible();
	await expect(page.getByRole("button", { name: /mock-report\.md/ }).first()).toBeVisible();
	// turn 收敛：停止按钮消失、状态回到空闲
	await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0, { timeout: 15_000 });
	await expect(page.getByText("空闲", { exact: true })).toBeVisible({ timeout: 15_000 });
	// 文件卡片迁移后，仍需实际下载 Provider 返回的文件，而不是只有可点击外观。
	const [download] = await Promise.all([
		page.waitForEvent("download"),
		page
			.getByRole("region", { name: "消息列表", exact: true })
			.getByRole("button", { name: "下载 mock-report.md", exact: true })
			.click(),
	]);
	expect(download.suggestedFilename()).toBe("mock-report.md");
	expect(await download.failure()).toBeNull();
});

// 保护回答操作与宿主桥合同：复制保留原始 Markdown/换行，拒绝后可重试且不谎报成功。
test("回答复制：完整原文、失败反馈与重试", async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async (text: string) => {
					if (sessionStorage.getItem("reject-copy")) throw new Error("denied");
					sessionStorage.setItem("copied-text", text);
				},
			},
		});
	});
	await page.goto("/?agent=e2e-agent");
	const input = "复制 **原文**\n第二行";
	await page.getByLabel("消息输入").fill(input);
	await page.getByRole("button", { name: "发送", exact: true }).click();
	const actions = page.getByRole("group", { name: "消息操作", exact: true });
	await expect(actions).toHaveCount(1);
	await page.evaluate(() => sessionStorage.setItem("reject-copy", "yes"));
	await actions.getByRole("button", { name: "复制", exact: true }).click();
	await expect(actions.getByRole("status")).toHaveText("复制失败，请重试");
	await page.evaluate(() => sessionStorage.removeItem("reject-copy"));
	await actions.getByRole("button", { name: "复制", exact: true }).click();
	await expect(actions.getByRole("status")).toHaveText("已复制");
	expect(await page.evaluate(() => sessionStorage.getItem("copied-text"))).toBe(
		`收到：「${input}」。\n这是 mock gateway 的流式回答，用于无凭据开发与测试。`,
	);
});

// 同一条真实 mock 流式回答中的代码与图表必须完整呈现；用户输入仍保持原文。
test("反馈富内容：代码高亮、Mermaid 图表和源码切换", async ({ page }) => {
	await page.goto("/?agent=e2e-agent");
	const code = 'const answer = "<script>只是文本</script>";';
	const diagram = "flowchart LR\n  A[输入] --> B[输出]";
	const input = `展示代码和图表\n\n\`\`\`javascript\n${code}\n\`\`\`\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n\n结束`;
	await page.getByLabel("消息输入").fill(input);
	await page.getByRole("button", { name: "发送", exact: true }).click();
	const messages = page.getByRole("region", { name: "消息列表", exact: true });
	await expect(messages.getByText(input, { exact: true })).toBeVisible();
	const codeBlock = messages.getByRole("region", { name: "代码块", exact: true }).first();
	await expect(codeBlock.locator("code")).toHaveText(code);
	await expect(codeBlock.locator("code span").first()).toBeVisible();
	const mermaid = messages.getByRole("region", { name: "Mermaid 图表", exact: true });
	const graph = mermaid.getByRole("img", { name: "Mermaid 图表", exact: true });
	await expect(graph).toBeVisible();
	await expect.poll(() => graph.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
	await mermaid.getByRole("button", { name: "源码", exact: true }).click();
	await expect(mermaid.locator("code")).toHaveText(diagram);
	await mermaid.getByRole("button", { name: "图表", exact: true }).click();
	await expect(graph).toBeVisible();
	await expect.poll(() => messages.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});

// 保护开场引导：真实点击示例问题即发送该问题，引导随首条消息退场。
// 只在目录响应里注入示例问题，会话链路仍走 mock server。
test("点击示例问题 → 发送并开始流式回答", async ({ page }) => {
	const prompt = "给我一份报告 artifact";
	await page.route("**/api/kit/agents", async (route) => {
		const response = await route.fetch();
		const body = (await response.json()) as { data: { slug: string; suggested_prompts: string[] }[] };
		for (const agent of body.data) {
			if (agent.slug === "e2e-agent") agent.suggested_prompts = [prompt, "第二个示例"];
		}
		await route.fulfill({ response, json: body });
	});
	await page.goto("/?agent=e2e-agent");

	// 侧栏会话标题也会取首条消息，示例问题按钮限定在 main 内，避免同名会话条目干扰。
	const pick = page.locator("main").getByRole("button", { name: prompt, exact: true });
	await expect(page.locator("main").getByRole("button", { name: "第二个示例", exact: true })).toBeVisible();
	await pick.click();

	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible({ timeout: 15_000 });
	await expect(page.getByText(prompt, { exact: true }).first()).toBeVisible();
	await expect(pick).toHaveCount(0);
});

// 保护 Suggestion + Sender 的职责边界：Suggestion 负责 "/" 查询、过滤与键盘选择，
// Sender 只把选中的技能落成 chip；已选技能不再出现在后续候选里。
test("斜杠技能：输入 / 唤出、键盘选择插入 chip、已选项不再出现", async ({ page }) => {
	await page.goto("/?agent=e2e-agent");

	const input = page.getByLabel("消息输入");
	const listbox = page.getByRole("listbox", { name: "快捷指令" });
	await input.click();
	await input.pressSequentially("/");
	await expect(listbox).toBeVisible();
	await expect(input).toHaveAttribute("aria-expanded", "true");
	await expect(listbox.getByRole("option")).toHaveCount(2);

	// 输入法合成中的回车只确认候选词，不选中也不提交。
	await input.dispatchEvent("keydown", { key: "Enter", keyCode: 229, isComposing: false });
	await expect(listbox).toBeVisible();
	await expect(input).toHaveAttribute("aria-expanded", "true");

	// 默认高亮第一条 research：Enter 只插入 chip，不发送。
	await input.press("Enter");
	await expect(listbox).toHaveCount(0);
	await expect(input.locator("[data-skill='research']")).toBeVisible();
	await expect(page.getByText(/mock gateway 的流式回答/)).toHaveCount(0);

	// 再输入 /：已选 research 被业务 filter 排除，只剩 slide-maker。
	await input.pressSequentially("/");
	await expect(listbox).toBeVisible();
	await expect(listbox.getByRole("option", { name: /research/ })).toHaveCount(0);
	await expect(listbox.getByRole("option", { name: /slide-maker/ })).toBeVisible();

	// Esc 关闭后，同一次查询保持关闭；改字形成新查询会重新打开。
	await input.press("Escape");
	await expect(listbox).toHaveCount(0);
	await input.pressSequentially("s");
	await expect(listbox).toBeVisible();
	await input.press("Enter");
	await expect(listbox).toHaveCount(0);
	await expect(input.locator("[data-skill='slide-maker']")).toBeVisible();

	// 候选关闭后第二次 Enter 才提交；消息气泡按同一批技能名还原 chip。
	await input.press("Enter");
	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible({ timeout: 15_000 });
	const bubble = page.getByText("research", { exact: true }).first();
	await expect(bubble).toBeVisible();
	await expect(page.getByText("slide-maker", { exact: true }).first()).toBeVisible();
});

test("切换 Agent：广场入口清空当前对话、更新深链，侧栏目录按 Agent 分组", async ({ page, request, baseURL }) => {
	await seedListedAgent(request, "e2e-agent-2", "E2E 二号");
	const apiBase = new URL(baseURL as string).origin;
	const apiQuery = encodeURIComponent(apiBase);
	// 留一个真实历史页面：经广场切 Agent 是 push 导航，后退先回广场，不回到失配的旧 Agent。
	await page.goto(`/?view=usage&api=${apiQuery}`);
	await expect(page.getByTestId("usage-meter")).toBeVisible();
	await page.goto(`/?agent=e2e-agent&api=${apiQuery}`);
	const messages = page.getByRole("region", { name: "消息列表", exact: true });
	await page.getByLabel("消息输入").fill("writer session marker");
	await page.getByRole("button", { name: "发送" }).click();
	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible({ timeout: 15_000 });

	await expect(messages.getByText("writer session marker", { exact: true })).toBeVisible();

	// 经广场进入另一个 Agent（SPA 导航：验证旧会话状态释放、深链与 api 参数正确）
	await page.getByTestId("nav-plaza").click();
	await expect(page.getByRole("heading", { name: "Agent 广场", exact: true })).toBeVisible();
	await page.getByTestId("plaza-search").fill("e2e-agent-2");
	await page.getByTestId("plaza-card-e2e-agent-2").getByRole("button", { name: "开始体验", exact: true }).click();

	await expect(page).toHaveURL(/agent=e2e-agent-2/);
	await expect(page.locator("main > header")).toContainText("E2E 二号");
	expect(new URL(page.url()).searchParams.get("api")).toBe(apiBase);
	// 关键不变量：切走后不得残留上一个会话的消息（useChat(null) 必须释放旧 controller）
	await expect(messages.getByText("writer session marker", { exact: true })).toHaveCount(0);
	// 侧栏目录按 Agent 分组：writer 的会话归「E2E 助手」组，二号还没有会话组
	const sidebar = page.getByTestId("experience-sidebar");
	await expect(sidebar.getByTestId("sidebar-group-e2e-agent")).toContainText("E2E 助手");
	await expect(sidebar.getByTestId("sidebar-group-e2e-agent")).toContainText("1");
	await expect(sidebar.getByTestId("sidebar-group-e2e-agent-2")).toHaveCount(0);
	await page.goBack();
	await expect(page.getByRole("heading", { name: "Agent 广场", exact: true })).toBeVisible();
	await page.goForward();
	await expect(page).toHaveURL(/agent=e2e-agent-2/);
	await expect(page.locator("main > header")).toContainText("E2E 二号");
	expect(new URL(page.url()).searchParams.get("api")).toBe(apiBase);
});

// 分区标题可折叠：收起后内容从目录消失，再点恢复；分区是纯手动开关，不随会话状态弹开。
test("侧栏分区：智能体与最近可折叠展开", async ({ page }) => {
	await page.goto("/?agent=e2e-agent");
	await page.getByLabel("消息输入").fill("collapse case");
	await page.getByRole("button", { name: "发送" }).click();
	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible({ timeout: 15_000 });

	const agentsToggle = page.getByRole("button", { name: "智能体", exact: true });
	const recentToggle = page.getByRole("button", { name: "最近", exact: true });
	const group = page.getByTestId("sidebar-group-e2e-agent");
	const recentNav = page.getByRole("navigation", { name: "最近会话", exact: true });
	await expect(group).toBeVisible();
	await expect(recentNav).toBeVisible();

	await agentsToggle.click();
	await expect(agentsToggle).toHaveAttribute("aria-expanded", "false");
	await expect(group).toBeHidden();
	await agentsToggle.click();
	await expect(agentsToggle).toHaveAttribute("aria-expanded", "true");
	await expect(group).toBeVisible();

	await recentToggle.click();
	await expect(recentToggle).toHaveAttribute("aria-expanded", "false");
	await expect(recentNav).toBeHidden();
	await recentToggle.click();
	await expect(recentToggle).toHaveAttribute("aria-expanded", "true");
	await expect(recentNav).toBeVisible();
});

test("断网一次后自动重连续传", async ({ page }) => {
	let aborted = false;
	await page.route("**/api/kit/sessions/*/stream*", (route) => {
		if (!aborted) {
			aborted = true;
			return route.abort();
		}
		return route.continue();
	});
	await page.goto("/?agent=e2e-agent");
	await page.getByLabel("消息输入").fill("hello retry");
	await page.getByRole("button", { name: "发送" }).click();
	// 第一次流被掐断后，controller 退避重连，最终仍应拿到回答
	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible({ timeout: 30_000 });
});

// 长内容必须完整保留；宽表和代码只在自身横滚，不挤宽阅读列、审批或输入框。
test("消息阅读布局：长文本与宽表在窄屏和桌面保持可读", async ({ page, isMobile }, testInfo) => {
	if (isMobile) await page.setViewportSize({ width: 320, height: 844 });
	await page.goto("/e2e/fixtures/message-layout.html");
	const messages = page.getByRole("region", { name: "消息列表", exact: true });
	const table = messages.getByRole("region", { name: "表格", exact: true });
	const code = messages.getByRole("region", { name: "代码块", exact: true });
	const approval = page.getByRole("region", { name: "工具审批 导出核对报告", exact: true });
	const sender = page.locator("form").filter({ has: page.getByLabel("消息输入", { exact: true }) });
	await expect(messages.getByText(/^请帮我核对十月份跨部门协作项目的报销情况/)).toBeVisible();
	// 已执行的容器默认收起；先展开执行过程，再展开工具卡详情
	await messages.getByRole("group", { name: "执行过程", exact: true }).locator("> summary").click();
	await expect(messages.getByText(/^finance_reporting_service__/)).toBeVisible();
	await messages
		.getByRole("group", { name: /^工具调用 finance_reporting_service__/ })
		.locator("summary")
		.click();
	await expect(messages.getByText(/^核对完成，结果编号：FINANCE_RECONCILIATION_/)).toBeVisible();
	await expect(code.locator("code")).toContainText("SETTLEMENT_REFERENCE_ARCHIVE_READY_FOR_REVIEW");
	await expect(approval).toBeVisible();

	const assertReadingFits = async () => {
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
			.toBe(true);
		await expect.poll(() => messages.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
		const [codeBox, approvalBox, senderBox] = await Promise.all([
			code.boundingBox(),
			approval.boundingBox(),
			sender.boundingBox(),
		]);
		if (!codeBox || !approvalBox || !senderBox) throw new Error("阅读列、审批和输入框必须已呈现");
		for (const box of [approvalBox, senderBox]) {
			expect(Math.abs(box.x - codeBox.x)).toBeLessThanOrEqual(1);
			expect(Math.abs(box.width - codeBox.width)).toBeLessThanOrEqual(1);
		}
		const viewportWidth = page.viewportSize()?.width ?? 0;
		expect(Math.abs(codeBox.x - (viewportWidth - codeBox.width) / 2)).toBeLessThanOrEqual(1);
	};
	await assertReadingFits();
	await expect.poll(() => table.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
	await expect
		.poll(() => code.locator("pre").evaluate((element) => element.scrollWidth > element.clientWidth))
		.toBe(true);
	await table.scrollIntoViewIfNeeded();
	await table.focus();
	await expect(table).toBeFocused();
	await page.keyboard.press("ArrowRight");
	await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
	await table.evaluate((element) => {
		element.scrollLeft = element.scrollWidth;
	});
	const lastCell = table.getByRole("cell", { name: "可按期结算", exact: true });
	await expect(lastCell).toBeVisible();
	const [tableBox, cellBox] = await Promise.all([table.boundingBox(), lastCell.boundingBox()]);
	if (!tableBox || !cellBox) throw new Error("表格末列必须可读");
	expect(cellBox.x).toBeGreaterThanOrEqual(tableBox.x - 1);
	expect(cellBox.x + cellBox.width).toBeLessThanOrEqual(tableBox.x + tableBox.width + 1);
	await assertReadingFits();

	for (const theme of ["light", "dark"]) {
		await page.locator("html").evaluate((element, value) => element.setAttribute("data-kit-theme", value), theme);
		await assertReadingFits();
		await page.screenshot({ path: testInfo.outputPath(`message-wide-content-${theme}.png`) });
		await messages.evaluate((element) => {
			element.scrollTop = 0;
		});
		await page.screenshot({ path: testInfo.outputPath(`message-reading-${theme}.png`) });
		await table.scrollIntoViewIfNeeded();
	}
});

// 保护阅读历史消息的流程：流式增长只滚动消息容器，用户上滚后保持位置，回底后恢复跟随。
test("消息列表：跟随生成 → 阅读历史暂停 → 回到底部恢复", async ({ page }) => {
	await page.goto("/e2e/fixtures/message-list.html");
	const messages = page.getByRole("region", { name: "消息列表", exact: true });
	const distanceToBottom = () =>
		messages.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);

	await expect(messages.getByText("开始回答", { exact: true })).toHaveCount(1);
	await expect.poll(() => messages.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
	await expect.poll(distanceToBottom).toBeLessThanOrEqual(2);
	await expect(page.getByRole("button", { name: "回到底部", exact: true })).toBeHidden();

	// 空态从顶部阅读，缩小窗口不会把开场白滚走；首条消息恢复跟随。
	await page.getByRole("button", { name: "清空消息", exact: true }).click();
	await expect(messages.getByRole("heading", { name: "欢迎开始对话" })).toBeVisible();
	await expect.poll(() => messages.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
	await expect.poll(() => messages.evaluate((element) => element.scrollTop)).toBe(0);
	const viewport = page.viewportSize()!;
	await page.setViewportSize({ ...viewport, height: viewport.height - 100 });
	await expect.poll(() => messages.evaluate((element) => element.scrollTop)).toBe(0);
	await messages.hover();
	await page.mouse.wheel(0, 200);
	await expect.poll(() => messages.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	await page.getByLabel("自动跟随", { exact: true }).uncheck();
	const emptyReadingPosition = await messages.evaluate((element) => element.scrollTop);
	await page.getByLabel("自动跟随", { exact: true }).check();
	await expect.poll(() => messages.evaluate((element) => element.scrollTop)).toBe(emptyReadingPosition);
	await page.getByRole("button", { name: "加载历史", exact: true }).click();
	await expect(messages.getByText("开始回答", { exact: true })).toHaveCount(1);
	await expect.poll(distanceToBottom).toBeLessThanOrEqual(2);
	await page.setViewportSize(viewport);

	await messages.hover();
	await page.mouse.wheel(0, -100_000);
	await expect.poll(() => messages.evaluate((element) => element.scrollTop)).toBeLessThanOrEqual(2);
	await page.getByRole("button", { name: "追加消息", exact: true }).click();
	await expect(messages.getByText("新增消息 1", { exact: true })).toHaveCount(1);
	await page.getByRole("button", { name: "追加分片", exact: true }).click();
	await expect(messages.getByText("流式分片 1", { exact: true })).toHaveCount(1);
	await expect.poll(() => messages.evaluate((element) => element.scrollTop)).toBeLessThanOrEqual(2);
	await expect.poll(distanceToBottom).toBeGreaterThan(0);

	await messages.hover();
	await page.mouse.wheel(0, 100_000);
	await expect.poll(distanceToBottom).toBeLessThanOrEqual(2);
	const previousBottom = await messages.evaluate((element) => element.scrollTop);
	await page.getByRole("button", { name: "追加分片", exact: true }).click();
	await expect(messages.getByText("流式分片 2", { exact: true })).toHaveCount(1);
	await expect.poll(distanceToBottom).toBeLessThanOrEqual(2);
	await expect.poll(() => messages.evaluate((element) => element.scrollTop)).toBeGreaterThan(previousBottom);

	await page.getByLabel("自动跟随", { exact: true }).uncheck();
	const stoppedAt = await messages.evaluate((element) => element.scrollTop);
	await page.getByRole("button", { name: "追加分片", exact: true }).click();
	await expect(messages.getByText("流式分片 3", { exact: true })).toHaveCount(1);
	await expect.poll(() => messages.evaluate((element) => element.scrollTop)).toBe(stoppedAt);
	await expect.poll(distanceToBottom).toBeGreaterThan(0);

	// 回到底部按钮：离底浮现，点击平滑回底后隐藏；只滚动消息容器，不牵动页面。
	const backToBottom = page.getByRole("button", { name: "回到底部", exact: true });
	await expect(backToBottom).toBeVisible();
	await backToBottom.click();
	await expect.poll(distanceToBottom).toBeLessThanOrEqual(2);
	await expect(backToBottom).toBeHidden();
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test("新会话与会话切换：恢复消息跟随", async ({ page }) => {
	await page.goto("/?agent=e2e-agent");
	const messages = page.getByRole("region", { name: "消息列表", exact: true });
	const distanceToBottom = () =>
		messages.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);
	const history = Array.from({ length: 80 }, (_, index) => `历史第 ${index + 1} 行`).join("\n");
	await page.getByLabel("消息输入").fill(`first session\n${history}`);
	await page.getByRole("button", { name: "发送" }).click();
	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible({ timeout: 15_000 });
	await expect(page.getByText("空闲", { exact: true })).toBeVisible();
	await expect.poll(() => messages.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
	await messages.hover();
	await page.mouse.wheel(0, -100_000);
	await expect.poll(() => messages.evaluate((element) => element.scrollTop)).toBeLessThanOrEqual(2);

	await newSession(page);
	await expect(page.getByLabel("消息输入")).toHaveValue("");
	await page.getByLabel("消息输入").fill(`second session\n${history}`);
	await page.getByRole("button", { name: "发送" }).click();
	await expect(page.getByText(/mock gateway 的流式回答/)).toHaveCount(1);
	await expect(page.getByText("空闲", { exact: true })).toBeVisible();
	await expect.poll(() => messages.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
	await expect.poll(distanceToBottom).toBeLessThanOrEqual(2);
	await messages.hover();
	await page.mouse.wheel(0, -100_000);
	await expect.poll(() => messages.evaluate((element) => element.scrollTop)).toBeLessThanOrEqual(2);

	// 侧栏（H5 为抽屉）切回长历史会话，不继承上一会话的「暂停跟随」。
	await openSessionList(page);
	const sidebar = page.getByRole("navigation", { name: "最近会话", exact: true });
	// 首句当标题；选中高亮只归智能体分组，最近区按首行前缀定位，避免依赖排序。
	const sidebarItem = sidebar.getByRole("button").filter({ hasText: "first session" });
	await expect(sidebarItem).toHaveCount(1);
	await expect(sidebarItem).toBeVisible({ timeout: 10_000 });
	await sidebarItem.click();
	await expect(messages.getByText(`first session\n${history}`, { exact: true })).toHaveCount(1);
	await expect.poll(() => messages.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
	await expect.poll(distanceToBottom).toBeLessThanOrEqual(2);
});

test("会话归档与删除：两段式确认闸门 + 列表刷新", async ({ page }, testInfo) => {
	await page.goto("/?agent=e2e-agent");
	await page.getByLabel("消息输入").fill("lifecycle case");
	await page.getByRole("button", { name: "发送" }).click();
	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible({ timeout: 15_000 });
	await newSession(page);
	await openSessionList(page);
	const viewport = page.viewportSize();
	const desktop = (viewport?.width ?? 1280) >= 768;
	const sidebar = page.getByRole("navigation", { name: "最近会话", exact: true });
	// 首句标题：行展示「lifecycle case」；三个操作收敛进单一「更多操作」菜单（弹层 Portal 到 body）。
	const title = sidebar.getByRole("button", { name: "lifecycle case", exact: true }).first();
	const actions = sidebar.getByRole("button", { name: "更多操作", exact: true }).first();
	const archiveItem = page.getByRole("menuitem", { name: "归档", exact: true });
	if (desktop) {
		// 未选中行只在悬停或键盘聚焦时展示操作，真实透明度不能用 toBeVisible 代替。
		await page.getByLabel("消息输入").focus();
		await page.getByLabel("消息输入").hover();
		await expect(actions).toHaveCSS("opacity", "0");
		await title.hover();
	}
	// 触屏不做 hover，操作也必须直接可见。
	await expect(actions).toHaveCSS("opacity", "1");
	await page.screenshot({ path: testInfo.outputPath("session-sidebar.png") });

	// 归档：菜单选择 + AlertDialog 两段式确认（AGENTS.md UI 规范 3）
	await actions.click();
	await archiveItem.click();
	await expect(page.getByRole("alertdialog", { name: "归档会话" })).toBeVisible();
	if (desktop) {
		await page.getByRole("alertdialog", { name: "归档会话" }).getByRole("button", { name: "取消" }).click();
		await expect(actions).toBeFocused();
		await title.focus();
		await page.keyboard.press("Tab");
		await expect(actions).toBeFocused();
		await expect(actions).toHaveCSS("opacity", "1");
		await page.keyboard.press("Enter");
		await expect(archiveItem).toBeVisible();
		await page.keyboard.press("Enter");
		await expect(page.getByRole("alertdialog", { name: "归档会话" })).toBeVisible();
		// 切换布局不能把尚待用户确认的 plan 藏进关闭的移动抽屉。
		await page.setViewportSize({ width: 390, height: 844 });
		await expect(page.getByRole("button", { name: "打开导航菜单", includeHidden: true })).toBeAttached();
		await expect(page.getByRole("alertdialog", { name: "归档会话" })).toBeVisible();
	}
	await page.getByRole("alertdialog", { name: "归档会话" }).getByRole("button", { name: "确认" }).click();
	await expect(page.getByRole("alertdialog", { name: "归档会话" })).toHaveCount(0, { timeout: 10_000 });
	if (viewport) await page.setViewportSize(viewport);
	// 目录只承载可见会话：归档已执行，侧栏不再有该行。
	await expect(title).toHaveCount(0, { timeout: 10_000 });

	// 删除：第二个会话行走同一套菜单，确认后本地索引移除，侧栏不再有该会话
	await page.getByLabel("消息输入").fill("lifecycle second");
	await page.getByRole("button", { name: "发送" }).click();
	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible({ timeout: 15_000 });
	await newSession(page);
	await openSessionList(page);
	await expect(sidebar.getByRole("button", { name: "lifecycle second", exact: true })).toBeVisible();
	await sidebar.getByRole("button", { name: "更多操作", exact: true }).first().click();
	await page.getByRole("menuitem", { name: "删除", exact: true }).click();
	await expect(page.getByRole("alertdialog", { name: "删除会话" })).toBeVisible();
	await page.getByRole("alertdialog", { name: "删除会话" }).getByRole("button", { name: "确认" }).click();
	await expect(sidebar.getByRole("button", { name: "更多操作" })).toHaveCount(0, { timeout: 10_000 });
});

test("附件：上传暂存 → 同一会话随消息挂载 → 刷新恢复", async ({ page }) => {
	await page.goto("/?agent=e2e-agent");
	await page.getByLabel("消息输入").fill("plain message");
	await page.getByRole("button", { name: "发送" }).click();
	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible({ timeout: 15_000 });
	await expect(page.getByText("空闲", { exact: true })).toBeVisible();
	const sessionId = new URL(page.url()).searchParams.get("session");
	expect(sessionId).not.toBeNull();

	// 浏览器降级桥 = <input type=file>，Playwright 用 filechooser 事件驱动
	await page.getByRole("button", { name: "添加附件" }).click();
	const [chooser] = await Promise.all([
		page.waitForEvent("filechooser"),
		page.getByRole("menuitem", { name: "上传文件", exact: true }).click(),
	]);
	const uploaded = page.waitForResponse(
		(response) => new URL(response.url()).pathname === "/api/kit/files" && response.request().method() === "POST",
	);
	await chooser.setFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("hello kit") });
	const fileId = (await (await uploaded).json()).data.file_id as string;
	await expect(page.getByText("note.txt").first()).toBeVisible({ timeout: 10_000 });
	await expect(page.getByText("发送时会一并提交附件", { exact: true })).toBeVisible();

	// 公开 Provider 的请求映射必须完整保留附件，不能静默丢弃或另建会话。
	await page.getByLabel("消息输入").fill("看这个文件");
	const sent = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === `/api/kit/sessions/${sessionId}/messages` &&
			response.request().method() === "POST",
	);
	await page.getByRole("button", { name: "发送" }).click();
	const accepted = await sent;
	expect(accepted.ok()).toBe(true);
	expect(accepted.request().postDataJSON()).toMatchObject({ text: "看这个文件", attachments: [{ file_id: fileId }] });
	expect(new URL(page.url()).searchParams.get("session")).toBe(sessionId);
	await expect(page.getByText("看这个文件").first()).toBeVisible({ timeout: 15_000 });
	await expect(page.getByLabel("消息输入")).toBeEmpty();
	const messages = page.getByRole("region", { name: "消息列表", exact: true });
	await expect(messages.getByText("note.txt", { exact: true }).first()).toBeVisible();
	await page.reload();
	await expect(messages.getByText("note.txt", { exact: true }).first()).toBeVisible();
});

// 保护真实审批流程：普通消息不能绕过 pending；允许一步直提，拒绝走弹窗且可以没有原因。
test("工具审批：审查参数 → 允许直提 → 拒绝直提 → 恢复生成并保留草稿", async ({ page }) => {
	const decisions: Array<{ call_id: string; result: string; deny_message?: string }> = [];
	let messagePosts = 0;
	page.on("request", (request) => {
		if (request.method() !== "POST") return;
		if (/\/tool-approvals$/.test(request.url())) decisions.push(request.postDataJSON());
		if (/\/messages$/.test(request.url())) messagePosts++;
	});
	await page.goto("/?agent=e2e-agent");
	const messages = page.getByRole("region", { name: "消息列表", exact: true });
	const input = page.getByLabel("消息输入");
	await input.fill("approval artifact");
	await page.getByRole("button", { name: "发送", exact: true }).click();
	const read = messages.getByRole("region", { name: "工具审批 read_file", exact: true });
	const write = messages.getByRole("region", { name: "工具审批 write_file", exact: true });
	await expect(read.getByRole("status")).toHaveText("等待审批");
	// 多个待审批横向切换：一次只显示一张卡，翻页而不是纵向铺平。
	await expect(messages.getByText("1 / 2", { exact: true })).toBeVisible();
	await expect(write).toHaveCount(0);
	// 审批卡内嵌消息流；输入区上方只保留一条精简等待提示。
	await expect(messages.getByText("Agent 请求执行工具", { exact: false }).first()).toBeVisible();
	await expect(page.getByText("等待审批", { exact: true }).last()).toBeVisible();
	await input.fill("审批期间的草稿");
	await input.press("Enter");
	await expect(input).toHaveText("审批期间的草稿");

	// 允许前先展开完整参数核对；摘要行不该当作完整参数。
	await read.getByText("查看参数", { exact: true }).click();
	await expect(read.locator("pre")).toContainText("/tmp/report.txt");
	await expect(read.locator("pre")).toContainText("<unsafe>");
	await expect(read.locator("unsafe")).toHaveCount(0);

	// 允许一步直提；当前项处理后自动切到下一个待审批。
	await read.getByRole("button", { name: "允许", exact: true }).click();
	await expect(read).toHaveCount(0);
	await expect(write.getByRole("status")).toHaveText("等待审批");
	expect(messagePosts).toBe(1);
	expect(decisions).toEqual([expect.objectContaining({ call_id: "call_read", result: "allow" })]);

	// 拒绝同样一步直提，不弹确认窗。
	await write.getByRole("button", { name: "拒绝", exact: true }).click();
	await expect(page.getByRole("alertdialog")).toHaveCount(0);
	await expect(page.getByText("空闲", { exact: true })).toBeVisible();
	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible();
	await expect(input).toHaveText("审批期间的草稿");
	await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
	expect(decisions).toHaveLength(2);
	expect(decisions[1]).toMatchObject({ call_id: "call_write", result: "deny" });
	expect(decisions[1]).not.toHaveProperty("deny_message");
	const [download] = await Promise.all([
		page.waitForEvent("download"),
		messages.getByRole("button", { name: "下载 mock-report.md", exact: true }).click(),
	]);
	expect(await download.failure()).toBeNull();
});

// 保护 SDK 累计快照收敛、未知块安全展示及切换会话后从历史重建。
test("完整快照：正文不重复、未知内容安全展开、切会话后保持结果", async ({ page }) => {
	await page.goto("/?agent=e2e-agent");
	await page.getByLabel("消息输入").fill("snapshot artifact");
	await page.getByRole("button", { name: "发送", exact: true }).click();
	await expect(page.getByText("空闲", { exact: true })).toBeVisible();
	const messages = page.getByRole("region", { name: "消息列表", exact: true });
	const answer = messages.getByText("收到：「snapshot artifact」。", { exact: false }).first();
	await expect(answer).toHaveText(
		"收到：「snapshot artifact」。\n这是 mock gateway 的流式回答，用于无凭据开发与测试。",
	);
	const unknown = messages.locator("details").filter({ hasText: "未识别内容：unknown_widget" });
	await unknown.locator("summary").click();
	await expect(unknown.locator("pre")).toContainText("<script>unsafe()</script>");
	await expect(messages.locator("script")).toHaveCount(0);
	await expect.poll(() => messages.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
	await newSession(page);
	await expect(messages.getByText(/mock gateway 的流式回答/)).toHaveCount(0);
	await openSessionList(page);
	await page
		.getByRole("navigation", { name: "最近会话", exact: true })
		.getByRole("button", { name: "snapshot artifact", exact: true })
		.click();
	await expect(answer).toHaveText(
		"收到：「snapshot artifact」。\n这是 mock gateway 的流式回答，用于无凭据开发与测试。",
	);
	await expect(messages.locator("details").filter({ hasText: "未识别内容：unknown_widget" })).toHaveCount(1);
});

// 写请求已经到达服务端但浏览器丢失响应时，只查询状态，不能自动再次批准。
test("审批响应丢失：刷新结果且不重发，剩余调用仍可拒绝", async ({ page }) => {
	const posted: string[] = [];
	await page.route("**/api/kit/sessions/*/tool-approvals", async (route) => {
		if (route.request().method() !== "POST") return route.continue();
		posted.push((route.request().postDataJSON() as { call_id: string }).call_id);
		if (posted.length !== 1) return route.continue();
		const response = await route.fetch();
		expect(response.ok()).toBe(true);
		await route.abort("connectionreset");
	});
	await page.goto("/?agent=e2e-agent");
	await page.getByLabel("消息输入").fill("approval thread");
	await page.getByRole("button", { name: "发送", exact: true }).click();
	const read = page.getByRole("region", { name: "工具审批 read_file", exact: true });
	const write = page.getByRole("region", { name: "工具审批 write_file", exact: true });
	await expect(read.getByText("builtin", { exact: true })).toBeVisible();
	await read.getByRole("button", { name: "允许", exact: true }).click();
	// 已处理请求可能退场，也可能以只读状态保留；两者都不能继续批准。
	await expect(read.getByRole("button", { name: "允许", exact: true })).toHaveCount(0);
	await expect(write.getByRole("status")).toHaveText("等待审批");
	// 拒绝一步直提，不弹确认窗。
	await write.getByRole("button", { name: "拒绝", exact: true }).click();
	await expect(page.getByText("空闲", { exact: true })).toBeVisible();
	expect(posted).toEqual(["call_read", "call_write"]);
});

// 首屏必须真正读取并验证运行时协议；不允许旧服务端静默进入新版对话。
test("协议混版：启动明确报错并阻止发送", async ({ page }) => {
	await page.route("**/api/config", async (route) => {
		const response = await route.fetch();
		const body = (await response.json()) as { data: { protocolVersion: string } };
		body.data.protocolVersion = "1.0.0";
		await route.fulfill({ response, json: body });
	});
	await page.goto("/?agent=e2e-agent");
	await expect(page.getByRole("alert")).toContainText("客户端与服务端协议版本不兼容，请同步升级");
	await expect(page.getByLabel("消息输入")).toHaveCount(0);
});
