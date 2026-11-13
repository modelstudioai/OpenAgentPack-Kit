import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const dataDirectory = `${root}/.scratch/member-usage-ui/data-${process.pid}-${Date.now()}`;

/** 浏览器展示回归使用 Kit API fixture；Provider 与全量归并合同由 server 测试保护。 */
export default defineConfig({
	testDir: "./e2e",
	testMatch: ["member-usage.spec.ts", "member-usage-flow.spec.ts"],
	timeout: 60_000,
	expect: { timeout: 15_000 },
	workers: 1,
	retries: 0,
	reporter: [["list"]],
	outputDir: `${root}/.scratch/member-usage-ui/output`,
	metadata: {
		consoleUrl: "http://localhost:5194",
		webUrl: "http://localhost:5193",
		apiBaseUrl: "http://localhost:8798",
	},
	use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:8798", channel: "chrome", trace: "off" },
	webServer: [
		{
			command: "pnpm --filter @openagentpack/kit-server exec tsx src/bin.ts",
			cwd: root,
			url: "http://localhost:8798/healthz",
			timeout: 30_000,
			reuseExistingServer: false,
			env: {
				KIT_GATEWAY: "mock",
				KIT_AUTH_MODE: "member",
				ADMIN_TOKEN: "e2e-token",
				KIT_DATA_DIR: dataDirectory,
				PORT: "8798",
				KIT_CORS_ORIGINS: "http://localhost:5193,http://localhost:5194",
			},
		},
		{
			command: "pnpm --filter web exec vite --port 5193 --strictPort",
			cwd: root,
			url: "http://localhost:5193",
			timeout: 60_000,
			reuseExistingServer: false,
		},
		{
			command: "pnpm --filter console exec vite --port 5194 --strictPort",
			cwd: root,
			url: "http://localhost:5194",
			timeout: 60_000,
			reuseExistingServer: false,
		},
	],
});
