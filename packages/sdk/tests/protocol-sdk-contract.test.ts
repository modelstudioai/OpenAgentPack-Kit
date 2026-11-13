/**
 * 契约守护：runtime import 上游 SDK（仅测试），校验
 * 1) SDK 已知事件类型全部落在 kit 的展示分桶内（不出现「未分类即丢弃」）；
 * 2) kit 的终止状态判定与 SDK 的 isTerminalSessionStatus 一致。
 * 放在 tests/ 而非 src/，避免触发 dependency-cruiser 的 protocol 运行时导入规则。
 */
import { KNOWN_SESSION_EVENT_TYPES, isTerminalSessionStatus as sdkIsTerminal } from "@openagentpack/sdk";
import { describe, expect, it } from "vitest";
import { bucketOf, isTerminalSessionStatus } from "../src/protocol/events.ts";

describe("与 @openagentpack/sdk 的契约对齐", () => {
	it("SDK 已知事件类型都有展示分桶", () => {
		for (const type of KNOWN_SESSION_EVENT_TYPES) {
			expect(typeof bucketOf(type)).toBe("string");
		}
		// 关键类型必须落在预期桶，防止映射回归
		expect(bucketOf("tool_call")).toBe("tool");
		expect(bucketOf("thread_created")).toBe("thread");
		expect(bucketOf("session_status")).toBe("status");
	});

	it("终止状态判定与 SDK 一致", () => {
		for (const status of ["terminated", "completed", "failed", "deleted", "idle", "running", "archived"]) {
			expect(isTerminalSessionStatus(status)).toBe(sdkIsTerminal(status));
		}
	});
});
