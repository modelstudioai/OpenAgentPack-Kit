import { describe, expect, it } from "vitest";
import { formatBeijingTime, formatUsageDayStart } from "./beijing-time.ts";

describe("用户端北京时间", () => {
	it.each([
		["2026-11-05T00:00:00Z", "2026-11-05 08:00:00"],
		["2026-11-05T16:00:00Z", "2026-11-06 00:00:00"],
		["2026-12-31T20:30:45Z", "2027-01-01 04:30:45"],
		["2026-11-05T08:00:00+08:00", "2026-11-05 08:00:00"],
	] as const)("%s 显示为 %s", (iso, expected) => {
		expect(formatBeijingTime(iso)).toBe(expected);
	});

	it("聚合日键以北京时间八点起算，不伪装为北京零点", () => {
		expect(formatUsageDayStart("2026-10-26")).toBe("2026-10-26 08:00:00");
	});

	it("无效时间显示缺省值", () => {
		expect(formatBeijingTime("invalid")).toBe("—");
	});
});
