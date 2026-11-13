import { expect, test } from "./fixtures.ts";
import {
	inlineApi,
	inlineNext,
	inlineReview,
	inlineSection,
	leaveInlineTemplate,
	openInlineTemplate,
	saveInlineDraft,
} from "./template-inline-helpers.ts";

test.afterEach(async ({ page }) => leaveInlineTemplate(page));

test("文件页内创建：选择零写入，同名路径避让，下一步上传和提交单飞", async ({ page }) => {
	await openInlineTemplate(page);
	const files = inlineSection(page, "文件");
	const calls: string[] = [];
	const gate = Promise.withResolvers<void>();
	await page.route(`${inlineApi}/api/admin/resource-drafts/*/resources/file-uploads**`, async (route) => {
		if (route.request().method() === "POST") calls.push(new URL(route.request().url()).pathname);
		if (route.request().url().endsWith("/commit")) await gate.promise;
		await route.continue();
	});
	for (const content of ["first file", "second file"])
		await files
			.locator('input[type="file"]')
			.setInputFiles({ name: "guide.txt", mimeType: "text/plain", buffer: Buffer.from(content) });
	await expect(files.getByRole("list", { name: "文件配置", exact: true }).getByRole("listitem")).toHaveCount(2);
	expect(calls).toEqual([]);
	const saved = saveInlineDraft(page);
	try {
		await expect.poll(() => calls.filter((path) => path.endsWith("/commit")).length).toBe(1);
		await expect(inlineNext(page)).toBeDisabled();
		await expect(page.getByTestId("template-list-tab")).toBeDisabled();
	} finally {
		gate.resolve();
	}
	await saved;
	expect(calls.filter((path) => path.endsWith("/file-uploads"))).toHaveLength(2);
	expect(calls.filter((path) => path.endsWith("/preview"))).toHaveLength(1);
	expect(calls.filter((path) => path.endsWith("/commit"))).toHaveLength(1);
	const summary = inlineSection(page, "已选配置预览");
	await expect(summary).toContainText("guide.txt");
	await expect(summary).toContainText("guide-2.txt");
});

test("文件页内创建：提交明确失败后复用暂存，移除清空与窄屏可用", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openInlineTemplate(page);
	const files = inlineSection(page, "文件");
	const calls: string[] = [];
	let commits = 0;
	await page.route(`${inlineApi}/api/admin/resource-drafts/*/resources/file-uploads**`, async (route) => {
		if (route.request().method() === "POST") calls.push(new URL(route.request().url()).pathname);
		if (route.request().url().endsWith("/commit") && ++commits === 1)
			return route.fulfill({ status: 409, json: { error: { code: "conflict", message: "暂存可重试" } } });
		await route.continue();
	});
	await files
		.locator('input[type="file"]')
		.setInputFiles({ name: "retry.txt", mimeType: "text/plain", buffer: Buffer.from("retry") });
	await inlineNext(page).click();
	await expect(page.getByRole("alert").filter({ hasText: "暂存可重试" }).first()).toBeVisible();
	await inlineNext(page).click();
	await expect(inlineReview(page)).toBeVisible();
	await inlineReview(page).getByRole("button", { name: "取消", exact: true }).click();
	expect(calls.filter((path) => path.endsWith("/file-uploads"))).toHaveLength(1);
	expect(commits).toBe(2);
	await files.getByRole("button", { name: "清空", exact: true }).click();
	await expect(files.getByRole("list", { name: "文件配置", exact: true }).getByRole("listitem")).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("文件页内创建：审计员不能上传或保存", async ({ page }) => {
	await openInlineTemplate(page, "auditor");
	await expect(inlineSection(page, "文件").locator('input[type="file"]')).toBeDisabled();
	await expect(inlineNext(page)).toBeDisabled();
});
