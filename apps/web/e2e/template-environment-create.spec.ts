import { expect, test } from "./fixtures.ts";
import {
	inlineApi,
	inlineNext,
	inlineReview,
	inlineSection,
	leaveInlineTemplate,
	openInlineTemplate,
	saveInlineDraft,
	selectInlineEnvironment,
} from "./template-inline-helpers.ts";

test.afterEach(async ({ page }) => leaveInlineTemplate(page));

test("环境页内创建：输入零写入，校验、单飞和导航锁定，取消发布保留本地声明", async ({ page }) => {
	await openInlineTemplate(page);
	const section = inlineSection(page, "环境");
	const bodies: Record<string, unknown>[] = [];
	const gate = Promise.withResolvers<void>();
	await page.route(`${inlineApi}/api/admin/resource-drafts/*/resources/environments`, async (route) => {
		bodies.push(route.request().postDataJSON());
		await gate.promise;
		await route.continue();
	});
	await section.getByRole("textbox", { name: "描述", exact: true }).fill("数据分析环境");
	await expect(inlineNext(page)).toBeDisabled();
	await section.getByRole("textbox", { name: "环境名称", exact: true }).fill("kit-e2e-inline-environment");
	await section.getByRole("combobox", { name: "网络访问模式", exact: true }).selectOption("limited");
	await section.getByRole("combobox", { name: "MCP 服务访问", exact: true }).selectOption("false");
	await section
		.getByRole("textbox", { name: "允许访问的主机", exact: true })
		.fill("example.test\npackages.example.test");
	await section.getByRole("combobox", { name: "包管理器", exact: true }).selectOption("pip");
	await section.getByRole("textbox", { name: "包名称", exact: true }).fill("pandas numpy");
	await section.getByRole("textbox", { name: "元数据键", exact: true }).fill("Purpose");
	await expect(inlineNext(page)).toBeDisabled();
	await section.getByRole("textbox", { name: "元数据键", exact: true }).fill("purpose");
	await section.getByRole("textbox", { name: "元数据值", exact: true }).fill("analysis");
	expect(bodies).toEqual([]);
	const saved = saveInlineDraft(page);
	try {
		await expect.poll(() => bodies.length).toBe(1);
		await expect(inlineNext(page)).toBeDisabled();
		await expect(page.getByTestId("template-list-tab")).toBeDisabled();
		await page.keyboard.press("Enter");
		expect(bodies).toHaveLength(1);
	} finally {
		gate.resolve();
	}
	await saved;
	expect(bodies[0]).toMatchObject({
		name: "kit-e2e-inline-environment",
		description: "数据分析环境",
		packages: { pip: ["pandas", "numpy"] },
		metadata: { purpose: "analysis" },
		networking: { type: "limited", allow_mcp_servers: false, allowed_hosts: ["example.test", "packages.example.test"] },
	});
	await expect(section.getByRole("textbox", { name: "环境名称", exact: true })).toHaveValue(
		"kit-e2e-inline-environment",
	);
	await expect(inlineSection(page, "已选配置预览")).toContainText("kit-e2e-inline-environment");
});

test("环境页内创建：明确失败保留草稿可重试，清空恢复默认环境和窄屏布局", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openInlineTemplate(page);
	const section = inlineSection(page, "环境");
	await section.getByRole("textbox", { name: "环境名称", exact: true }).fill("kit-e2e-inline-retry");
	let attempts = 0;
	await page.route(`${inlineApi}/api/admin/resource-drafts/*/resources/environments`, async (route) => {
		if (++attempts === 1)
			return route.fulfill({ status: 409, json: { error: { code: "conflict", message: "源码已变化，请重试" } } });
		await route.continue();
	});
	await inlineNext(page).click();
	await expect(page.getByRole("alert").filter({ hasText: "源码已变化" }).first()).toBeVisible();
	await expect(section.getByRole("textbox", { name: "环境名称", exact: true })).toHaveValue("kit-e2e-inline-retry");
	await inlineNext(page).click();
	await expect(inlineReview(page)).toBeVisible();
	await inlineReview(page).getByRole("button", { name: "取消", exact: true }).click();
	expect(attempts).toBe(2);
	await section.getByRole("button", { name: "清空", exact: true }).click();
	await expect(section.getByRole("textbox", { name: "环境名称", exact: true })).toHaveValue("");
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("环境导入：原引用不创建声明，审计员配置只读", async ({ page }) => {
	await openInlineTemplate(page, "auditor");
	await selectInlineEnvironment(page, "选择环境 默认环境（env_mock_default）");
	await expect(inlineSection(page, "环境")).toContainText("默认环境");
	await expect(inlineSection(page, "环境").getByRole("textbox", { name: "环境名称", exact: true })).toHaveCount(0);
	await expect(inlineNext(page)).toBeDisabled();
});
