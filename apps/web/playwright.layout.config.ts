import { defineConfig, devices } from "@playwright/test";

/** Layout 的纯组件回归只启动独立静态 Vite，不使用 Kit Server 或开发端口。 */
export default defineConfig({
	testDir: "./e2e",
	testMatch: "layout.experience.spec.ts",
	timeout: 30_000,
	expect: { timeout: 10_000 },
	workers: 1,
	retries: 0,
	reporter: [["list"]],
	use: { baseURL: "http://127.0.0.1:5192", trace: "retain-on-failure" },
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
		command: "pnpm exec vite --host 127.0.0.1 --port 5192 --strictPort",
		url: "http://127.0.0.1:5192",
		timeout: 60_000,
		reuseExistingServer: false,
	},
});
