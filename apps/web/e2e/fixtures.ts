import { test as base, expect as pwExpect } from "@playwright/test";

/**
 * 自动夹具：把 React 的「非法 HTML 嵌套」开发期警告升级成测试失败。
 *
 * 为什么值得单独立一道闸门：`<button>` 里嵌 `<button>` 在真实点击时，Chrome 把激活行为交给
 * **外层**元素，内层按钮的 onClick 永远不触发；而合成 `el.click()` 却能触发，所以单测/手动
 * `dispatchEvent` 都发现不了，只有真机或 E2E 的真实点击会暴露（2026-10-14 会话侧栏归档/删除
 * 按钮就是这么坏的）。
 */
export const test = base.extend<{ nestingErrors: string[] }>({
	nestingErrors: [
		async ({ page }, use) => {
			const errors: string[] = [];
			page.on("console", (message) => {
				if (message.type() === "error" && /cannot be a descendant of/.test(message.text())) {
					errors.push(message.text());
				}
			});
			await use(errors);
			pwExpect(errors, `非法 HTML 嵌套（真实点击会被外层元素吞掉）：${errors.join(" | ")}`).toEqual([]);
		},
		{ auto: true },
	],
});

export const expect = pwExpect;
