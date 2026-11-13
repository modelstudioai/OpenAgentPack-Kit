import { describe, expect, it } from "vitest";
import { createBackoff } from "./reconnect.ts";

describe("指数退避", () => {
	it("默认参数序列与上限", () => {
		const b = createBackoff({ random: () => 0.5 }); // jitter 中点 → 无偏移
		expect(b.next()).toBe(500);
		expect(b.next()).toBe(1000);
		expect(b.next()).toBe(2000);
		expect(b.next()).toBe(4000);
		expect(b.next()).toBe(8000);
		expect(b.next()).toBe(15000); // 触顶
		expect(b.next()).toBe(15000);
		expect(b.next()).toBe(15000);
		expect(b.next()).toBeNull(); // 第 9 次放弃
	});

	it("jitter 在 ±20% 内", () => {
		const b = createBackoff({ random: () => 1 });
		expect(b.next()).toBe(600); // 500 * 1.2
		const b2 = createBackoff({ random: () => 0 });
		expect(b2.next()).toBe(400); // 500 * 0.8
	});

	it("reset 后重新计数", () => {
		const b = createBackoff({ maxAttempts: 2, random: () => 0.5 });
		expect(b.next()).toBe(500);
		expect(b.next()).toBe(1000);
		expect(b.next()).toBeNull();
		b.reset();
		expect(b.next()).toBe(500);
	});
});
