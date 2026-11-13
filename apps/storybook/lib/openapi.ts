import { join } from "node:path";
import type { OperationOutput, WebhookOutput } from "fumadocs-openapi";
import { createOpenAPI } from "fumadocs-openapi/server";

/**
 * 后端接口声明的唯一来源：`apps/server/openapi.json`（由路由的 zod schema 生成，
 * 见 `docs/interfaces.md` 与 `apps/server/tests/openapi.test.ts`）。
 * `scripts/sync-openapi.mjs` 在 dev/build 前把它复制到本包根目录（gitignore）。
 *
 * fumadocs-openapi 会为每个 tag/operation 生成「虚拟页面」，自动进侧栏、TOC 与静态导出参数，
 * 因此接口声明在站点上是可浏览的（含请求体/响应 schema、错误码、确认令牌语义）。
 */
export const openapi = createOpenAPI({
	input: [join(process.cwd(), "openapi.json")],
	disableCache: true,
});

/**
 * 虚拟页面文件名：tag 已经作为目录（kit/admin/admin-resource-draft/meta），
 * 文件名移除对应的 API 前缀，避免 URL 重复。
 * 规则与 spec 的 tag 划分一一对应（见 apps/server 路由的 tags）。
 */
// NameFn 的入参是 Omit<Entry, "path">（path 由分组决定），所以这里不能要求 path 存在
export function operationFileName(output: Omit<OperationOutput, "path"> | Omit<WebhookOutput, "path">): string {
	// webhook 条目没有 path，用 name 兜底（本 spec 没有 webhooks，防御性处理）
	const item = output.item as { path?: string; method?: string; name?: string };
	const path = item.path ?? item.name ?? "";
	const method = item.method ?? "get";
	const stripped = path
		.replace(/^\/api\/kit\//, "")
		.replace(/^\/api\/admin\/resource-drafts\//, "")
		.replace(/^\/api\/admin\//, "")
		.replace(/^\/api\//, "")
		.replace(/^\//, "")
		.replace(/[{}]/g, "")
		.replace(/\/+$/, "")
		// 统一小写：部署在 Linux（大小写敏感），手写文档里的链接也按小写书写，避免 404
		.toLowerCase();
	return `${stripped}/${method.toLowerCase()}`;
}

export const openapiSource = await openapi.staticSource({
	baseDir: "api",
	meta: true,
	// 按 spec 的 tags 分组（kit / admin / admin-resource-draft / meta），侧栏才是「接口家族」而不是 40 条平铺路径
	groupBy: "tag",
	name: operationFileName,
});
