import { describe, expect, it } from "vitest";
import { UsageLimitConfigSchema } from "./usage-limits.ts";

describe("限额配置的运行时输入边界", () => {
	it("月度两项必须明确提供，日度缺省不限量；支持不限量与禁止新增消耗，拒绝不安全计数和无效时长", () => {
		for (const config of [
			{ monthly_tokens: null, monthly_active_seconds: null },
			{ monthly_tokens: 0, monthly_active_seconds: 0 },
			{ monthly_tokens: Number.MAX_SAFE_INTEGER, monthly_active_seconds: 0.25 },
		]) {
			expect(UsageLimitConfigSchema.parse(config)).toEqual({
				...config,
				daily_tokens: null,
				daily_active_seconds: null,
			});
		}
		for (const config of [
			{ monthly_tokens: 1 },
			{ monthly_tokens: -1, monthly_active_seconds: null },
			{ monthly_tokens: 1.5, monthly_active_seconds: null },
			{ monthly_tokens: Number.MAX_SAFE_INTEGER + 1, monthly_active_seconds: null },
			{ monthly_tokens: null, monthly_active_seconds: -1 },
			{ monthly_tokens: null, monthly_active_seconds: Infinity },
			{ monthly_tokens: null, monthly_active_seconds: null, daily_tokens: 1.5 },
			{ monthly_tokens: null, monthly_active_seconds: null, daily_active_seconds: -1 },
		]) {
			expect(UsageLimitConfigSchema.safeParse(config).success).toBe(false);
		}
	});
});
