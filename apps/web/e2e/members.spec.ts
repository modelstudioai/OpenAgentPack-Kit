import { join } from "node:path";
import type { Page, Response } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";

// 可在隔离端口运行；核心流程始终使用真实 Kit Server 路由与临时 SQLite。
const consoleUrl = process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/";

async function screenshot(page: Page, name: string): Promise<void> {
	const directory = process.env.KIT_E2E_ARTIFACT_DIR;
	if (directory) await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
}

async function expectNoPageOverflow(page: Page): Promise<void> {
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
		await page.evaluate(() => document.documentElement.clientWidth),
	);
}

function isMembersResponse(response: Response, method: "GET" | "POST"): boolean {
	return new URL(response.url()).pathname === "/api/admin/members" && response.request().method() === method;
}

async function openMembers(page: Page): Promise<void> {
	await page.goto(consoleUrl);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await openConsoleNavigation(page);
	const listed = page.waitForResponse((response) => isMembersResponse(response, "GET"));
	await page.getByTestId("members-tab").click();
	expect((await listed).ok()).toBe(true);
	await expect(page.getByRole("heading", { name: "成员管理", exact: true })).toBeVisible();
}

async function fillMember(page: Page, username: string, displayName: string): Promise<void> {
	await page.getByRole("textbox", { name: "用户名", exact: true }).fill(username);
	await page.getByRole("textbox", { name: "显示名", exact: true }).fill(displayName);
	await page.getByRole("textbox", { name: /^邮箱/ }).fill(`${username}@example.test`);
}

async function createMember(page: Page): Promise<Response> {
	const created = page.waitForResponse((response) => isMembersResponse(response, "POST"));
	await page.getByRole("button", { name: "立即创建", exact: true }).click();
	return created;
}

async function searchMembers(page: Page, search: string): Promise<Response> {
	await page.getByPlaceholder("用户名或显示名搜索").fill(search);
	const listed = page.waitForResponse((response) => isMembersResponse(response, "GET"));
	await page.getByRole("button", { name: "搜索", exact: true }).click();
	return listed;
}

test("成员管理：自动密码仅在创建成功时展示，返回及刷新后只保留成员资料", async ({ page }) => {
	const username = `auto-${Date.now()}`;
	const displayName = `自动密码成员 ${Date.now()}`;
	await openMembers(page);
	await page.getByRole("button", { name: "创建用户", exact: true }).first().click();
	await fillMember(page, username, displayName);
	await expect(page.getByRole("radio", { name: "自动生成密码", exact: true })).toBeChecked();
	await screenshot(page, "members-desktop-create");
	// 真正保存到服务端后暂缓交付响应，证明请求未完成时不能离开并丢失一次性密码。
	let notifySaved = () => {};
	const saved = new Promise<void>((resolve) => {
		notifySaved = resolve;
	});
	let releaseResponse = () => {};
	const responseGate = new Promise<void>((resolve) => {
		releaseResponse = resolve;
	});
	await page.route("**/api/admin/members", async (route) => {
		if (route.request().method() !== "POST") return route.continue();
		const response = await route.fetch();
		notifySaved();
		await responseGate;
		await route.fulfill({ response });
	});
	const created = createMember(page);
	try {
		await saved;
		const navigation = page.getByRole("navigation", { name: "管理端导航" });
		for (const button of await navigation.getByRole("button").all()) await expect(button).toBeDisabled();
		await expect(page.getByRole("button", { name: "返回成员列表", exact: true })).toBeDisabled();
		await expect(page.getByRole("textbox", { name: "用户名", exact: true })).toBeDisabled();
	} finally {
		releaseResponse();
	}
	expect((await created).ok()).toBe(true);
	await page.unroute("**/api/admin/members");
	await expect(page.getByRole("heading", { name: "用户创建成功", exact: true })).toBeVisible();
	await expect(page.getByTestId("template-list-tab")).toBeEnabled();
	const password = (await page.getByTestId("initial-password").textContent()) ?? "";
	expect(password.length).toBeGreaterThanOrEqual(8);

	// 仅替换操作系统剪贴板，避免测试覆盖用户剪贴板；创建请求和返回数据不作网络替换。
	await page.evaluate(() => {
		let copied = "";
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async (value: string) => {
					copied = value;
				},
				readText: async () => copied,
			},
		});
	});
	await page.getByTestId("initial-password").getByRole("button").click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(password);
	const browserStorage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
	expect(browserStorage).not.toContain(password);

	await page.getByRole("button", { name: "返回成员列表", exact: true }).click();
	await expect(page.getByRole("row", { name: new RegExp(username) })).toContainText(displayName);
	await expect(page.getByTestId("initial-password")).toHaveCount(0);
	await page.reload();
	await page.getByTestId("members-tab").click();
	const listed = await searchMembers(page, username);
	expect(listed.ok()).toBe(true);
	const listBody = await listed.text();
	expect(listBody).not.toContain(password);
	expect(listBody).not.toMatch(/initial_password|password_hash/);
	const row = page.getByRole("row", { name: new RegExp(username) });
	await expect(row).toBeVisible();
	await expect(row).toContainText(`${username}@example.test`);
	await expect(page.getByTestId("initial-password")).toHaveCount(0);
	await expect(page.getByText(password, { exact: true })).toHaveCount(0);
	await screenshot(page, "members-desktop-list");
});

test("成员管理：手机可创建自定义密码成员，重名保留草稿，搜索支持匹配和空态", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const username = `custom-${Date.now()}`;
	const displayName = `自定义密码成员 ${Date.now()}`;
	const password = "Member-E2e!2026";
	await openMembers(page);
	await page.getByRole("button", { name: "创建用户", exact: true }).first().click();
	await fillMember(page, username, displayName);
	await page.getByRole("radio", { name: "自定义密码", exact: true }).check();
	await page.getByLabel(/^初始密码/).fill(password);
	await expectNoPageOverflow(page);
	await screenshot(page, "members-mobile-create");
	const created = await createMember(page);
	expect(created.ok()).toBe(true);
	expect(await created.text()).not.toContain(password);
	await expect(page.getByRole("heading", { name: "用户创建成功", exact: true })).toBeVisible();
	await expect(page.getByTestId("initial-password")).toHaveCount(0);
	await page.getByRole("button", { name: "返回成员列表", exact: true }).click();
	await expect(page.getByRole("row", { name: new RegExp(username) })).toBeVisible();
	await screenshot(page, "members-mobile-list");
	await expectNoPageOverflow(page);

	await page.getByRole("button", { name: "创建用户", exact: true }).first().click();
	await fillMember(page, username, "重名后保留的草稿");
	await page.getByRole("radio", { name: "自定义密码", exact: true }).check();
	await page.getByLabel(/^初始密码/).fill(password);
	expect((await createMember(page)).status()).toBe(409);
	await expect(page.getByText(/用户名已存在/)).toBeVisible();
	await openConsoleNavigation(page);
	await expect(page.getByTestId("template-list-tab")).toBeEnabled();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog", { name: "管理端导航菜单", exact: true })).toHaveCount(0);
	await expect(page.getByRole("textbox", { name: "用户名", exact: true })).toHaveValue(username);
	await expect(page.getByRole("textbox", { name: "显示名", exact: true })).toHaveValue("重名后保留的草稿");
	await expect(page.getByRole("textbox", { name: /^邮箱/ })).toHaveValue(`${username}@example.test`);
	await expect(page.getByLabel(/^初始密码/)).toHaveValue(password);

	const correctedUsername = `${username}-new`;
	await page.getByRole("textbox", { name: "用户名", exact: true }).fill(correctedUsername);
	expect((await createMember(page)).ok()).toBe(true);
	await page.getByRole("button", { name: "返回成员列表", exact: true }).click();
	expect((await searchMembers(page, "重名后保留的草稿")).ok()).toBe(true);
	await expect(page.getByRole("row", { name: new RegExp(correctedUsername) })).toBeVisible();
	await expect(page.getByRole("row", { name: new RegExp(`${username}@example.test`) })).toHaveCount(1);
	expect((await searchMembers(page, `no-such-${Date.now()}`)).ok()).toBe(true);
	await expect(page.getByText("未找到匹配的用户", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "创建用户", exact: true }).first()).toBeVisible();
	await expect(page.getByRole("button", { name: "搜索", exact: true })).toBeVisible();
});
