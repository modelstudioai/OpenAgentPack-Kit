import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, seedListedAgent } from "./helpers.ts";

const adminHeaders = { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" };

/** 播种带分类/精选的已上架条目（广场视图依赖 category/featured 字段）。 */
async function seedPlazaAgent(
	request: import("@playwright/test").APIRequestContext,
	slug: string,
	extra: { category?: string; featured?: boolean } = {},
) {
	const created = await request.post("/api/admin/agents", {
		headers: adminHeaders,
		data: { slug, display_name: slug, remote_agent_id: "agent_mock_assistant", description: `${slug} 描述`, ...extra },
	});
	if (!created.ok() && created.status() !== 409) throw new Error(`seed ${slug} failed: ${created.status()}`);
	const planRes = await request.post(`/api/admin/agents/${slug}/plan`, {
		headers: adminHeaders,
		data: { action: "listing", status: "listed" },
	});
	const { data: plan } = (await planRes.json()) as { data: { plan_id: string; confirm_token: string } };
	const listed = await request.patch(`/api/admin/agents/${slug}`, {
		headers: adminHeaders,
		data: { status: "listed", plan_id: plan.plan_id, confirm_token: plan.confirm_token },
	});
	if (!listed.ok()) throw new Error(`list ${slug} failed: ${listed.status()}`);
}

test("广场首页：卡片渲染 + 分类 tab 过滤 + 点卡进聊天", async ({ page, request, isMobile }, testInfo) => {
	if (isMobile) await page.setViewportSize({ width: 320, height: 844 });
	const writer = `plaza-writer-${Date.now()}`;
	const coder = `plaza-coder-${Date.now()}`;
	await seedPlazaAgent(request, writer, { category: "writing", featured: true });
	await seedPlazaAgent(request, coder, { category: "coding" });

	// 同一轮 e2e 里 experience.spec 先跑并共享同一 server/DB：popular 会被带用量的历史条目占满，
	// 因此默认（精选）tab 只断言 featured 条目与分区标题；分类 tab 才是 coder 的确定性入口。
	await page.goto("/");
	await expect(page.getByText("同学们都在用").first()).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId(`plaza-card-${writer}`)).toBeVisible();

	const codingTab = page.getByTestId("plaza-tab-coding");
	await codingTab.focus();
	await page.keyboard.press("Home");
	await expect(page.getByTestId("plaza-tab-featured")).toBeFocused();
	await expect(page.getByTestId("plaza-tab-featured")).toHaveAttribute("aria-selected", "true");
	await codingTab.click();
	await expect(page.getByTestId(`plaza-card-${coder}`)).toBeVisible();
	await expect(page.getByTestId(`plaza-card-${writer}`)).toHaveCount(0);
	await page.getByRole("searchbox", { name: "搜索 Agent" }).fill("does-not-exist-in-plaza");
	await expect(page.getByText("没有匹配的 Agent", { exact: true })).toBeVisible();
	await page.getByRole("searchbox", { name: "搜索 Agent" }).fill("");
	await expect(page.getByTestId(`plaza-card-${coder}`)).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
		.toBe(true);
	await page.screenshot({ path: testInfo.outputPath("plaza-light.png") });
	await page.locator("html").evaluate((element) => element.setAttribute("data-kit-theme", "dark"));
	await page.screenshot({ path: testInfo.outputPath("plaza-dark.png") });

	await page.getByTestId(`plaza-card-${coder}`).getByRole("button", { name: "开始体验" }).click();
	await expect(page.locator("main > header")).toContainText(coder, { timeout: 15_000 });
	await expect(page.getByLabel("消息输入")).toBeVisible();
});

test("用量页：meter 渲染 + 申请提交后进入审批中", async ({ page, request, isMobile }, testInfo) => {
	if (isMobile) await page.setViewportSize({ width: 320, height: 844 });
	const slug = `quota-agent-${Date.now()}`;
	await seedListedAgent(request, slug, slug);
	await page.goto("/?view=usage");
	await expect(page.getByTestId("usage-meter")).toBeVisible({ timeout: 15_000 });

	await page.getByTestId("usage-apply-btn").click();
	const dialog = page.getByTestId("usage-apply-dialog");
	await expect(dialog).toBeVisible();
	const close = dialog.getByRole("button", { name: "关闭申请弹窗", exact: true });
	await expect(close).toBeFocused();
	await page.keyboard.press("Shift+Tab");
	await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
	await expect(page.getByTestId("usage-apply-btn")).toBeFocused();
	await page.getByTestId("usage-apply-btn").click();
	await expect(dialog).toBeVisible();
	await dialog.getByTestId("usage-apply-credits").fill("500");
	await dialog.getByTestId("usage-apply-reason").fill("e2e 提额");
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
		.toBe(true);
	await page.screenshot({ path: testInfo.outputPath("usage-application.png") });
	await dialog.getByTestId("usage-apply-submit").click();

	await expect(page.getByText("审批中").first()).toBeVisible({ timeout: 10_000 });
	await expect(page.getByTestId("usage-apply-btn")).toBeDisabled();
	await page.screenshot({ path: testInfo.outputPath("usage-light.png") });
});

test("配额耗尽横幅 → 管理 API 发加油包 → 恢复发送", async ({ page, request }) => {
	const slug = `quota-block-${Date.now()}`;
	await seedListedAgent(request, slug, slug);

	// 用量表在同轮 e2e 内有历史 subject：用「发送前后增量」定位本测试的匿名 subject
	const usageRows = async () => {
		const res = await request.get("/api/admin/quota/usage", { headers: adminHeaders });
		const body = (await res.json()) as { data: { subject_id: string; used: number }[] };
		return body.data;
	};
	const before = new Set((await usageRows()).map((r) => r.subject_id));

	await page.goto(`/?agent=${slug}`);
	await page.getByLabel("消息输入").fill("turn one");
	await page.getByRole("button", { name: "发送" }).click();
	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible({ timeout: 15_000 });

	const subject = (await usageRows()).find((r) => !before.has(r.subject_id) && r.used > 0)?.subject_id;
	expect(subject).toBeTruthy();

	const put = await request.put(`/api/admin/quota/overrides/${subject}`, {
		headers: adminHeaders,
		data: { monthly_credits: 1, reason: "e2e 封顶" },
	});
	expect(put.ok()).toBe(true);

	// 第二条消息被 403 挡下：横幅出现、Sender 禁用且失败草稿保留
	await page.getByLabel("消息输入").fill("turn two");
	await page.getByRole("button", { name: "发送" }).click();
	await expect(page.getByTestId("quota-banner")).toBeVisible({ timeout: 10_000 });
	await expect(page.getByLabel("消息输入")).toBeDisabled();
	await expect(page.getByLabel("消息输入")).toHaveValue("turn two");

	// 管理端展示 Session 用量；体验端 Credits 限额仍由既有管理 API 配置。
	const pack = await request.post("/api/admin/quota/packs", {
		headers: adminHeaders,
		data: { subject_id: subject, credits: 5, reason: "e2e 恢复发送" },
	});
	expect(pack.status()).toBe(201);

	// 回到体验页：刷新后横幅消失、可继续发送（pack 已叠加）
	await page.goto(`/?agent=${slug}`);
	await expect(page.getByTestId("quota-banner")).toHaveCount(0);
	await page.getByLabel("消息输入").fill("turn three");
	await page.getByRole("button", { name: "发送" }).click();
	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible({ timeout: 15_000 });
});
