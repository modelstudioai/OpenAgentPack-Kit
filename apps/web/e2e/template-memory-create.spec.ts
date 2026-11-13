import { expect, test } from "./fixtures.ts";
import {
	inlineApi,
	inlineNext,
	inlineReview,
	inlineSection,
	leaveInlineTemplate,
	openInlinePicker,
	openInlineTemplate,
	saveInlineDraft,
} from "./template-inline-helpers.ts";

test.afterEach(async ({ page }) => leaveInlineTemplate(page));

test("记忆页内创建：名称校验、条目取消和编辑，下一步保存完整正文与挂载配置", async ({ page }) => {
	await openInlineTemplate(page);
	const memory = inlineSection(page, "记忆库");
	const content = `/literal/path\n\${LITERAL_VARIABLE}`;
	const bodies: Record<string, unknown>[] = [];
	await page.route(`${inlineApi}/api/admin/resource-drafts/*/resources/memory-stores`, async (route) => {
		bodies.push(route.request().postDataJSON());
		await route.continue();
	});
	await memory.getByRole("textbox", { name: "描述", exact: true }).fill("记忆正文副本");
	await expect(inlineNext(page)).toBeDisabled();
	await expect(memory.getByText("请输入记忆库名称", { exact: true })).toHaveCount(0);
	await memory.getByRole("textbox", { name: "记忆库名称", exact: true }).fill("kit-e2e-inline-memory");
	await memory.getByRole("combobox", { name: "权限", exact: true }).selectOption("read_only");
	await memory.getByRole("textbox", { name: "说明", exact: true }).fill("只检索项目约定");
	await memory.getByRole("button", { name: "新增条目", exact: true }).click();
	let dialog = page.getByRole("dialog", { name: "新增记忆条目", exact: true });
	await dialog.getByRole("textbox", { name: "条目路径", exact: true }).fill("discarded.md");
	await dialog.getByRole("button", { name: "取消", exact: true }).click();
	await expect(memory).not.toContainText("discarded.md");
	await memory.getByRole("button", { name: "新增条目", exact: true }).click();
	dialog = page.getByRole("dialog", { name: "新增记忆条目", exact: true });
	await dialog.getByRole("textbox", { name: "条目路径", exact: true }).fill("project/guide.md");
	await dialog.getByRole("textbox", { name: "条目正文", exact: true }).fill(content);
	await expect(inlineNext(page)).toBeDisabled();
	await dialog.getByRole("button", { name: "添加", exact: true }).click();
	expect(bodies).toEqual([]);
	await saveInlineDraft(page);
	expect(bodies).toEqual([
		expect.objectContaining({
			name: "kit-e2e-inline-memory",
			description: "记忆正文副本",
			entries: [{ key: "project/guide.md", content }],
		}),
	]);
	expect(bodies[0]).not.toHaveProperty("access");
	await expect(memory.getByRole("combobox", { name: "权限", exact: true })).toHaveValue("read_only");
	await expect(memory.getByRole("textbox", { name: "说明", exact: true })).toHaveValue("只检索项目约定");
});

test("记忆库导入失败：可以只复用原库，不重读正文、不创建声明并保留挂载权限", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openInlineTemplate(page);
	let reads = 0;
	const writes: string[] = [];
	await page.route(`${inlineApi}/api/admin/remote/memory-stores/memory-guide`, (route) => {
		reads++;
		return route.fulfill({
			status: 502,
			json: { error: { code: "provider_error", message: "条目超过编辑预算，可继续复用原库" } },
		});
	});
	page.on("request", (request) => {
		if (request.method() === "POST" && /\/projects\/|\/resource-drafts(?:\/|$)/.test(request.url()))
			writes.push(request.url());
	});
	const picker = await openInlinePicker(page, "记忆库");
	await picker.getByRole("button", { name: /选择记忆库 项目知识库/ }).click();
	await picker.getByRole("button", { name: "确认选择", exact: true }).click();
	await expect(picker).toContainText("超过编辑预算");
	await picker.getByRole("button", { name: "仅复用原库", exact: true }).click();
	await expect(picker).toHaveCount(0);
	const memory = inlineSection(page, "记忆库");
	await expect(memory).toContainText("仅复用原记忆库");
	await expect(memory.getByRole("textbox", { name: "记忆库名称", exact: true })).toHaveValue("项目知识库");
	await memory.getByRole("combobox", { name: "权限", exact: true }).selectOption("read_only");
	await inlineNext(page).click();
	await expect(inlineSection(page, "模版预览调试")).toBeVisible();
	expect(reads).toBe(1);
	expect(writes).toEqual([]);
});

test("记忆页内创建：明确失败保留条目供重试，审计员不可编辑", async ({ page }) => {
	await openInlineTemplate(page);
	const memory = inlineSection(page, "记忆库");
	await memory.getByRole("textbox", { name: "记忆库名称", exact: true }).fill("kit-e2e-memory-retry");
	let attempts = 0;
	await page.route(`${inlineApi}/api/admin/resource-drafts/*/resources/memory-stores`, async (route) => {
		if (++attempts === 1)
			return route.fulfill({ status: 409, json: { error: { code: "conflict", message: "记忆声明冲突" } } });
		await route.continue();
	});
	await inlineNext(page).click();
	await expect(page.getByRole("alert").filter({ hasText: "记忆声明冲突" }).first()).toBeVisible();
	await expect(memory.getByRole("textbox", { name: "记忆库名称", exact: true })).toHaveValue("kit-e2e-memory-retry");
	await inlineNext(page).click();
	await expect(inlineReview(page)).toBeVisible();
	await inlineReview(page).getByRole("button", { name: "取消", exact: true }).click();
	expect(attempts).toBe(2);
	await leaveInlineTemplate(page);
	await openInlineTemplate(page, "auditor");
	await expect(memory.getByRole("textbox", { name: "记忆库名称", exact: true })).toBeDisabled();
});
