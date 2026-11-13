#!/usr/bin/env node
/**
 * 把 `apps/server/openapi.json` 复制到本包根目录（gitignore）供 fumadocs-openapi 读取。
 *
 * 为什么复制而不是直接 import 上级目录：Next 静态导出会做文件追踪，跨包相对路径在
 * `output: "export"` 下不可靠；复制一份生成物最简单，也不会让文档站依赖 server 的构建顺序。
 * 真相仍是 server 的路由 schema（`pnpm gen:openapi` 生成，`tests/openapi.test.ts` 守护漂移）。
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = resolve(here, "..");
const spec = resolve(docsRoot, "../../apps/server/openapi.json");
if (!existsSync(spec)) {
	console.error(`[storybook] 未找到 ${spec}：先在仓库根目录运行 pnpm gen:openapi`);
	process.exit(1);
}
const doc = JSON.parse(readFileSync(spec, "utf8"));
const paths = Object.keys(doc.paths ?? {}).length;
copyFileSync(spec, join(docsRoot, "openapi.json"));
writeFileSync(
	join(docsRoot, ".openapi-sync.json"),
	`${JSON.stringify({ source: "../../apps/server/openapi.json", paths, syncedAt: new Date().toISOString() }, null, 2)}\n`,
);
console.warn(`[storybook] openapi.json 已同步（${paths} 条路径）`);
