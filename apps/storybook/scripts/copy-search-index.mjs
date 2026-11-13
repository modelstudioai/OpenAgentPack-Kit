import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Next 静态导出把搜索索引写成**无扩展名**文件 `out/api/search`。
 * 本地 python http.server 能直接serve，但部分静态托管服务器对无扩展名路径
 * 回落到 404 HTML（实测返回 text/html），搜索框因此拿不到 JSON。
 * 这里复制一份带 `.json` 扩展名的副本（nginx 按扩展名命中），搜索框指向它。
 */
const src = join(process.cwd(), "out", "api", "search");
const dest = join(process.cwd(), "out", "api", "search.json");

if (!existsSync(src)) {
	console.error("[storybook] out/api/search 缺失：搜索索引未复制（先 next build）");
	process.exitCode = 1;
} else {
	copyFileSync(src, dest);
	console.log("[storybook] 搜索索引已复制：out/api/search.json");
}
