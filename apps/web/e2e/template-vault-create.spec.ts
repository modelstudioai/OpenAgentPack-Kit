import { expect, test } from "./fixtures.ts";
import {
	inlineApi,
	inlineNext,
	inlineSection,
	leaveInlineTemplate,
	openInlineTemplate,
	saveInlineDraft,
} from "./template-inline-helpers.ts";

test.afterEach(async ({ page }) => leaveInlineTemplate(page));

test("密钥库页内创建：密钥取消零写入，填写与确认后下一步单飞保存，引用不回显值", async ({ page }) => {
	await openInlineTemplate(page);
	const vault = inlineSection(page, "密钥库");
	const bodies: Record<string, unknown>[] = [];
	const gate = Promise.withResolvers<void>();
	await page.route(`${inlineApi}/api/admin/resource-drafts/*/resources/vaults`, async (route) => {
		bodies.push(route.request().postDataJSON());
		await gate.promise;
		await route.continue();
	});
	await vault.getByRole("textbox", { name: "密钥库名称", exact: true }).fill("kit-e2e-inline-vault");
	await vault.getByRole("button", { name: "添加密钥", exact: true }).click();
	let dialog = page.getByRole("dialog", { name: "添加密钥", exact: true });
	await dialog.getByRole("textbox", { name: "名称", exact: true }).fill("未保存密钥");
	await dialog.getByRole("button", { name: "取消", exact: true }).click();
	await expect(vault.getByText("未保存密钥", { exact: true })).toHaveCount(0);
	await vault.getByRole("button", { name: "添加密钥", exact: true }).click();
	dialog = page.getByRole("dialog", { name: "添加密钥", exact: true });
	await dialog.getByRole("textbox", { name: "名称", exact: true }).fill("项目服务");
	await dialog.getByRole("textbox", { name: "变量名", exact: true }).fill("PROJECT_API_KEY");
	await dialog.getByLabel(/变量值/).fill("fixture-inline-credential");
	await dialog.getByRole("textbox", { name: "密钥替换生效域名", exact: true }).fill("api.example.test");
	await expect(dialog.getByRole("button", { name: "添加", exact: true })).toBeDisabled();
	await dialog.getByRole("checkbox").check();
	await dialog.getByRole("button", { name: "添加", exact: true }).click();
	expect(bodies).toEqual([]);
	const saved = saveInlineDraft(page);
	try {
		await expect.poll(() => bodies.length).toBe(1);
		await expect(inlineNext(page)).toBeDisabled();
		await expect(page.getByTestId("template-list-tab")).toBeDisabled();
	} finally {
		gate.resolve();
	}
	await saved;
	expect(bodies[0]).toMatchObject({
		display_name: "kit-e2e-inline-vault",
		credentials: [
			{
				name: "项目服务",
				secret_name: "PROJECT_API_KEY",
				secret_value: "fixture-inline-credential",
				allowed_hosts: ["api.example.test"],
				acknowledged: true,
			},
		],
	});
	await expect(vault).not.toContainText("fixture-inline-credential");
	await expect(vault.getByRole("button", { name: "编辑密钥 项目服务", exact: true })).toBeVisible();
});

test("密钥库页内创建：空白名称阻止下一步，Escape 取消密钥后清空草稿，窄屏和只读可用", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openInlineTemplate(page);
	const vault = inlineSection(page, "密钥库");
	await vault.getByRole("button", { name: "添加密钥库", exact: true }).click();
	await expect(inlineNext(page)).toBeDisabled();
	await expect(vault.getByText("请输入密钥库名称", { exact: true })).toHaveCount(0);
	await vault.getByRole("textbox", { name: "密钥库名称", exact: true }).fill("kit-e2e-inline-cancel");
	await vault.getByRole("button", { name: "添加密钥", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "添加密钥", exact: true });
	await dialog.getByLabel(/变量值/).fill("fixture-cancel-value");
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
	await expect(inlineNext(page)).toBeEnabled();
	await vault.getByRole("button", { name: "清空", exact: true }).click();
	await expect(vault.getByRole("textbox", { name: "密钥库名称", exact: true })).toHaveValue("");
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await leaveInlineTemplate(page);
	await openInlineTemplate(page, "auditor");
	await expect(vault.getByRole("textbox", { name: "密钥库名称", exact: true })).toBeDisabled();
	await expect(vault.getByRole("button", { name: "添加密钥", exact: true })).toBeDisabled();
});
