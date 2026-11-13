import { defineConfig, devices } from "@playwright/test";

const E2E_CHANNEL = (process.env.KIT_E2E_CHANNEL || "chrome") as "chrome" | "chromium";

/**
 * E2E：mock gateway 全栈（server + web + console）。
 * 浏览器默认系统 Chrome（channel: chrome）；CI 用 `KIT_E2E_CHANNEL=chromium` 切到
 * playwright 自带 chromium（`playwright install` 下载，CI 有公网）。
 */
export default defineConfig({
	testDir: "./e2e",
	// 成员登录有独立配置；此处继续验证显式匿名演示模式。
	testIgnore: [
		"**/member-login.spec.ts",
		"**/member-usage.spec.ts",
		"**/member-usage-flow.spec.ts",
		"**/usage-limits.spec.ts",
	],
	timeout: 60_000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	// 双 project 共享同一组 webServer：串行避免资源竞争导致的偶发失败
	workers: 1,
	retries: 1,
	reporter: [["list"]],
	use: { baseURL: "http://localhost:5173", trace: "on-first-retry" },
	projects: [
		{ name: "desktop", use: { ...devices["Desktop Chrome"], channel: E2E_CHANNEL } },
		{
			name: "mobile",
			testMatch: /experience\.spec\.ts/,
			use: {
				browserName: "chromium",
				channel: E2E_CHANNEL,
				viewport: { width: 390, height: 844 },
				isMobile: true,
				hasTouch: true,
				userAgent:
					"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
			},
		},
	],
	webServer: [
		{
			command: "node ../server/dist/bin.js",
			url: "http://localhost:8787/healthz",
			timeout: 30_000,
			env: {
				KIT_GATEWAY: "mock",
				KIT_AUTH_MODE: "anonymous",
				ADMIN_TOKEN: "e2e-token",
				KIT_ADMIN_TOKENS: "e2e-auditor:auditor",
				// 浏览器用例共用管理员身份并连续刷新表单；限流合同由 server 专项测试保护。
				KIT_RATE_LIMIT_RPS: "100",
				KIT_RATE_LIMIT_BURST: "200",
				KIT_DATA_DIR: ".data-e2e",
				PORT: "8787",
				KIT_CORS_ORIGINS: "http://localhost:5173,http://localhost:5174,http://127.0.0.1:*",
			},
		},
		{ command: "pnpm dev", url: "http://localhost:5173", timeout: 60_000, reuseExistingServer: false },
		{
			command: "pnpm --filter console dev",
			url: "http://localhost:5174",
			timeout: 60_000,
			reuseExistingServer: false,
			cwd: "../..",
		},
	],
});
