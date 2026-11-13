import { loader } from "fumadocs-core/source";
import { docs } from "../.source/server.ts";
import { openapi, openapiSource } from "./openapi.ts";

/**
 * fumadocs-mdx 16 collection → fumadocs-core loader：
 * 提供 getPage / pageTree / generateParams 等页面 API。
 *
 * 两个来源合并进同一棵侧栏树：
 * - `docs`：`content/docs/*.mdx` 手写文档；
 * - `api`：由 `apps/server/openapi.json` 生成的接口声明虚拟页面（lib/openapi.ts）。
 */
export const source = loader({
	baseUrl: "/docs",
	// 手写 meta 置后，让 API 参考的导航包含接口总览；接口页仍由 OpenAPI 生成。
	source: { api: openapiSource, docs: docs.toFumadocsSource() },
	plugins: [openapi.loaderPlugin()],
});

/**
 * 侧栏目录名中文化。
 *
 * 虚拟接口页的目录名来自 baseDir 与 openapi tags（`Api` / `Meta` / `Kit` / `Admin` /
 * `Admin resource draft`），直接显示既不像中文站也不表达语义；这里在 loader 产出后就地改名，
 * 页面 URL 不受影响（改名只动 pageTree 的展示名）。
 */
const FOLDER_TITLES: Record<string, string> = {
	Api: "API 参考",
	Meta: "运行时配置",
	Kit: "数据面 · /api/kit",
	Admin: "管理面 · /api/admin",
	"Admin resource draft": "资源发布批次",
	"Admin Resource Draft": "资源发布批次",
};

function renameFolders(node: unknown, seen: Set<unknown>): void {
	if (typeof node !== "object" || node === null || seen.has(node)) return;
	seen.add(node);
	const record = node as Record<string, unknown>;
	if (record.type === "folder" && typeof record.name === "string") {
		const next = FOLDER_TITLES[record.name];
		if (next) record.name = next;
	}
	for (const value of Object.values(record)) {
		if (Array.isArray(value)) for (const item of value) renameFolders(item, seen);
		else renameFolders(value, seen);
	}
}

renameFolders(source.pageTree, new Set());
