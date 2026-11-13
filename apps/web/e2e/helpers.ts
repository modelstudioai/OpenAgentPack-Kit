import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

export const ADMIN_TOKEN = "e2e-token";

/** 管理端桌面导航常驻；手机先展开左侧菜单，重复调用保留已打开的抽屉。 */
export async function openConsoleNavigation(page: Page): Promise<void> {
	if ((page.viewportSize()?.width ?? 1280) >= 768) return;
	const drawer = page.getByRole("dialog", { name: "管理端导航菜单", exact: true });
	if (await drawer.isVisible()) return;
	await page.getByRole("button", { name: "打开管理端导航", exact: true }).click();
	await expect(drawer).toBeVisible();
}

export async function loginConsole(page: Page): Promise<void> {
	await page.goto(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await expect(page.getByRole("region", { name: "模版列表", exact: true })).toBeVisible();
}

/** 通过控制面播种一个已上架 Agent（体验页只认 listed 条目）；memoryStores 可选，PUT 幂等补配置。 */
export async function seedListedAgent(
	request: APIRequestContext,
	slug = "e2e-agent",
	displayName = "E2E 助手",
	memoryStores?: { memory_store_id: string }[],
): Promise<void> {
	const headers = { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" };
	const created = await request.post("/api/admin/agents", {
		headers,
		data: { slug, display_name: displayName, remote_agent_id: "agent_mock_assistant", description: "e2e seed" },
	});
	if (!created.ok() && created.status() !== 409) throw new Error(`seed create failed: ${created.status()}`);
	// 记忆库配置独立 PUT：Agent 重入（409）或历史数据都可能没有，保证播种幂等。
	if (memoryStores?.length) {
		const updated = await request.put(`/api/admin/agents/${slug}`, {
			headers,
			data: { memory_stores: memoryStores },
		});
		if (!updated.ok()) throw new Error(`seed memory stores failed: ${updated.status()}`);
	}
	// 上下架是破坏性动作：先 plan 拿一次性确认令牌（服务端拒绝无令牌的 PATCH）
	const planRes = await request.post(`/api/admin/agents/${slug}/plan`, {
		headers,
		data: { action: "listing", status: "listed" },
	});
	if (!planRes.ok()) throw new Error(`seed plan failed: ${planRes.status()}`);
	const { data: plan } = (await planRes.json()) as { data: { plan_id: string; confirm_token: string } };
	const listed = await request.patch(`/api/admin/agents/${slug}`, {
		headers,
		data: { status: "listed", plan_id: plan.plan_id, confirm_token: plan.confirm_token },
	});
	if (!listed.ok()) throw new Error(`seed list failed: ${listed.status()}`);
}

/**
 * 打开统一导航：桌面侧栏常驻；手机先开抽屉，重复调用保留已打开的菜单。
 * 会话切换、新建和成员退出共用这个入口。
 */
export async function openSessionList(page: Page): Promise<void> {
	if ((page.viewportSize()?.width ?? 1280) >= 768) return;
	const drawer = page.getByRole("dialog", { name: "导航菜单", exact: true });
	if (await drawer.isVisible()) return;
	await page.getByRole("button", { name: "打开导航菜单", exact: true }).click();
	await expect(drawer).toBeVisible();
}

/** 真实滚轮 / 浏览器触摸手势向下浏览会话目录，包含首屏无滚动条的情况。 */
export async function scrollSessionDirectoryDown(page: Page, touch: boolean) {
	const root = page.getByTestId("session-directory-scroll");
	if (!touch) {
		await root.hover();
		await page.mouse.wheel(0, 1600);
		return;
	}
	const box = await root.boundingBox();
	if (!box) throw new Error("会话目录不可见");
	const cdp = await page.context().newCDPSession(page);
	const x = box.x + box.width / 2;
	const bottom = box.y + box.height - 20;
	await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: bottom }] });
	for (let step = 1; step <= 8; step++) {
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchMove",
			touchPoints: [{ x, y: bottom - ((box.height - 40) * step) / 8 }],
		});
	}
	await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
	await cdp.detach();
}

/** 打开新建聊天页（?view=new，复用广场卡片）并点指定 Agent 的「开始体验」开始会话。 */
export async function newSession(page: Page, slug = "e2e-agent"): Promise<void> {
	await openSessionList(page);
	await page.getByTestId("sidebar-new-chat").click();
	await page.getByTestId(`plaza-card-${slug}`).getByRole("button", { name: "开始体验", exact: true }).click();
}
