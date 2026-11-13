import { defineConfig, devices } from "@playwright/test";

/** 针对构建后的静态站点运行；不启动 Kit server，也不访问 Provider。 */
export default defineConfig({
	testDir: "./e2e",
	outputDir: "../../.scratch/storybook-playwright-results",
	fullyParallel: true,
	workers: 2,
	reporter: "list",
	use: {
		channel: process.env.KIT_E2E_CHANNEL ?? "chrome",
		baseURL: process.env.DOCS_PREVIEW_URL ?? "http://127.0.0.1:3010",
		trace: "retain-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 } } }],
});
