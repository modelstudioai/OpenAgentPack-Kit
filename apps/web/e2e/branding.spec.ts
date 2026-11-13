import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, seedListedAgent } from "./helpers.ts";

const headers = { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" };
const logoFile = fileURLToPath(new URL("../public/brand/kit-logo.svg", import.meta.url));
const api = process.env.KIT_E2E_API_URL ?? "http://localhost:8787";
const consoleOrigin = process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174";

async function loginConsoleAtApi(page: import("@playwright/test").Page) {
	const target = new URL(consoleOrigin);
	target.searchParams.set("api", api);
	await page.goto(target.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await expect(page.getByRole("region", { name: "模版列表", exact: true })).toBeVisible();
}

test.beforeEach(async ({ request }) => {
	await seedListedAgent(request);
});

test("后台品牌配置：默认上传 Logo，可切换为 URL，员工端从 /api/config 生效", async ({ page, request }) => {
	try {
		await loginConsoleAtApi(page);
		await page.getByTestId("branding-tab").click();
		await expect(page).toHaveURL(/\/branding/);
		await expect(page.getByRole("heading", { name: "品牌配置", exact: true })).toBeVisible();

		// 默认是上传模式；上传图片后保存，管理接口返回内部 Logo 地址。
		await expect(page.getByRole("button", { name: /选择图片/ })).toBeVisible();
		await page.getByLabel("产品名称").fill("E2E 员工端");
		await page.locator('input[type="file"]').setInputFiles(logoFile);
		await page.getByRole("button", { name: "保存", exact: true }).click();
		await expect(page.getByText("已保存，员工端刷新后生效。", { exact: true })).toBeVisible();
		const uploaded = (await (
			await request.get("/api/admin/branding", { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } })
		).json()) as { data: { logoUrl?: string } };
		expect(uploaded.data.logoUrl).toMatch(/^\/api\/branding\/logo\?v=/);

		await page.goto("/?agent=e2e-agent");
		await expect(page.getByTestId("brand-name")).toHaveText("E2E 员工端");
		await expect(page.getByTestId("brand-logo")).toHaveAttribute("src", /\/api\/branding\/logo\?v=/);

		// 再切回 URL 模式，填写本站路径并保存，员工端使用填写的 URL。
		const target = new URL(consoleOrigin);
		target.pathname = "/branding";
		target.searchParams.set("api", api);
		await page.goto(target.href);
		await expect(page.getByRole("heading", { name: "品牌配置", exact: true })).toBeVisible();
		await page.getByText("填写 URL", { exact: true }).click();
		await page.getByLabel("Logo 地址").fill("/brand/kit-logo.svg");
		await page.getByRole("button", { name: "保存", exact: true }).click();
		await expect(page.getByText("已保存，员工端刷新后生效。", { exact: true })).toBeVisible();

		await page.goto("/?agent=e2e-agent");
		await expect(page.getByTestId("brand-name")).toHaveText("E2E 员工端");
		await expect(page.getByTestId("brand-logo")).toHaveAttribute("src", /\/brand\/kit-logo\.svg$/);
	} finally {
		await request.put("/api/admin/branding", {
			headers,
			data: { productName: "OpenAgentPack Kit", logoUrl: null },
		});
	}
});

// 真实浏览器保护上传边界：SVG 作为图片正常显示，直接导航也不能执行其中的脚本。
test("上传 SVG 仍可显示，直接打开时禁止脚本与同源存储访问", async ({ page, request }) => {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" onload="document.documentElement.setAttribute('data-executed', localStorage.getItem('kit-branding-security-test'))"><style>rect { fill: rgb(0, 128, 0); }</style><rect width="32" height="32" /></svg>`;
	try {
		const uploaded = await request.post(`${api}/api/admin/branding/logo`, {
			headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
			multipart: { file: { name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) } },
		});
		expect(uploaded.status()).toBe(201);
		const { data } = (await uploaded.json()) as { data: { logoUrl: string } };
		const logoUrl = `${api.replace(/\/+$/, "")}${data.logoUrl}`;
		await page.goto(`${api}/healthz`);
		await page.evaluate(() => localStorage.setItem("kit-branding-security-test", "test-only-marker"));
		await page.setContent(`<img alt="uploaded logo" src="${logoUrl}" />`);
		const image = page.getByRole("img", { name: "uploaded logo" });
		await expect(image).toBeVisible();
		await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(32);

		await page.goto(logoUrl);
		await expect(page.locator("svg")).toBeVisible();
		await expect(page.locator("rect")).toHaveCSS("fill", "rgb(0, 128, 0)");
		await expect(page.locator("svg")).not.toHaveAttribute("data-executed");
		expect(
			await page.evaluate(() => {
				try {
					localStorage.getItem("kit-branding-security-test");
					return "allowed";
				} catch (error) {
					return error instanceof DOMException ? error.name : "unexpected";
				}
			}),
		).toBe("SecurityError");
	} finally {
		await page.goto(`${api}/healthz`);
		await page.evaluate(() => localStorage.removeItem("kit-branding-security-test"));
		await request.put(`${api}/api/admin/branding`, {
			headers,
			data: { productName: "OpenAgentPack Kit", logoUrl: null },
		});
	}
});
