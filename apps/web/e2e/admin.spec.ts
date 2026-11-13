import { PROTOCOL_VERSION } from "@openagentpack/kit-sdk/protocol";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN } from "./helpers.ts";

const apiBase = process.env.KIT_E2E_API_URL ?? "http://localhost:8787";
const consoleBase = process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174";

test("管理端：自定义跨域地址读取模版列表，公开配置不携带令牌", async ({ page }) => {
	const configPromise = page.waitForResponse(`${apiBase}/api/config`);
	await page.goto(`${consoleBase}/?api=${encodeURIComponent(apiBase)}`);
	const config = await configPromise;
	expect(config.ok()).toBe(true);
	expect(config.request().headers().authorization).toBeUndefined();
	expect(config.headers()["access-control-allow-origin"]).toBe(consoleBase);

	await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
	const templatesPromise = page.waitForResponse((response) =>
		response.url().startsWith(`${apiBase}/api/admin/templates?`),
	);
	await page.getByRole("button", { name: "进入" }).click();
	const templates = await templatesPromise;
	expect(templates.ok()).toBe(true);
	expect(templates.request().headers().authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
	expect(templates.headers()["access-control-allow-origin"]).toBe(consoleBase);
	await expect(page.getByRole("region", { name: "模版列表", exact: true })).toBeVisible();
});

test("管理端：切换后端先登录对应服务，不外发原后端令牌", async ({ page }) => {
	const otherBase = "https://other-backend.example/tenant";
	const requests: { url: string; authorization: string | undefined }[] = [];
	// 两个身份都使用纯测试令牌；替换网络响应，不向示例域名发送真实请求。
	await page.route(
		(url) => url.href.startsWith(`${consoleBase}/api/`) || url.href.startsWith(`${otherBase}/api/`),
		async (route) => {
			const request = route.request();
			const headers = {
				"access-control-allow-origin": consoleBase,
				"access-control-allow-methods": "GET, OPTIONS",
				"access-control-allow-headers": "authorization, content-type, x-kit-protocol-version",
			};
			if (request.method() === "OPTIONS") {
				await route.fulfill({ status: 204, headers });
				return;
			}
			if (request.url().endsWith("/api/config")) {
				expect(request.headers().authorization).toBeUndefined();
				await route.fulfill({
					headers,
					json: { data: { apiBaseUrl: "", protocolVersion: PROTOCOL_VERSION } },
				});
				return;
			}
			requests.push({ url: request.url(), authorization: request.headers().authorization });
			const data = new URL(request.url()).pathname.endsWith("/identity") ? { role: "admin" } : [];
			await route.fulfill({ headers, json: { data } });
		},
	);

	await page.goto(consoleBase);
	await page.getByPlaceholder("ADMIN_TOKEN").fill("fake-default-token");
	const defaultTemplates = page.waitForResponse((response) =>
		response.url().startsWith(`${consoleBase}/api/admin/templates?`),
	);
	await page.getByRole("button", { name: "进入" }).click();
	await defaultTemplates;
	await expect(page.getByRole("region", { name: "模版列表", exact: true })).toBeVisible();
	expect(requests.length).toBeGreaterThan(0);
	expect(
		requests.every(
			({ url, authorization }) => url.startsWith(consoleBase) && authorization === "Bearer fake-default-token",
		),
	).toBe(true);

	await page.goto(`${consoleBase}/?api=${encodeURIComponent(otherBase)}`);
	// 登录表单出现即已完成公开配置；此时旧令牌存在，但管理页不能启动。
	await expect(page.getByRole("heading", { name: "管理端登录" })).toBeVisible();
	await expect(page.getByText(`当前服务：${otherBase}`)).toBeVisible();
	expect(requests.filter(({ url }) => url.startsWith(otherBase))).toEqual([]);
	await page.getByPlaceholder("ADMIN_TOKEN").fill("fake-other-token");
	const otherTemplates = page.waitForResponse((response) =>
		response.url().startsWith(`${otherBase}/api/admin/templates?`),
	);
	await page.getByRole("button", { name: "进入" }).click();
	await otherTemplates;
	await expect(page.getByRole("region", { name: "模版列表", exact: true })).toBeVisible();
	expect(
		requests
			.filter(({ url }) => url.startsWith(otherBase))
			.every(({ authorization }) => authorization === "Bearer fake-other-token"),
	).toBe(true);

	const restoredTemplates = page.waitForResponse((response) =>
		response.url().startsWith(`${consoleBase}/api/admin/templates?`),
	);
	await page.goto(consoleBase);
	await restoredTemplates;
	expect(requests.at(-1)?.authorization).toBe("Bearer fake-default-token");
});

test("管理端：公开配置失败只显示重试，恢复后才加载管理页面", async ({ page }) => {
	const adminRequests: string[] = [];
	page.on("request", (request) => {
		if (new URL(request.url()).pathname.startsWith("/api/admin/")) adminRequests.push(request.url());
	});
	await page.addInitScript(() => localStorage.setItem("kit_admin_token", "e2e-token"));
	await page.route("**/api/config", (route) =>
		route.fulfill({
			status: 503,
			contentType: "application/json",
			body: JSON.stringify({ error: { code: "provider_error", message: "配置暂不可用" } }),
		}),
	);
	await page.goto(consoleBase);
	await expect(page.getByText("配置暂不可用")).toBeVisible();
	expect(adminRequests).toEqual([]);
	await page.unroute("**/api/config");
	await page.getByRole("button", { name: "重试" }).click();
	await expect(page.getByRole("region", { name: "模版列表", exact: true })).toBeVisible();
	expect(adminRequests.length).toBeGreaterThan(0);
});

test("管理端：无令牌与错令牌被拒", async ({ request }) => {
	expect((await request.get("/api/admin/projects")).status()).toBe(401);
	expect((await request.get("/api/admin/projects", { headers: { authorization: "Bearer wrong" } })).status()).toBe(403);
});
