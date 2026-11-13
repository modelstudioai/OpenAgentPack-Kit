import { describe, expect, it } from "vitest";
import { createOriginMatcher, DEFAULT_CORS_ORIGINS } from "../src/services/cors.ts";

/**
 * 保护的不变量：壳（桌面/移动）用 127.0.0.1 + 随机端口加载体验页，必须能跨源访问 server；
 * 同时「端口通配」不得外溢到非 loopback 域名（否则等于给任意外站开了跨站请求）。
 */
describe("CORS 白名单", () => {
	it("默认放行本机 vite 与 loopback 任意端口（壳场景）", () => {
		const match = createOriginMatcher(DEFAULT_CORS_ORIGINS);
		expect(match("http://localhost:5173")).toBe("http://localhost:5173");
		expect(match("http://127.0.0.1:41237")).toBe("http://127.0.0.1:41237");
		expect(match("http://127.0.0.1:1")).toBe("http://127.0.0.1:1");
	});

	it("非白名单来源一律拒绝（不回显 origin）", () => {
		const match = createOriginMatcher(DEFAULT_CORS_ORIGINS);
		expect(match("https://evil.example.com")).toBeUndefined();
		expect(match("http://127.0.0.1.evil.com:5173")).toBeUndefined();
		expect(match("http://127.0.0.1:port")).toBeUndefined();
		expect(match("")).toBeUndefined();
	});

	it("`:*` 通配只对 loopback 生效，写在外部域名上会被忽略", () => {
		const match = createOriginMatcher(["https://kit.example.com", "https://evil.example.com:*"]);
		expect(match("https://kit.example.com")).toBe("https://kit.example.com");
		expect(match("https://evil.example.com:8443")).toBeUndefined();
	});

	it("显式白名单会覆盖默认值（不再放行随机 loopback 端口）", () => {
		const match = createOriginMatcher(["https://kit.example.com"]);
		expect(match("http://127.0.0.1:41237")).toBeUndefined();
		expect(match("https://kit.example.com")).toBe("https://kit.example.com");
	});
});
