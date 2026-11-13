import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrandingViewSchema, KitRuntimeConfigSchema } from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const close of cleanup.splice(0).reverse()) close();
});

const adminToken = "branding-admin";
const auditorToken = "branding-auditor";
const adminHeaders = { authorization: `Bearer ${adminToken}`, "content-type": "application/json" };
const auditorHeaders = { authorization: `Bearer ${auditorToken}`, "content-type": "application/json" };

function setup() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-branding-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const db = openDatabase(dataDir);
	cleanup.push(() => db.close());
	const services = createKitServices(
		loadConfig({
			KIT_GATEWAY: "mock",
			KIT_DATA_DIR: dataDir,
			ADMIN_TOKEN: adminToken,
			KIT_ADMIN_TOKENS: `${auditorToken}:auditor`,
			KIT_RATE_LIMIT_RPS: "0",
		}),
		db,
	);
	return { app: createApp(services), services, db };
}

async function request(
	app: ReturnType<typeof setup>["app"],
	path: string,
	init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
	const form = init.body instanceof FormData;
	return app.request(path, {
		method: init.method ?? "GET",
		headers: init.headers ?? (form ? { authorization: `Bearer ${adminToken}` } : adminHeaders),
		...(init.body === undefined ? {} : { body: form ? (init.body as FormData) : JSON.stringify(init.body) }),
	});
}

async function view(response: Response) {
	return BrandingViewSchema.parse(((await response.json()) as { data: unknown }).data);
}

describe("员工端品牌配置", () => {
	it("默认公开配置返回产品名；管理员保存 URL 后立即反映到 /api/config", async () => {
		const { app } = setup();
		const initial = await view(await request(app, "/api/admin/branding"));
		expect(initial.productName).toBe("OpenAgentPack Kit");
		expect(initial.logoUrl).toBeUndefined();

		const saved = await request(app, "/api/admin/branding", {
			method: "PUT",
			body: { productName: "  员工工作台  ", logoUrl: "/brand/kit-logo.svg" },
		});
		expect(saved.status).toBe(200);
		expect(await view(saved)).toMatchObject({ productName: "员工工作台", logoUrl: "/brand/kit-logo.svg" });

		const runtime = KitRuntimeConfigSchema.parse(
			((await (await request(app, "/api/config", { headers: {} })).json()) as { data: unknown }).data,
		);
		expect(runtime.branding).toMatchObject({ productName: "员工工作台", logoUrl: "/brand/kit-logo.svg" });
	});

	it("上传 Logo 后由公开图片接口提供；省略 logoUrl 保持上传，null 清除", async () => {
		const { app, services } = setup();
		const form = new FormData();
		form.append(
			"file",
			new File(["<svg xmlns='http://www.w3.org/2000/svg'></svg>"], "logo.svg", { type: "image/svg+xml" }),
		);
		const uploaded = await request(app, "/api/admin/branding/logo", { method: "POST", body: form });
		expect(uploaded.status).toBe(201);
		const viewAfterUpload = await view(uploaded);
		expect(viewAfterUpload.logoUrl).toMatch(/^\/api\/branding\/logo\?v=[0-9a-f]+$/);

		const image = await request(app, "/api/branding/logo", { headers: {} });
		expect(image.status).toBe(200);
		expect(image.headers.get("content-type")).toBe("image/svg+xml");
		expect(await image.text()).toContain("<svg");

		const kept = await view(
			await request(app, "/api/admin/branding", { method: "PUT", body: { productName: "保留上传 Logo" } }),
		);
		expect(kept.logoUrl).toBe(viewAfterUpload.logoUrl);
		expect(services.branding.getLogoMeta()).not.toBeNull();

		const echoed = await view(
			await request(app, "/api/admin/branding", {
				method: "PUT",
				body: { productName: "回传上传地址", logoUrl: `https://api.example.test${viewAfterUpload.logoUrl}` },
			}),
		);
		expect(echoed.logoUrl).toBe(viewAfterUpload.logoUrl);
		expect(services.branding.getLogoMeta()).not.toBeNull();

		const cleared = await view(
			await request(app, "/api/admin/branding", {
				method: "PUT",
				body: { productName: "清除 Logo", logoUrl: null },
			}),
		);
		expect(cleared.logoUrl).toBeUndefined();
		expect((await request(app, "/api/branding/logo", { headers: {} })).status).toBe(404);
	});

	// 上传是图片输入边界；直接打开 SVG 不能变成拥有站点权限的活动文档。
	it("公开 SVG 保留图片内容，并通过响应策略隔离脚本、外部资源与同源权限", async () => {
		const { app } = setup();
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" onload="document.documentElement.dataset.executed=1"><rect width="16" height="16" /></svg>';
		const form = new FormData();
		form.append("file", new File([svg], "logo.svg", { type: "image/svg+xml" }));
		const uploaded = await request(app, "/api/admin/branding/logo", { method: "POST", body: form });
		expect(uploaded.status).toBe(201);
		const saved = await view(uploaded);
		expect(saved.logoUrl).toBeDefined();
		const image = await request(app, saved.logoUrl as string, { headers: {} });
		expect(image.status).toBe(200);
		expect(image.headers.get("content-type")).toBe("image/svg+xml");
		const policies = image.headers
			.get("content-security-policy")
			?.split(";")
			.map((part) => part.trim());
		expect(policies).toEqual(
			expect.arrayContaining(["sandbox", "default-src 'none'", "base-uri 'none'", "form-action 'none'"]),
		);
		expect(image.headers.get("x-content-type-options")).toBe("nosniff");
		expect(await image.text()).toBe(svg);
	});

	it("非法 URL / 文件类型被拒，审计员不能写", async () => {
		const { app, services, db } = setup();
		const invalid = await request(app, "/api/admin/branding", {
			method: "PUT",
			body: { productName: "品牌", logoUrl: "javascript:alert(1)" },
		});
		expect(invalid.status).toBe(400);

		const invalidFile = new FormData();
		invalidFile.append("file", new File(["not an image"], "logo.txt", { type: "text/plain" }));
		expect((await request(app, "/api/admin/branding/logo", { method: "POST", body: invalidFile })).status).toBe(400);

		const readOnly = await request(app, "/api/admin/branding", {
			method: "PUT",
			headers: auditorHeaders,
			body: { productName: "审计员品牌" },
		});
		expect(readOnly.status).toBe(403);
		expect(services.branding.get().product_name).toBe("OpenAgentPack Kit");

		await request(app, "/api/admin/branding", { method: "PUT", body: { productName: "品牌" } });
		const row = db
			.prepare("SELECT action, target FROM kit_audit WHERE action = 'branding.update' ORDER BY id DESC LIMIT 1")
			.get() as { action: string; target: string } | undefined;
		expect(row).toEqual({ action: "branding.update", target: "employee-web" });
	});
});
