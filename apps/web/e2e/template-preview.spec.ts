import type { TemplateView } from "@openagentpack/kit-sdk/protocol";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";
import { confirmTemplateAgentSelection, openTemplateAgentPicker } from "./template-agent-selection-helpers.ts";
import { selectInlineEnvironment } from "./template-inline-helpers.ts";

const apiBase = process.env.KIT_E2E_API_URL ?? "http://localhost:8787";
const sessionsUrl = `${apiBase}/api/admin/debug/sessions`;
const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };
const preview = (page: Page) => page.getByRole("region", { name: "模版预览调试", exact: true });

async function expectDeleted(request: APIRequestContext, id: string) {
	await expect.poll(async () => (await request.get(`${sessionsUrl}/${id}`, { headers })).status()).toBe(404);
}

// 保护恢复的向导生命周期：配置往返复用，运行时改变立即清理，保存成功清理且保持完整配置。
test("模版预览：窄屏自动创建、返回保留、展示变更复用、运行时变更清理后重建并保存", async ({ page, request }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const sessions: string[] = [];
	const creations: Record<string, unknown>[] = [];
	let saved: TemplateView | undefined;
	const name = `kit-e2e-preview-${Date.now()}`;
	page.on("request", (outgoing) => {
		if (outgoing.url() === sessionsUrl && outgoing.method() === "POST") creations.push(outgoing.postDataJSON());
	});
	async function enter() {
		const response = page.waitForResponse((response) => response.url() === sessionsUrl && response.status() === 201);
		await page.getByRole("button", { name: "下一步：预览调试", exact: true }).click();
		const id = (await (await response).json()).data.session_id as string;
		sessions.push(id);
		await expect(preview(page)).toContainText(`调试会话：${id}`);
		await expect(page.getByRole("button", { name: "保存智能体", exact: true })).toBeEnabled();
		return id;
	}
	try {
		const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
		url.searchParams.set("api", apiBase);
		await page.goto(url.href);
		await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
		await page.getByRole("button", { name: "进入", exact: true }).click();
		await openConsoleNavigation(page);
		await page.getByTestId("template-create-tab").click();
		await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
		await expect(page.getByRole("button", { name: "第 1 步：选择配置", exact: true })).toHaveAttribute(
			"aria-current",
			"step",
		);
		await expect(page.getByRole("button", { name: "第 2 步：预览调试", exact: true })).toBeDisabled();
		await page
			.getByRole("region", { name: "展示配置", exact: true })
			.getByRole("textbox", { name: "智能体名称", exact: true })
			.fill(name);
		await openTemplateAgentPicker(page);
		await page.getByRole("button", { name: "选择智能体 designer（agent_mock_designer）", exact: true }).click();
		await confirmTemplateAgentSelection(page);
		await selectInlineEnvironment(page, "选择环境 默认环境（env_mock_default）");
		await page.getByRole("textbox", { name: "开场白", exact: true }).fill("原开场白");
		await page.getByRole("textbox", { name: "示例问题（每行一条）", exact: true }).fill("验证预览对话");
		const first = await enter();
		await expect(page.getByRole("button", { name: "第 2 步：预览调试", exact: true })).toHaveAttribute(
			"aria-current",
			"step",
		);
		await expect(page.getByRole("region", { name: "展示配置", exact: true })).toBeHidden();
		await expect(preview(page)).toContainText("原开场白");
		expect(creations[0]).toMatchObject({
			remote_agent_id: "agent_mock_designer",
			agent_version: 3,
			remote_environment_id: "env_mock_default",
		});
		await preview(page).getByRole("button", { name: "验证预览对话", exact: true }).click();
		await preview(page).getByRole("button", { name: "发送", exact: true }).click();
		await expect(preview(page).getByRole("region", { name: "消息列表", exact: true })).toContainText(
			"这是 mock gateway 的流式回答",
		);
		await page.getByRole("button", { name: "上一步：选择配置", exact: true }).click();
		await expect(preview(page)).toBeHidden();
		expect((await request.get(`${sessionsUrl}/${first}`, { headers })).status()).toBe(200);
		await page
			.getByRole("region", { name: "展示配置", exact: true })
			.getByRole("textbox", { name: "描述", exact: true })
			.fill("更新的展示描述");
		await page.getByRole("combobox", { name: "分类", exact: true }).selectOption("coding");
		await page.getByRole("button", { name: "第 2 步：预览调试", exact: true }).click();
		await expect(preview(page)).toContainText(first);
		await expect(preview(page)).toContainText("更新的展示描述");
		await expect(preview(page)).toContainText("验证预览对话");
		expect(creations).toHaveLength(1);
		await page.getByRole("button", { name: "第 1 步：选择配置", exact: true }).click();
		await selectInlineEnvironment(page, "选择环境 数据分析环境（env_mock_analysis）");
		await expectDeleted(request, first);
		const second = await enter();
		expect(second).not.toBe(first);
		expect(creations[1]).toMatchObject({ agent_version: 3, remote_environment_id: "env_mock_analysis" });
		await expect(preview(page).getByRole("combobox", { name: "消息输入", exact: true })).toHaveValue("");
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
		await page.getByRole("button", { name: "保存智能体", exact: true }).click();
		const response = page.waitForResponse(
			(response) => response.url() === `${apiBase}/api/admin/templates` && response.status() === 201,
		);
		await page
			.getByRole("dialog", { name: "保存智能体", exact: true })
			.getByRole("button", { name: "保存", exact: true })
			.click();
		saved = (await (await response).json()).data as TemplateView;
		expect(saved).toMatchObject({
			category: "coding",
			description: "更新的展示描述",
			agent_version: 3,
			remote_environment_id: "env_mock_analysis",
		});
		await expect(page.getByRole("heading", { name: "智能体管理", exact: true })).toBeVisible();
		await expectDeleted(request, second);
	} finally {
		await page.goto("about:blank");
		for (const id of sessions) {
			const plan = await request.post(`${sessionsUrl}/${id}/plan`, { headers, data: { action: "delete" } });
			if (plan.status() === 404) continue;
			expect(plan.ok()).toBe(true);
			const { data } = await plan.json();
			expect(
				(
					await request.delete(`${sessionsUrl}/${id}`, {
						headers,
						data: { plan_id: data.plan_id, confirm_token: data.confirm_token },
					})
				).ok(),
			).toBe(true);
		}
		if (saved) {
			const url = `${apiBase}/api/admin/templates/${saved.template_id}`;
			const plan = await request.post(`${url}/delete/plan`, { headers });
			expect(plan.ok()).toBe(true);
			const { data } = await plan.json();
			expect(
				(
					await request.delete(url, { headers, data: { plan_id: data.plan_id, confirm_token: data.confirm_token } })
				).ok(),
			).toBe(true);
		}
	}
});
