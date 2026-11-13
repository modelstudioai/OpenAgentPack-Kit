import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const read = async (page: Page, id: string) => JSON.parse((await page.getByTestId(id).textContent()) ?? "{}");
const click = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).click();
const state = (page: Page) => read(page, "chat-state");
const stats = (page: Page) => read(page, "stats");

const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
	const errors: string[] = [];
	browserErrors.set(page, errors);
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
});
test.afterEach(async ({ page }) => {
	expect(browserErrors.get(page)).toEqual([]);
});

test("自定义 Provider 无 Context 完成就绪、累计快照、停止和批准/拒绝", async ({ page }) => {
	const unexpectedRequests: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("/api/kit/")) unexpectedRequests.push(request.url());
	});
	await page.goto("/e2e/fixtures/custom-provider.html");
	await expect.poll(async () => (await stats(page)).opens).toEqual([{ provider: "a", sessionId: "s1", active: true }]);
	await click(page, "发送");
	await expect.poll(async () => (await stats(page)).writes.length).toBe(0);
	await click(page, "就绪");
	await expect.poll(async () => (await stats(page)).writes.length).toBe(1);
	await expect.poll(async () => (await state(page)).messages.length).toBe(1);
	await click(page, "短快照");
	await expect.poll(async () => (await state(page)).messages.at(-1)?.parts[0]?.text).toBe("你");
	await click(page, "长快照");
	await expect.poll(async () => (await state(page)).messages.at(-1)?.parts[0]?.text).toBe("你好");
	expect((await state(page)).messages).toHaveLength(2);
	await click(page, "停止");
	await expect.poll(async () => (await stats(page)).stops).toEqual(["a/s1"]);
	await expect.poll(async () => (await state(page)).phase).toBe("stopping");
	await click(page, "确认停止");
	await expect.poll(async () => (await state(page)).phase).toBe("interrupted");
	await click(page, "准备审批");
	await click(page, "刷新审批");
	await expect.poll(async () => (await state(page)).approvals.length).toBe(2);
	expect((await state(page)).canSend).toBe(false);
	await click(page, "批准");
	await expect.poll(async () => (await state(page)).approvals[0]?.status).toBe("submitted");
	await click(page, "拒绝");
	await expect
		.poll(async () => (await stats(page)).decisions)
		.toEqual([
			{ batch_id: "batch", call_id: "call-allow", result: "allow" },
			{ batch_id: "batch", call_id: "call-deny", result: "deny" },
		]);
	await click(page, "完成");
	await expect.poll(async () => (await state(page)).phase).toBe("idle");
	expect((await stats(page)).opens).toHaveLength(1);
	expect(unexpectedRequests).toEqual([]);
});

test("显式 Provider 优先于 KitProvider；稳定渲染不重连，切换后丢弃旧连接与迟到响应", async ({ page }) => {
	const unexpectedRequests: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("/unexpected-kit/")) unexpectedRequests.push(request.url());
	});
	await page.goto("/e2e/fixtures/custom-provider.html?context=1");
	await expect.poll(async () => (await stats(page)).opens.length).toBe(1);
	await click(page, "就绪");
	await expect.poll(async () => (await state(page)).connected).toBe(true);
	await click(page, "重复渲染");
	expect((await stats(page)).opens).toHaveLength(1);
	await click(page, "延迟发送响应");
	await click(page, "保存发送回调");
	await click(page, "发送");
	await expect.poll(async () => (await stats(page)).pendingSends).toBe(1);
	await click(page, "切换接入方");
	await expect
		.poll(async () => (await stats(page)).opens)
		.toEqual([
			{ provider: "a", sessionId: "s1", active: false },
			{ provider: "b", sessionId: "s1", active: true },
		]);
	await click(page, "调用旧发送回调");
	await expect.poll(async () => (await stats(page)).outcomes.at(-1)).toContain("接入已切换");
	expect((await stats(page)).opens).toHaveLength(2);
	await click(page, "释放发送响应");
	await click(page, "旧连接迟到");
	await expect
		.poll(async () => (await stats(page)).outcomes.some((value: string) => value.includes("关闭")))
		.toBe(true);
	expect((await state(page)).messages).toEqual([]);
	expect((await state(page)).connected).toBe(false);
	await click(page, "就绪");
	await click(page, "发送");
	await expect.poll(async () => (await stats(page)).writes.at(-1)?.provider).toBe("b");
	await click(page, "保存发送回调");
	await click(page, "切换会话");
	await expect
		.poll(async () => (await stats(page)).opens.at(-1))
		.toEqual({ provider: "b", sessionId: "s2", active: true });
	await click(page, "调用旧发送回调");
	await expect.poll(async () => (await stats(page)).outcomes.at(-1)).toContain("接入已切换");
	expect((await stats(page)).opens).toHaveLength(3);
	await click(page, "旧连接迟到");
	expect((await state(page)).messages).toEqual([]);
	await click(page, "就绪");
	await click(page, "发送");
	await expect
		.poll(async () => (await stats(page)).writes.at(-1))
		.toEqual({ provider: "b", sessionId: "s2", text: "hello" });
	expect((await stats(page)).opens.filter((value: { active: boolean }) => value.active)).toHaveLength(1);
	expect(unexpectedRequests).toEqual([]);
});

test("等待 ready 时卸载会拒绝发送，StrictMode 重挂载只保留一个有效订阅", async ({ page }) => {
	await page.goto("/e2e/fixtures/custom-provider.html");
	await expect.poll(async () => (await stats(page)).opens.length).toBe(1);
	await click(page, "保存发送回调");
	await click(page, "发送");
	await click(page, "卸载");
	await expect.poll(async () => (await stats(page)).opens[0]?.active).toBe(false);
	await expect
		.poll(async () => (await stats(page)).outcomes.some((value: string) => value.includes("关闭")))
		.toBe(true);
	await click(page, "旧连接迟到");
	await click(page, "调用旧发送回调");
	await expect.poll(async () => (await stats(page)).outcomes.at(-1)).toContain("组件已卸载");
	expect((await stats(page)).opens).toHaveLength(1);
	expect((await stats(page)).writes).toEqual([]);
	await click(page, "挂载");
	await expect.poll(async () => (await stats(page)).opens.length).toBe(2);
	await click(page, "就绪");
	await click(page, "发送");
	await expect.poll(async () => (await stats(page)).writes.length).toBe(1);
	expect((await stats(page)).opens.filter((value: { active: boolean }) => value.active)).toHaveLength(1);
});

test("创建会话后可在同一闭包内指定新 sessionId 发送", async ({ page }) => {
	await page.goto("/e2e/fixtures/custom-provider.html?empty=1");
	await expect(page.getByTestId("chat-state")).toBeVisible();
	expect((await stats(page)).opens).toEqual([]);
	await click(page, "创建后立即发送");
	await expect
		.poll(async () => (await stats(page)).opens)
		.toEqual([{ provider: "a", sessionId: "created", active: true }]);
	await click(page, "就绪");
	await expect
		.poll(async () => (await stats(page)).writes)
		.toEqual([{ provider: "a", sessionId: "created", text: "created" }]);
	await expect.poll(async () => (await state(page)).messages.length).toBe(1);
});

test("原始百炼 Provider 在浏览器组合 Request、Stream 和 SDK，等待真实 ready 后发送", async ({ page }) => {
	await page.goto("/e2e/fixtures/raw-bailian-provider.html");
	const network = () => read(page, "raw-network");
	const chat = () => read(page, "raw-chat");
	await expect.poll(async () => (await network()).requests.length).toBe(1);
	await click(page, "发送");
	expect((await network()).writes).toEqual([]);
	expect((await chat()).connected).toBe(false);
	await click(page, "上游就绪");
	await expect(page.getByTestId("raw-outcome")).toHaveText("sent");
	await expect.poll(async () => (await network()).writes.length).toBe(1);
	await click(page, "原始增量");
	await expect.poll(async () => (await chat()).messages.at(-1)?.parts[0]?.text).toBe("你好 🌟");
	const requests = (await network()).requests as { path: string; authorization: string | null }[];
	expect(requests.some(({ path }) => path.endsWith("/history"))).toBe(true);
	expect(
		requests.every(
			({ path, authorization }) => path.startsWith("/agent/raw/") && authorization === "Bearer fixture-token",
		),
	).toBe(true);
	await click(page, "卸载");
	await expect.poll(async () => (await network()).cancelled).toBe(true);
});
