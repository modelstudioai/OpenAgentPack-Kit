import { defineConfig, devices } from "@playwright/test";

/** 自建 Provider 的独立 Chat 验收只启动静态 Web，不需要 Kit Server 或凭据。 */
export default defineConfig({
	testDir: "./e2e",
	testMatch: "multi-agent.experience.spec.ts",
	timeout: 60_000,
	expect: { timeout: 15_000 },
	workers: 1,
	retries: 0,
	reporter: [["list"]],
	use: { baseURL: "http://127.0.0.1:5189", trace: "retain-on-failure" },
	projects: [
		{ name: "desktop", use: { ...devices["Desktop Chrome"], channel: process.env.KIT_E2E_CHANNEL ?? "chrome" } },
		{
			name: "mobile",
			use: {
				browserName: "chromium",
				channel: process.env.KIT_E2E_CHANNEL ?? "chrome",
				viewport: { width: 390, height: 844 },
				isMobile: true,
				hasTouch: true,
			},
		},
	],
	webServer: {
		command: "pnpm exec vite --host 127.0.0.1 --port 5189 --strictPort",
		url: "http://127.0.0.1:5189",
		timeout: 60_000,
		reuseExistingServer: false,
	},
});
