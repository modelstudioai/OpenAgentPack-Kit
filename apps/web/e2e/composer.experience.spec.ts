import { expect, test } from "./fixtures.ts";
import { seedListedAgent } from "./helpers.ts";

// 保护窄屏下的真实输入流程：键盘挤压、附件预览和待审批时的停止入口不能移出可见区域。
test("悬浮输入卡：短视口保留焦点、附件框内展示、停止后保留草稿", async ({ page, request }, testInfo) => {
	const originalViewport = page.viewportSize();
	const slug = `composer-${Date.now().toString(36)}-${testInfo.project.name}`;
	await seedListedAgent(request, slug, slug);
	await page.setViewportSize({ width: 320, height: 844 });
	await page.goto(`/?agent=${slug}`);
	const input = page.getByLabel("消息输入", { exact: true });
	const form = page.locator("form").filter({ has: input });
	const attach = form.getByRole("button", { name: "添加附件", exact: true });
	const send = form.getByRole("button", { name: "发送", exact: true });
	const stop = form.getByRole("button", { name: "停止", exact: true });
	const draft = [
		"approval：检查附件并等待确认",
		...Array.from({ length: 8 }, (_, index) => `第 ${index + 1} 项核对内容`),
	].join("\n");
	await expect(input).toBeVisible();
	await input.fill(draft);
	await input.focus();

	const assertComposerFits = async (visibleHeight: number, running = false) => {
		const action = running ? stop : send;
		await expect(action).toBeEnabled();
		await expect
			.poll(async () => {
				const [card, field, attachment, button] = await Promise.all([
					form.boundingBox(),
					input.boundingBox(),
					attach.boundingBox(),
					action.boundingBox(),
				]);
				if (!card || !field || !attachment || !button) return false;
				return (
					card.y >= 0 &&
					card.y + card.height <= visibleHeight + 1 &&
					field.y + field.height <= attachment.y + 1 &&
					field.y + field.height <= button.y + 1 &&
					attachment.x + attachment.width <= button.x &&
					button.x + button.width <= card.x + card.width
				);
			})
			.toBe(true);
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
			.toBe(true);
	};

	await assertComposerFits(844);
	// 模拟只缩小 visualViewport 的软键盘；仅改变浏览器公开视口输入，验收用户可见的几何与焦点。
	await page.evaluate(() => {
		const viewport = window.visualViewport;
		if (!viewport) throw new Error("本浏览器需要支持 VisualViewport");
		Object.defineProperty(viewport, "height", { configurable: true, value: 360 });
		viewport.dispatchEvent(new Event("resize"));
	});
	await assertComposerFits(360);
	await expect(input).toBeFocused();
	await expect(input).toHaveText(draft, { useInnerText: true });
	await page.evaluate(() => {
		const viewport = window.visualViewport;
		if (!viewport) return;
		Reflect.deleteProperty(viewport, "height");
		viewport.dispatchEvent(new Event("resize"));
	});
	await page.setViewportSize({ width: 320, height: 360 });
	await assertComposerFits(360);
	await expect(input).toBeFocused();

	const filename = "跨部门核对材料与执行说明-long-attachment-name.txt";
	await attach.click();
	const [chooser] = await Promise.all([
		page.waitForEvent("filechooser"),
		page.getByRole("menuitem", { name: "上传文件", exact: true }).click(),
	]);
	await chooser.setFiles({ name: filename, mimeType: "text/plain", buffer: Buffer.from("composer layout fixture") });
	await expect(form.getByText(filename, { exact: true }).first()).toBeVisible();
	await expect(form.getByRole("button", { name: `移除 ${filename}`, exact: true })).toBeVisible();
	await expect(input).toHaveText(draft, { useInnerText: true });
	await assertComposerFits(360);
	await page.screenshot({ path: testInfo.outputPath("composer-short-viewport.png") });

	await send.click();
	await expect(page.getByRole("region", { name: "工具审批 read_file", exact: true })).toBeVisible();
	await expect(stop).toBeEnabled();
	const pendingDraft = [
		"停止时仍保留这份草稿",
		...Array.from({ length: 8 }, (_, index) => `补充核对 ${index + 1}`),
	].join("\n");
	await input.fill(pendingDraft);
	// 等待审批时允许准备下一轮附件，不能因此把当前执行的停止入口挤出屏幕。
	await attach.click();
	const [nextChooser] = await Promise.all([
		page.waitForEvent("filechooser"),
		page.getByRole("menuitem", { name: "上传文件", exact: true }).click(),
	]);
	await nextChooser.setFiles({ name: "next-turn.txt", mimeType: "text/plain", buffer: Buffer.from("next turn") });
	await expect(form.getByRole("button", { name: "移除 next-turn.txt", exact: true })).toBeVisible();
	await assertComposerFits(360, true);
	await page.screenshot({ path: testInfo.outputPath("composer-approval-attachment.png") });
	await stop.click();
	await expect(stop).toHaveCount(0);
	await expect(send).toBeEnabled();
	await expect(input).toHaveText(pendingDraft, { useInnerText: true });
	await expect(form.getByText("next-turn.txt", { exact: true })).toBeVisible();
	await expect(form.getByText(filename, { exact: true })).toHaveCount(0);

	if (originalViewport) await page.setViewportSize(originalViewport);
	await input.focus();
	await assertComposerFits(originalViewport?.height ?? 844);
	await expect(input).toBeFocused();
	await page.locator("html").evaluate((element) => element.setAttribute("data-kit-theme", "dark"));
	await page.screenshot({ path: testInfo.outputPath("composer-restored-dark.png") });
});
