import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const dataDirectory = `${root}/.scratch/member-login-e2e/data-${process.pid}-${Date.now()}`;

/** 成员登录全栈回归：独立端口与 SQLite，不读取 .env，也不复用用户正在运行的 demo。 */
export default defineConfig({
	testDir: "./e2e",
	testMatch: "member-login.spec.ts",
	timeout: 90_000,
	expect: { timeout: 15_000 },
	workers: 1,
	retries: 0,
	reporter: [["list"]],
	outputDir: `${root}/.scratch/member-login-e2e/output`,
	use: { baseURL: "http://localhost:8797", trace: "off" },
	projects: [
		{ name: "desktop", grep: /@desktop/, use: { ...devices["Desktop Chrome"], channel: "chrome" } },
		{
			name: "mobile",
			grep: /@mobile/,
			use: {
				browserName: "chromium",
				channel: "chrome",
				viewport: { width: 390, height: 844 },
				isMobile: true,
				hasTouch: true,
			},
		},
	],
	webServer: [
		{
			command: "pnpm --filter @openagentpack/kit-server exec tsx src/bin.ts",
			cwd: root,
			url: "http://localhost:8797/healthz",
			timeout: 30_000,
			reuseExistingServer: false,
			env: {
				KIT_GATEWAY: "mock",
				KIT_AUTH_MODE: "member",
				ADMIN_TOKEN: "e2e-token",
				KIT_DATA_DIR: dataDirectory,
				PORT: "8797",
				KIT_CORS_ORIGINS: "http://localhost:5183,http://localhost:5184",
			},
		},
		{
			command: "pnpm --filter web exec vite --port 5183 --strictPort",
			cwd: root,
			url: "http://localhost:5183",
			timeout: 60_000,
			reuseExistingServer: false,
		},
		{
			command: "pnpm --filter console exec vite --port 5184 --strictPort",
			cwd: root,
			url: "http://localhost:5184",
			timeout: 60_000,
			reuseExistingServer: false,
		},
	],
});
