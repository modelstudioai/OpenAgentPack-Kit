import { describe, expect, it } from "vitest";
import { formatExactTokenCount, formatTokenCount } from "./format-token-count.ts";

describe("用户端 Token 数量展示", () => {
	it.each([
		[0, "0"],
		[999, "999"],
		[1000, "1K"],
		[1234, "1.23K"],
		[9999, "10K"],
		[999995, "1M"],
		[1200000, "1.2M"],
		[1234567890, "1.23B"],
		[999999999999, "1T"],
	] as const)("%s → %s，千进制且省略末尾零", (value, expected) => {
		expect(formatTokenCount(value)).toBe(expected);
	});

	it("紧凑展示仍可查看完整数值", () => {
		expect(formatExactTokenCount(1234567890)).toBe("1,234,567,890");
		expect(formatExactTokenCount(999995)).toBe("999,995");
	});
});
