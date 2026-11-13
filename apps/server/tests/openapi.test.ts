import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

/**
 * OpenAPI 文档链路守护。
 * 保护的不变量：任何一条路由的 schema 用了 zod-openapi 渲染不了的类型
 * （实测：`z.instanceof(File)` → custom、`z.file()` → file），**整份文档**会退化成
 * `{ message: "Unknown zod object type…" }`，前端类型与接口文档同时失效。
 * 该失败过去只在 `pnpm gen:openapi` 时可见，故在此固化成测试。
 */
function makeDocApp() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-openapi-"));
	const config = loadConfig({ KIT_GATEWAY: "mock", KIT_DATA_DIR: dataDir, ADMIN_TOKEN: "t" });
	return createApp(createKitServices(config, openDatabase(dataDir)));
}

const REQUIRED_PATHS = [
	"/healthz",
	"/api/config",
	"/api/kit/agents",
	"/api/kit/auth/login",
	"/api/kit/auth/me",
	"/api/kit/auth/logout",
	"/api/kit/sessions",
	"/api/kit/sessions/{sessionId}",
	"/api/kit/sessions/{sessionId}/plan",
	"/api/kit/sessions/{sessionId}/archive",
	"/api/kit/sessions/{sessionId}/messages",
	"/api/kit/sessions/{sessionId}/stream",
	"/api/kit/sessions/{sessionId}/tool-approvals",
	"/api/kit/files",
	"/api/kit/files/{fileId}/download",
	"/api/admin/agents/{slug}/plan",
	"/api/admin/metrics",
	"/api/admin/members",
];

describe("openapi 文档", () => {
	it("可渲染、无 zod 错误、覆盖数据面与控制面关键路由", async () => {
		const doc = (await (await makeDocApp().request("/openapi.json")).json()) as {
			message?: string;
			paths?: Record<string, unknown>;
		};
		expect(doc.message).toBeUndefined();
		const paths = Object.keys(doc.paths ?? {});
		expect(paths.length).toBeGreaterThanOrEqual(REQUIRED_PATHS.length);
		for (const required of REQUIRED_PATHS) expect(paths).toContain(required);
		expect(paths.some((path) => path.startsWith("/api/admin/projects"))).toBe(false);
		expect(paths).toContain("/api/admin/resource-drafts/{name}/resources/plan");
		expect(paths).toContain("/api/admin/resource-drafts/{name}/resources/publish");
		expect(paths).not.toContain("/api/admin/sessions");
		expect(paths).not.toContain("/api/admin/sessions/{sessionId}/events");
	});

	it("流式、发送和审批文档声明必填协议版本头，示例可直接调用", async () => {
		const doc = (await (await makeDocApp().request("/openapi.json")).json()) as {
			paths: Record<
				string,
				Record<string, { parameters: { name: string; in: string; required: boolean; schema: { example?: string } }[] }>
			>;
		};
		for (const [path, method] of [
			["/api/kit/sessions/{sessionId}/stream", "get"],
			["/api/kit/sessions/{sessionId}/messages", "post"],
			["/api/kit/sessions/{sessionId}/tool-approvals", "get"],
			["/api/kit/sessions/{sessionId}/tool-approvals", "post"],
		] as const) {
			expect(
				doc.paths[path]?.[method]?.parameters.find((parameter) => parameter.name === "x-kit-protocol-version"),
			).toMatchObject({ in: "header", required: true, schema: { example: "2.0.0" } });
		}
	});

	it("multipart 上传路由以 string/binary 描述（不是 zod custom/file）", async () => {
		const doc = (await (await makeDocApp().request("/openapi.json")).json()) as {
			paths: Record<string, Record<string, { requestBody?: { content: Record<string, { schema: unknown }> } }>>;
		};
		const schema = doc.paths["/api/kit/files"]?.post?.requestBody?.content["multipart/form-data"]?.schema;
		expect(JSON.stringify(schema)).toContain('"format":"binary"');
	});

	it("仓库内 openapi.json 与路由定义不漂移（改路由后需 pnpm gen:openapi）", async () => {
		const committed = JSON.parse(readFileSync(join(process.cwd(), "openapi.json"), "utf8")) as unknown;
		const fresh = await (await makeDocApp().request("/openapi.json")).json();
		expect(committed).toEqual(fresh);
	});
});
