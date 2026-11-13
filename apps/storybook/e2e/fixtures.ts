import { test as base, expect } from "@playwright/test";

export const test = base.extend<{ localPreviewChecks: undefined }>({
	localPreviewChecks: [
		async ({ page, baseURL }, use) => {
			const errors: string[] = [];
			const requests: string[] = [];
			const origin = new URL(baseURL ?? process.env.DOCS_PREVIEW_URL ?? "http://127.0.0.1:3010").origin;
			page.on("pageerror", (error) => errors.push(error.message));
			// 预览只消费本地样本；意外 Cloud 或业务 API 请求立即拦截并令验收失败。
			await page.route("**/*", (route) => {
				const url = new URL(route.request().url());
				if (url.origin !== origin || /^\/api\/(kit|admin|members)(\/|$)/.test(url.pathname)) {
					requests.push(`${url.origin}${url.pathname}`);
					return route.abort();
				}
				return route.continue();
			});
			await use(undefined);
			expect(errors, "静态预览不得产生页面脚本错误").toEqual([]);
			expect(requests, "静态预览不得请求 Cloud 或业务 API").toEqual([]);
		},
		{ auto: true },
	],
});

export { expect };
