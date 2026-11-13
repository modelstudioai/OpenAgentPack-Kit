import type { ResourceDraftView } from "@openagentpack/kit-sdk/protocol";
import type { Dialog, Page } from "@playwright/test";
import { expect } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";
import { confirmTemplateAgentSelection, openTemplateAgentPicker } from "./template-agent-selection-helpers.ts";

export const inlineApi = process.env.KIT_E2E_API_URL ?? "http://localhost:8787";
export const inlineSection = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
export const inlineNext = (page: Page) =>
	page.getByRole("button", { name: "下一步：预览调试", exact: true, includeHidden: true });
export const inlineReview = (page: Page) => page.getByRole("dialog", { name: "确认发布", exact: true });
const ownedDrafts = new WeakMap<Page, Set<string>>();

/** 使用隔离 Mock 服务验证页内草稿，不自动确认资源发布。 */
export async function openInlineTemplate(page: Page, role: "admin" | "auditor" = "admin") {
	if (!ownedDrafts.has(page)) {
		const ids = new Set<string>();
		ownedDrafts.set(page, ids);
		page.on("response", async (response) => {
			if (
				response.url() === `${inlineApi}/api/admin/resource-drafts` &&
				response.request().method() === "POST" &&
				response.ok()
			) {
				const result = await response.json().catch(() => null);
				if (result?.data?.draft_id) ids.add(result.data.draft_id);
			}
		});
	}
	const url = new URL("/templates/new", process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.searchParams.set("api", inlineApi);
	await page.addInitScript(
		(backend) => {
			try {
				localStorage.removeItem(`kit_admin_token:${backend}`);
			} catch {
				/* about:blank 无存储。 */
			}
		},
		inlineApi.replace(/\/+$/, ""),
	);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(role === "admin" ? ADMIN_TOKEN : "e2e-auditor");
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await expect(page.getByRole("heading", { name: "创建智能体", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
	if (role === "admin")
		await page
			.getByRole("region", { name: "展示配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true })
			.fill(`kit-e2e-inline-${Date.now()}`);
	await openTemplateAgentPicker(page);
	await page.getByRole("button", { name: "选择智能体 assistant（agent_mock_assistant）", exact: true }).click();
	await confirmTemplateAgentSelection(page);
}

export async function openInlinePicker(page: Page, name: string) {
	await inlineSection(page, name).getByRole("button", { name: "导入现有配置", exact: true }).click();
	const picker = page.getByRole("dialog", { name: "选择配置", exact: true });
	await expect(picker).toBeVisible();
	return picker;
}

export async function selectInlineEnvironment(page: Page, name: string) {
	const picker = await openInlinePicker(page, "环境");
	await picker.getByRole("button", { name: name.replace(/^选择环境 /, "查看环境详情 ") }).click();
	await page
		.getByRole("dialog", { name: "环境详情", exact: true })
		.getByRole("button", { name: "确认选择", exact: true })
		.click();
	await expect(picker).toHaveCount(0);
}

export async function saveInlineDraft(page: Page): Promise<ResourceDraftView> {
	const created = page.waitForResponse(
		(response) => response.url() === `${inlineApi}/api/admin/resource-drafts` && response.request().method() === "POST",
	);
	await inlineNext(page).click();
	const { data } = await (await created).json();
	await expect(inlineReview(page)).toBeVisible();
	await inlineReview(page).getByRole("button", { name: "取消", exact: true }).click();
	return data;
}

export async function leaveInlineTemplate(page: Page) {
	if (page.isClosed() || page.url() === "about:blank") return;
	if (new URL(page.url()).pathname === "/templates/new") {
		await page.keyboard.press("Escape");
		await openConsoleNavigation(page);
		await page.getByTestId("template-list-tab").click();
		const exit = page.getByRole("alertdialog", { name: "确认退出", exact: true });
		const list = inlineSection(page, "模版列表");
		await expect.poll(async () => (await exit.isVisible()) || (await list.isVisible())).toBe(true);
		if (await exit.isVisible()) await exit.getByRole("button", { name: "确认退出", exact: true }).click();
		await expect(list).toBeVisible();
	}
	for (const id of ownedDrafts.get(page) ?? []) {
		await expect
			.poll(async () => {
				const response = await page.request.get(`${inlineApi}/api/admin/resource-drafts/${id}`, {
					headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
				});
				return response.status() === 404 || (response.ok() && (await response.json()).data.status === "published");
			})
			.toBe(true);
	}
	const accept = (dialog: Dialog) => dialog.accept();
	page.on("dialog", accept);
	try {
		await page.goto("about:blank");
	} finally {
		page.off("dialog", accept);
	}
}
