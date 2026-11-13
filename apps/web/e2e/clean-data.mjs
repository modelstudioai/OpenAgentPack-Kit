#!/usr/bin/env node
/**
 * E2E 隔离：删掉上一轮残留的 mock catalog/会话索引（.data-e2e）。
 * 残留的 listed 条目会污染「默认选中第一个已上架条目」这类断言
 * （2026-10-15 切换 Agent 用例在 mobile project 下因此看到十几个历史条目）。
 */
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

rmSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".data-e2e"), { recursive: true, force: true });
