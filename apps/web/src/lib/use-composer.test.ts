import { deriveTitle } from "@openagentpack/kit-sdk/chat";
import { describe, expect, it } from "vitest";

describe("首句标题推导", () => {
	it("折叠换行与连续空白，截到协议上限 120", () => {
		expect(deriveTitle("  帮我\n\n写一份\t报告  ")).toBe("帮我 写一份 报告");
		expect(deriveTitle("会".repeat(200))).toHaveLength(120);
	});

	it("纯空白不生成标题，调用方回退 agent_slug 展示", () => {
		expect(deriveTitle("   \n\t ")).toBeUndefined();
	});
});
