import { createFromSource } from "fumadocs-core/search/server";
import { source } from "../../../lib/source.ts";

/**
 * 静态搜索索引：`output: export` 下把 GET 路由预渲染成静态文件，
 * 客户端搜索框（fumadocs 默认 dialog，type=static）从这里拉索引。
 * 缺了它搜索框永远是空结果（部署站实测 data-empty=true）。
 */
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);
