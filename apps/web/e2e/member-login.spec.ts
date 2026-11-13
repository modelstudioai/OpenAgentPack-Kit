import { fileURLToPath } from "node:url";
import type {
	MemberLoginResult,
	MemberUsageLimitView,
	SessionDetail,
	SessionSummary,
} from "@openagentpack/kit-sdk/protocol";
import type { APIRequestContext, Page, Request, Response } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, newSession, openSessionList, seedListedAgent } from "./helpers.ts";

const apiBase = "http://localhost:8797";
const password = "Login-E2e!2026";
const screenshotDirectory = fileURLToPath(new URL("../../../.scratch/member-login-e2e/screenshots/", import.meta.url));

// 保护 Web 的公开 Provider 接线：鉴权、SSE、退出取消与下一身份隔离。
test("公开 SDK Provider：成员切换隔离旧连接、会话与草稿", { tag: "@desktop" }, async ({ page, request }) => {
	const suffix = Date.now().toString(36);
	const slug = `sdk-member-${suffix}`;
	await seedListedAgent(request, slug, "SDK 成员示例");
	for (const username of [`sdk_a_${suffix}`, `sdk_b_${suffix}`]) await createMember(request, username, username);
	await page.goto(experienceUrl({ agent: slug }));
	const first = (await (await login(page, `sdk_a_${suffix}`)).json()).data as MemberLoginResult;
	const input = page.getByLabel("消息输入", { exact: true });
	await expect(input).toBeVisible();
	const opened = page.waitForResponse((response) =>
		/\/api\/kit\/sessions\/[^/]+\/stream$/.test(new URL(response.url()).pathname),
	);
	const created = page.waitForResponse((response) => isResponse(response, "/api/kit/sessions", "POST"));
	await input.fill("SDK 成员 A 的消息");
	await page.getByRole("button", { name: "发送", exact: true }).click();
	const sessionId = (await (await created).json()).data.session_id as string;
	const stream = await opened;
	expect(stream.request().headers().authorization === `Bearer ${first.access_token}`).toBe(true);
	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible();
	const readSession = (token: string) =>
		request.get(`/api/kit/sessions/${sessionId}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
	// 先证明 A 的资源存在，再验证 B 的访问被拒绝。
	expect((await readSession(first.access_token)).status()).toBe(200);
	await input.fill("成员 A 尚未发送的草稿");
	let closed = false;
	const markClosed = (event: Request) => {
		if (event === stream.request()) closed = true;
	};
	page.on("requestfailed", markClosed);
	page.on("requestfinished", markClosed);
	await logout(page);
	await expect.poll(() => closed).toBe(true);
	const second = (await (await login(page, `sdk_b_${suffix}`)).json()).data as MemberLoginResult;
	await expect(input).toBeVisible();
	await expect(input).toBeEmpty();
	await expect(page.getByText("SDK 成员 A 的消息", { exact: true })).toHaveCount(0);
	expect((await readSession(second.access_token)).status()).toBe(404);
	// A 的深链对 B 不可用；通过页面的新聊天入口创建 B 自己的会话。
	await newSession(page, slug);
	await input.fill("SDK 成员 B 的消息");
	await page.getByRole("button", { name: "发送", exact: true }).click();
	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible();
});

function experienceUrl(query: Record<string, string> = {}): string {
	return `http://localhost:5183/?${new URLSearchParams({ api: apiBase, ...query })}`;
}

function isResponse(response: Response, path: string, method = "GET"): boolean {
	return new URL(response.url()).pathname === path && response.request().method() === method;
}

async function createMember(request: APIRequestContext, username: string, displayName: string): Promise<void> {
	const response = await request.post("/api/admin/members", {
		headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
		data: {
			username,
			display_name: displayName,
			auth_type: "local",
			password_mode: "custom",
			password,
		},
	});
	expect(response.ok()).toBe(true);
}

async function login(page: Page, username: string, value = password): Promise<Response> {
	await page.getByLabel("用户名", { exact: true }).fill(username);
	await page.getByLabel("密码", { exact: true }).fill(value);
	const response = page.waitForResponse((item) => isResponse(item, "/api/kit/auth/login", "POST"));
	await page.getByRole("button", { name: "登录", exact: true }).click();
	return response;
}

async function logout(page: Page): Promise<void> {
	const response = page.waitForResponse((item) => isResponse(item, "/api/kit/auth/logout", "POST"));
	// 账号区在全局侧栏页脚：点击头像展开浮层后再退出，不再依赖具体视图。
	await page.getByRole("button", { name: /^账号/ }).click();
	await page.getByRole("button", { name: "退出登录", exact: true }).click();
	expect((await response).status()).toBe(204);
	await expect(page.getByRole("heading", { name: "成员登录", exact: true })).toBeVisible();
	await expect(page.getByLabel("消息输入")).toHaveCount(0);
}

async function readUsage(page: Page): Promise<MemberUsageLimitView> {
	// 用量走深链（侧栏页脚入口同一目标）；顺带锁热力图在成员身份下渲染。
	const response = page.waitForResponse((item) => isResponse(item, "/api/kit/usage-limits"));
	await page.goto(experienceUrl({ view: "usage" }));
	const result = await response;
	expect(result.ok()).toBe(true);
	await expect(page.getByTestId("member-usage-limits")).toBeVisible();
	await expect(page.getByTestId("usage-activity")).toBeVisible();
	return ((await result.json()) as { data: MemberUsageLimitView }).data;
}

async function selectHistory(page: Page, title: string): Promise<void> {
	await openSessionList(page);
	await page
		.getByRole("navigation", { name: "最近会话", exact: true })
		.getByRole("button", { name: title, exact: true })
		.click();
}

test("成员登录：A/B 的会话、草稿、附件与用量隔离，刷新恢复并以 Bearer 下载", { tag: "@desktop" }, async ({
	page,
	request,
}) => {
	const suffix = Date.now().toString(36);
	const memberA = `login-a-${suffix}`;
	const memberB = `login-b-${suffix}`;
	const slug = `login-agent-${suffix}`;
	const displayA = "登录回归成员 A";
	const displayB = "登录回归成员 B";
	await createMember(request, memberA, displayA);
	await createMember(request, memberB, displayB);
	await seedListedAgent(request, slug, "登录回归 Agent");
	await page.goto(experienceUrl({ agent: slug }));
	await expect(page.getByRole("heading", { name: "成员登录", exact: true })).toBeVisible();
	await expect(page.getByLabel("消息输入")).toHaveCount(0);
	expect((await request.get("/api/kit/sessions")).status()).toBe(401);
	await page.screenshot({ path: `${screenshotDirectory}/desktop-login.png`, fullPage: true });

	expect((await login(page, memberA, "Wrong-Login!2026")).status()).toBe(401);
	await expect(page.getByText("用户名或密码错误", { exact: true })).toBeVisible();
	await expect(page.getByLabel("用户名", { exact: true })).toHaveValue(memberA);
	await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
	const originalUrl = page.url();
	const responseA = await login(page, memberA);
	expect(responseA.ok()).toBe(true);
	const issuedA = ((await responseA.json()) as { data: MemberLoginResult }).data;
	await expect(page.getByText(displayA, { exact: true }).first()).toBeVisible();
	await expect(page.getByLabel("消息输入")).toBeVisible();
	expect(page.url()).toBe(originalUrl);
	const storedFields = await page.evaluate(
		(key) => Object.keys(JSON.parse(sessionStorage.getItem(key) ?? "{}")),
		`kit_member_session:${apiBase}`,
	);
	expect(storedFields.sort()).toEqual(["access_token", "expires_at"]);
	expect(
		await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("kit_member_session:"))),
	).toBe(false);

	const marker = `成员 A 的独立报告 artifact ${suffix}`;
	const created = page.waitForResponse((item) => isResponse(item, "/api/kit/sessions", "POST"));
	const streamed = page.waitForResponse((item) =>
		/\/api\/kit\/sessions\/[^/]+\/stream$/.test(new URL(item.url()).pathname),
	);
	await page.getByLabel("消息输入").fill(marker);
	await page.getByRole("button", { name: "发送", exact: true }).click();
	const session = ((await (await created).json()) as { data: SessionDetail }).data;
	const stream = await streamed;
	expect(stream.ok()).toBe(true);
	expect(stream.headers()["content-type"]).toContain("text/event-stream");
	expect(stream.request().headers().authorization === `Bearer ${issuedA.access_token}`).toBe(true);
	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible();
	await expect(page.getByText("空闲", { exact: true })).toBeVisible();
	// 本地成员展示月度 Token/执行时长，用真实归属及 Mock 的一轮增量证明 A/B 隔离。
	expect(await readUsage(page)).toMatchObject({
		member_id: issuedA.member.member_id,
		tokens: { used: 200 },
		active_seconds: { used: 2 },
	});

	const restored = page.waitForResponse((item) => isResponse(item, "/api/kit/auth/me"));
	await page.goto(experienceUrl({ agent: slug }));
	expect((await restored).ok()).toBe(true);
	await expect(page.getByText(displayA, { exact: true }).first()).toBeVisible();
	await selectHistory(page, marker);
	await expect(page.getByText(marker, { exact: true }).first()).toBeVisible();
	const restoredAfterReload = page.waitForResponse((item) => isResponse(item, "/api/kit/auth/me"));
	await page.reload();
	expect((await restoredAfterReload).ok()).toBe(true);
	const activeStreamResponse = page.waitForResponse((item) =>
		/\/api\/kit\/sessions\/[^/]+\/stream$/.test(new URL(item.url()).pathname),
	);
	await selectHistory(page, marker);
	const activeStream = await activeStreamResponse;
	expect(activeStream.headers()["content-type"]).toContain("text/event-stream");
	let streamClosed = false;
	const markStreamClosed = (request: Request) => {
		if (request === activeStream.request()) streamClosed = true;
	};
	page.on("requestfinished", markStreamClosed);
	page.on("requestfailed", markStreamClosed);
	await expect(page.getByText(marker, { exact: true }).first()).toBeVisible();
	const fileResponse = page.waitForResponse((item) =>
		/\/api\/kit\/files\/[^/]+\/download$/.test(new URL(item.url()).pathname),
	);
	const [download] = await Promise.all([
		page.waitForEvent("download"),
		page
			.getByRole("region", { name: "消息列表", exact: true })
			.getByRole("button", { name: "下载 mock-report.md", exact: true })
			.click(),
	]);
	const file = await fileResponse;
	expect(file.ok()).toBe(true);
	expect(file.request().headers().authorization === `Bearer ${issuedA.access_token}`).toBe(true);
	expect(new URL(file.url()).searchParams.get("session_id")).toBe(session.session_id);
	expect(new URL(file.url()).searchParams.has("token")).toBe(false);
	expect(await download.failure()).toBeNull();
	expect(download.suggestedFilename()).toBe("mock-report.md");

	await page.getByLabel("消息输入").fill("成员 A 尚未发送的草稿");
	await page.getByRole("button", { name: "添加附件", exact: true }).click();
	const [chooser] = await Promise.all([
		page.waitForEvent("filechooser"),
		page.getByRole("menuitem", { name: "上传文件", exact: true }).click(),
	]);
	await chooser.setFiles({
		name: "member-a-draft.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("synthetic A attachment"),
	});
	await expect(page.getByText("member-a-draft.txt", { exact: true }).first()).toBeVisible();
	await expect(page.getByText("发送时会一并提交附件").first()).toBeVisible();
	expect(streamClosed).toBe(false);
	await logout(page);
	await expect.poll(() => streamClosed).toBe(true);
	expect(
		(await request.get("/api/kit/auth/me", { headers: { authorization: `Bearer ${issuedA.access_token}` } })).status(),
	).toBe(401);
	const listB = page.waitForResponse((item) => isResponse(item, "/api/kit/sessions"));
	const responseB = await login(page, memberB);
	expect(responseB.ok()).toBe(true);
	const issuedB = ((await responseB.json()) as { data: MemberLoginResult }).data;
	await expect(page.getByText(displayB, { exact: true }).first()).toBeVisible();
	const directoryB = await listB;
	expect(directoryB.request().headers().authorization).toBe(`Bearer ${issuedB.access_token}`);
	// A's unavailable deep link can refresh and cancel the first B query; read the settled server result independently.
	const sessionsB = await request.get("/api/kit/sessions", {
		headers: { authorization: `Bearer ${issuedB.access_token}` },
	});
	expect(((await sessionsB.json()) as { data: SessionSummary[] }).data).toEqual([]);
	// 先等待 B 的目录完成初始化，再断言 A 的内容没有进入新身份。
	await expect(page.getByTestId("experience-sidebar")).toContainText("还没有会话记录");
	await expect(page.getByLabel("消息输入")).toBeEmpty();
	await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
	await expect(page.getByText("member-a-draft.txt", { exact: true })).toHaveCount(0);
	const bearerB = { authorization: `Bearer ${issuedB.access_token}` };
	expect((await request.get(`/api/kit/sessions/${session.session_id}`, { headers: bearerB })).status()).toBe(404);
	expect((await request.get(file.url(), { headers: bearerB })).status()).toBe(404);
	expect(await readUsage(page)).toMatchObject({
		member_id: issuedB.member.member_id,
		tokens: { used: 0 },
		active_seconds: { used: 0 },
	});
	// 用量页侧栏页脚即有账号退出入口，无需先回聊天视图。
	await logout(page);
	const usageA = page.waitForResponse((item) => isResponse(item, "/api/kit/usage-limits"));
	expect((await login(page, memberA)).ok()).toBe(true);
	expect(((await (await usageA).json()) as { data: MemberUsageLimitView }).data).toMatchObject({
		member_id: issuedA.member.member_id,
		tokens: { used: 200 },
		active_seconds: { used: 2 },
	});
	await page.goto(experienceUrl({ agent: slug }));
	await selectHistory(page, marker);
	await expect(page.getByText(marker, { exact: true }).first()).toBeVisible();
	await page.screenshot({ path: `${screenshotDirectory}/desktop-member-history.png`, fullPage: true });
});

test("广场与用量页的侧栏账号区可直接退出，登录态在空广场与用量深链均可达", { tag: "@desktop" }, async ({
	page,
	request,
}) => {
	const suffix = Date.now().toString(36);
	const username = `login-shell-${suffix}`;
	const displayName = "外壳退出回归成员";
	await createMember(request, username, displayName);
	// 空广场：登录后仍停留在广场视图，退出入口在侧栏页脚，不依赖先进入聊天。
	await page.goto(experienceUrl());
	await expect(page.getByRole("heading", { name: "成员登录", exact: true })).toBeVisible();
	expect((await login(page, username)).ok()).toBe(true);
	await expect(page.getByTestId("experience-shell")).toContainText("Agent 广场");
	// 账号区默认只显示头像：点击头像展开浮层后可见用户名，退出入口也在浮层内。
	await page.getByRole("button", { name: `账号：${displayName}` }).click();
	await expect(page.getByText(displayName, { exact: true }).first()).toBeVisible();
	const plazaLogout = page.waitForResponse((item) => isResponse(item, "/api/kit/auth/logout", "POST"));
	await page.getByRole("button", { name: "退出登录", exact: true }).click();
	expect((await plazaLogout).status()).toBe(204);
	await expect(page.getByRole("heading", { name: "成员登录", exact: true })).toBeVisible();

	// 用量深链：侧栏账号区同样直接退出。
	expect((await login(page, username)).ok()).toBe(true);
	await readUsage(page);
	await page.getByRole("button", { name: `账号：${displayName}` }).click();
	await expect(page.getByText(displayName, { exact: true }).first()).toBeVisible();
	const usageLogout = page.waitForResponse((item) => isResponse(item, "/api/kit/auth/logout", "POST"));
	await page.getByRole("button", { name: "退出登录", exact: true }).click();
	expect((await usageLogout).status()).toBe(204);
	await expect(page.getByRole("heading", { name: "成员登录", exact: true })).toBeVisible();
});

test("手机广场页头可直接退出登录", { tag: "@mobile" }, async ({ page, request }) => {
	test.skip(true, "移动端本轮不做：恢复随移动端适配批次");
	const suffix = Date.now().toString(36);
	const username = `login-mobile-viewport-${suffix}`;
	await createMember(request, username, "手机外壳退出成员");
	await page.goto(experienceUrl());
	await expect(page.getByRole("heading", { name: "成员登录", exact: true })).toBeVisible();
	expect((await login(page, username)).ok()).toBe(true);
	await expect(page.getByTestId("experience-shell")).toContainText("Agent 广场");
	await page.getByRole("button", { name: "账号：手机外壳退出成员" }).click();
	await expect(page.getByText("手机外壳退出成员", { exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
		true,
	);
	const response = page.waitForResponse((item) => isResponse(item, "/api/kit/auth/logout", "POST"));
	await page.getByRole("button", { name: "退出登录", exact: true }).click();
	expect((await response).status()).toBe(204);
	await expect(page.getByRole("heading", { name: "成员登录", exact: true })).toBeVisible();
});

test("手机成员登录：未登录不能进入体验页，登录后可对话，退出及刷新保持登录门禁", { tag: "@mobile" }, async ({
	page,
	request,
}) => {
	test.skip(true, "移动端本轮不做：恢复随移动端适配批次");
	const suffix = Date.now().toString(36);
	const username = `login-mobile-${suffix}`;
	const slug = `mobile-agent-${suffix}`;
	await createMember(request, username, "手机回归成员");
	await seedListedAgent(request, slug, "手机登录 Agent");
	await page.goto(experienceUrl({ agent: slug }));
	await expect(page.getByRole("heading", { name: "成员登录", exact: true })).toBeVisible();
	await expect(page.getByLabel("消息输入")).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
		true,
	);
	await page.screenshot({ path: `${screenshotDirectory}/mobile-login.png`, fullPage: true });
	expect((await login(page, username)).ok()).toBe(true);
	await openSessionList(page);
	await expect(page.getByText("手机回归成员", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "关闭导航菜单", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "导航菜单", exact: true })).toHaveCount(0);
	await page.getByLabel("消息输入").fill("手机成员真实流式对话");
	await page.getByRole("button", { name: "发送", exact: true }).click();
	await expect(page.getByText(/mock gateway 的流式回答/).first()).toBeVisible();
	await expect(page.getByText("空闲", { exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
		true,
	);
	await page.screenshot({ path: `${screenshotDirectory}/mobile-member-chat.png`, fullPage: true });
	await logout(page);
	expect(
		await page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith("kit_member_session:"))),
	).toBe(false);
	await page.reload();
	await expect(page.getByRole("heading", { name: "成员登录", exact: true })).toBeVisible();
	await expect(page.getByLabel("消息输入")).toHaveCount(0);
});
