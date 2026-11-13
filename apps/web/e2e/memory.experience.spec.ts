import { expect, test } from "./fixtures.ts";
import { seedListedAgent } from "./helpers.ts";

// 资源面板「记忆库」分区：成员详情只投影目录配置的库名称与描述（无库 ID/权限/条目）。
test("资源面板记忆库：展示库名称与描述，可折叠", async ({ page, baseURL, request, isMobile }) => {
	await seedListedAgent(request, "memory-agent", "记忆库助手", [{ memory_store_id: "memory-guide" }]);
	const apiBase = new URL(baseURL as string).origin;
	await page.goto(`/?agent=memory-agent&api=${encodeURIComponent(apiBase)}`);
	if (isMobile) await page.getByRole("button", { name: "展开资源面板", exact: true }).click();
	const section = page.locator("details").filter({ has: page.getByText("记忆库", { exact: true }) });
	await expect(section).toBeVisible();
	await expect(page.getByText("项目知识库", { exact: true })).toBeVisible();
	await expect(page.getByText("沉淀项目约定与文档要点，需要时先查这里。")).toBeVisible();
	await section.locator("summary").click();
	await expect(page.getByText("项目知识库", { exact: true })).toBeHidden();
	await section.locator("summary").click();
	await expect(page.getByText("项目知识库", { exact: true })).toBeVisible();
});

test("未配置记忆库的 Agent 不渲染记忆库分区", async ({ page, baseURL, request, isMobile }) => {
	await seedListedAgent(request);
	const apiBase = new URL(baseURL as string).origin;
	await page.goto(`/?agent=e2e-agent&api=${encodeURIComponent(apiBase)}`);
	if (isMobile) await page.getByRole("button", { name: "展开资源面板", exact: true }).click();
	// 先证明详情查询已完成并渲染资源，避免初始化前的空态使负向断言误通过。
	await expect(page.getByText("research", { exact: true })).toBeVisible();
	await expect(page.locator("summary").filter({ hasText: "记忆库" })).toHaveCount(0);
});
