import type { ResourceDraftView } from "@openagentpack/kit-sdk/protocol";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN } from "./helpers.ts";
import { confirmTemplateAgentSelection, openTemplateAgentPicker } from "./template-agent-selection-helpers.ts";

const apiBase = process.env.KIT_E2E_API_URL ?? "http://localhost:8787";
const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };

async function loginConsole(page: Page) {
	const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.searchParams.set("api", apiBase);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
	await page.getByRole("button", { name: "进入", exact: true }).click();
}

async function enterCreate(page: Page) {
	await page.getByTestId("template-create-tab").click();
	await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
	await page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true })
		.fill(`退出确认-${Date.now()}`);
	await openTemplateAgentPicker(page);
	await page.getByRole("button", { name: "选择智能体 assistant（agent_mock_assistant）", exact: true }).click();
	await confirmTemplateAgentSelection(page);
}

async function createEnvironment(page: Page, name = `kit-e2e-exit-${Date.now()}`) {
	const section = page.getByRole("region", { name: "环境", exact: true });
	await section.getByRole("button", { name: "清空", exact: true }).click();
	await section.getByRole("textbox", { name: "环境名称", exact: true }).fill(name);
	const saved = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			/\/resource-drafts\/[^/]+\/resources\/environments$/.test(response.url()),
	);
	await page.getByRole("button", { name: "下一步：预览调试", exact: true }).click();
	const nameOfDraft = new URL((await saved).url()).pathname.split("/")[4];
	const review = page.getByRole("dialog", { name: "确认发布", exact: true });
	await expect(review).toBeVisible();
	await review.getByRole("button", { name: "取消", exact: true }).click();
	const response = await page.request.get(`${apiBase}/api/admin/resource-drafts/${nameOfDraft}`, { headers });
	return (await response.json()).data as ResourceDraftView;
}

// 浏览器取消导航与 pagehide 保活必须用真实 Mock 服务证明，不能用页面路由拦截替代卸载请求。
test("退出确认：取消刷新保留草稿，确认刷新才清理，已发布资源退出不再提示", async ({ page, request }) => {
	await loginConsole(page);
	await enterCreate(page);
	const draft = await createEnvironment(page);
	const read = (id: string) => request.get(`${apiBase}/api/admin/resource-drafts/${id}`, { headers });
	const discardRequests: string[] = [];
	page.on("request", (entry) => {
		if (entry.method() === "POST" && entry.url().endsWith("/discard")) discardRequests.push(entry.url());
	});
	let beforeUnloadCount = 0;
	let allowLeave = false;
	// 持续监听，避免 once 自动解除最后一个监听器时由 Playwright 自动接受原生弹窗。
	page.on("dialog", async (dialog) => {
		expect(dialog.type()).toBe("beforeunload");
		beforeUnloadCount++;
		if (allowLeave) await dialog.accept();
		else await dialog.dismiss();
	});
	// 取消时没有 load 事件，因此不使用会等待 load 的 page.reload()。
	await page.evaluate(() => window.location.reload());
	await expect.poll(() => beforeUnloadCount).toBe(1);
	await expect(page.getByRole("textbox", { name: "环境名称", exact: true })).toHaveValue(/^kit-e2e-exit-/);
	expect((await read(draft.draft_id)).ok()).toBe(true);
	expect(discardRequests).toEqual([]);
	allowLeave = true;
	await page.reload();
	expect(beforeUnloadCount).toBe(2);
	await expect.poll(async () => (await read(draft.draft_id)).status()).toBe(404);
	await enterCreate(page);
	const next = await createEnvironment(page);
	expect(next.draft_id).not.toBe(draft.draft_id);
	await page.getByRole("button", { name: "下一步：预览调试", exact: true }).click();
	await page
		.getByRole("dialog", { name: "确认发布", exact: true })
		.getByRole("button", { name: "确认发布", exact: true })
		.click();
	await page.getByRole("button", { name: "保存智能体", exact: true }).click();
	const save = page.getByRole("dialog", { name: "保存智能体", exact: true });
	await expect(save).toBeVisible();
	await save.getByRole("button", { name: "取消", exact: true }).click();
	const receipt = (await (await read(next.draft_id)).json()).data as ResourceDraftView;
	expect(receipt.status).toBe("published");
	expect(receipt.resources).toHaveLength(1);
	await page.getByTestId("template-list-tab").click();
	await expect(page.getByRole("region", { name: "模版列表", exact: true })).toBeVisible();
	await expect(page.getByRole("alertdialog", { name: "确认退出", exact: true })).toHaveCount(0);
	expect((await (await read(next.draft_id)).json()).data).toMatchObject(receipt);
	await page.reload();
	expect(beforeUnloadCount).toBe(2);
});

// 独立 context 不共享 Web Locks/localStorage；必须由真实服务端阻止另一浏览器误清理。
test("同一管理员的另一浏览器进入和退出创建页均不删除原浏览器仍在编辑的批次", async ({ page, browser, request }) => {
	const otherContext = await browser.newContext();
	const other = await otherContext.newPage();
	const otherDiscards: string[] = [];
	other.on("request", (entry) => {
		if (entry.method() === "POST" && entry.url().endsWith("/discard")) otherDiscards.push(entry.url());
	});
	try {
		await loginConsole(page);
		await enterCreate(page);
		const firstName = `kit-e2e-isolation-first-${Date.now()}`;
		const draft = await createEnvironment(page, firstName);
		const declarations = async () => {
			const response = await request.get(
				`${apiBase}/api/admin/resource-drafts/${draft.draft_id}/resources/declarations`,
				{
					headers,
				},
			);
			expect(response.ok()).toBe(true);
			return (await response.json()).data;
		};
		const firstDeclarations = await declarations();
		expect(firstDeclarations).toEqual([expect.objectContaining({ type: "environment", name: firstName })]);
		const firstChoice = page.getByRole("textbox", { name: "环境名称", exact: true });
		await expect(firstChoice).toHaveValue(firstName);

		await loginConsole(other);
		const denied = other.waitForResponse(
			(response) => response.url() === `${apiBase}/api/admin/resource-drafts/active` && response.status() === 409,
		);
		await enterCreate(other);
		expect((await (await denied).json()).error.details).toEqual({ reason: "draft_owned_elsewhere" });
		await expect(other.getByRole("alert").filter({ hasText: "已有资源批次属于另一浏览器或页面" })).toBeVisible();
		await expect(firstChoice).toHaveValue(firstName);
		expect(await declarations()).toEqual(firstDeclarations);

		await other.getByTestId("template-list-tab").click();
		await expect(other.getByRole("region", { name: "模版列表", exact: true })).toBeVisible();
		await expect(other.getByRole("alertdialog", { name: "确认退出", exact: true })).toHaveCount(0);
		expect(await declarations()).toEqual(firstDeclarations);
		expect(otherDiscards).toEqual([]);

		const secondName = `kit-e2e-isolation-second-${Date.now()}`;
		expect((await createEnvironment(page, secondName)).draft_id).toBe(draft.draft_id);
		expect(await declarations()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "environment", name: firstName }),
				expect.objectContaining({ type: "environment", name: secondName }),
			]),
		);
		await page.getByTestId("template-list-tab").click();
		await page
			.getByRole("alertdialog", { name: "确认退出", exact: true })
			.getByRole("button", { name: "确认退出", exact: true })
			.click();
		await expect(page.getByRole("region", { name: "模版列表", exact: true })).toBeVisible();
		await expect
			.poll(async () =>
				(await request.get(`${apiBase}/api/admin/resource-drafts/${draft.draft_id}`, { headers })).status(),
			)
			.toBe(404);
	} finally {
		await otherContext.close();
	}
});
