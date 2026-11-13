import { fileURLToPath } from "node:url";
import type { MemberView, SessionDetail } from "@openagentpack/kit-sdk/protocol";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, seedListedAgent } from "./helpers.ts";

test("成员删除会话：快照失败可重试，重新确认后删除，管理端仍保留累计用量", async ({ page, request }, testInfo) => {
	const suffix = Date.now().toString(36);
	const username = `usage-${suffix}`;
	const slug = `usage-agent-${suffix}`;
	const displayName = "删除用量回归成员";
	const apiBase = String(testInfo.config.metadata.apiBaseUrl);
	const memberResult = await request.post("/api/admin/members", {
		headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
		data: {
			username,
			display_name: displayName,
			auth_type: "local",
			password_mode: "custom",
			password: "Usage-E2e!2026",
		},
	});
	expect(memberResult.ok()).toBe(true);
	const {
		data: { member },
	} = (await memberResult.json()) as { data: { member: MemberView } };
	await seedListedAgent(request, slug, "用量回归 Agent");
	await page.goto(`${testInfo.config.metadata.webUrl}/?${new URLSearchParams({ api: apiBase, agent: slug })}`);
	await page.getByLabel("用户名", { exact: true }).fill(username);
	await page.getByLabel("密码", { exact: true }).fill("Usage-E2e!2026");
	await page.getByRole("button", { name: "登录", exact: true }).click();
	await expect(page.getByLabel("消息输入")).toBeVisible();
	const created = page.waitForResponse(
		(response) => new URL(response.url()).pathname === "/api/kit/sessions" && response.request().method() === "POST",
	);
	await page.getByLabel("消息输入").fill("统计本轮用量");
	await page.getByRole("button", { name: "发送", exact: true }).click();
	const { data: session } = (await (await created).json()) as { data: SessionDetail };
	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible();
	await expect(page.getByText("空闲", { exact: true })).toBeVisible();

	let deletes = 0;
	let releaseFailure = () => {};
	const failureGate = new Promise<void>((resolve) => {
		releaseFailure = resolve;
	});
	const plans: string[] = [];
	page.on("response", async (response) => {
		if (new URL(response.url()).pathname === `/api/kit/sessions/${session.session_id}/plan` && response.ok()) {
			plans.push(((await response.json()) as { data: { plan_id: string } }).data.plan_id);
		}
	});
	await page.route(`**/api/kit/sessions/${session.session_id}`, async (route) => {
		if (route.request().method() !== "DELETE") return route.continue();
		deletes += 1;
		if (deletes > 1) return route.continue();
		await failureGate;
		return route.fulfill({
			status: 409,
			json: { error: { code: "conflict", message: "用量快照保存失败，请重试", retryable: true } },
		});
	});
	const actions = page.getByRole("button", { name: "更多操作", exact: true }).first();
	await actions.click();
	await page.getByRole("menuitem", { name: "删除", exact: true }).first().click();
	const dialog = page.getByRole("alertdialog", { name: "删除会话" });
	await expect(dialog).toContainText("成功后才删除会话");
	await dialog.getByRole("button", { name: "确认", exact: true }).click();
	try {
		await expect(dialog.getByRole("button", { name: "处理中…", exact: true })).toBeDisabled();
		await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
	} finally {
		releaseFailure();
	}
	await expect(dialog).toContainText("用量快照保存失败，请重试");
	await expect(page.getByRole("button", { name: "更多操作", exact: true }).first()).toBeAttached();
	await dialog.getByRole("button", { name: "重新获取计划", exact: true }).click();
	await expect(dialog).toContainText("成功后才删除会话");
	expect(deletes).toBe(1);
	const deleted = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === `/api/kit/sessions/${session.session_id}` &&
			response.request().method() === "DELETE",
	);
	await dialog.getByRole("button", { name: "确认", exact: true }).click();
	expect((await deleted).ok()).toBe(true);
	await expect(dialog).toHaveCount(0);
	await expect(page.getByRole("button", { name: "删除会话", exact: true })).toHaveCount(0);
	expect(deletes).toBe(2);
	expect(new Set(plans).size).toBe(2);

	await page.goto(`${testInfo.config.metadata.consoleUrl}/?api=${encodeURIComponent(apiBase)}`);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await page.getByTestId("members-tab").click();
	await page
		.getByRole("row", { name: new RegExp(username) })
		.getByRole("button", { name: "查看用量" })
		.click();
	await expect(page.getByRole("heading", { name: `${displayName}的会话用量` })).toBeVisible();
	await expect(page.getByRole("row", { name: new RegExp(session.session_id) })).toContainText("已删除（用量保留）");
	await expect(page.getByTestId("usage-input_tokens").locator("dd").first()).toHaveText("120");
	await expect(page.getByTestId("usage-output_tokens").locator("dd").first()).toHaveText("80");
	const detail = await request.get(`/api/admin/members/${member.member_id}/usage`, {
		headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
	});
	expect((await detail.json()).data).toMatchObject({ session_count: 1, deleted_session_count: 1 });
	await page.screenshot({
		path: fileURLToPath(new URL("../../../.scratch/member-usage/member-usage-detail.png", import.meta.url)),
		fullPage: true,
	});
});
