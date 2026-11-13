import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = fileURLToPath(new URL("../..", import.meta.url));

/** 独立成员数据库验证月度限额；浏览器 fixture 补充只读与失败恢复交互。 */
export default defineConfig({
	testDir: "./e2e",
	testMatch: "usage-limits.spec.ts",
	timeout: 60_000,
	expect: { timeout: 15_000 },
	workers: 1,
	retries: 0,
	reporter: [["list"]],
	outputDir: `${root}/.scratch/usage-limits-ui/output`,
	metadata: {
		consoleUrl: "http://localhost:5204",
		webUrl: "http://localhost:5203",
		apiBaseUrl: "http://localhost:8799",
	},
	use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:8799", channel: "chrome", trace: "off" },
	webServer: [
		{
			command: "pnpm --filter @openagentpack/kit-server exec tsx src/bin.ts",
			cwd: root,
			url: "http://localhost:8799/healthz",
			timeout: 30_000,
			reuseExistingServer: false,
			env: {
				KIT_GATEWAY: "mock",
				KIT_AUTH_MODE: "member",
				ADMIN_TOKEN: "e2e-token",
				KIT_DATA_DIR: `${root}/.scratch/usage-limits-ui/data-${process.pid}-${Date.now()}`,
				PORT: "8799",
				KIT_CORS_ORIGINS: "http://localhost:5203,http://localhost:5204",
			},
		},
		{
			command: "pnpm --filter web exec vite --port 5203 --strictPort",
			cwd: root,
			url: "http://localhost:5203",
			timeout: 60_000,
			reuseExistingServer: false,
		},
		{
			command: "pnpm --filter console exec vite --port 5204 --strictPort",
			cwd: root,
			url: "http://localhost:5204",
			timeout: 60_000,
			reuseExistingServer: false,
		},
	],
});
