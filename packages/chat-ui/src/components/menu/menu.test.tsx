import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./index.tsx";

function trigger(open?: boolean) {
	return renderToStaticMarkup(
		<Menu open={open}>
			<MenuTrigger asChild>
				<button type="button">附件</button>
			</MenuTrigger>
			<MenuContent>
				<MenuItem onSelect={() => {}}>上传图片</MenuItem>
			</MenuContent>
		</Menu>,
	);
}

describe("Menu", () => {
	// 菜单语义由 Radix 在触发器上声明（haspopup/expanded），键盘与焦点管理同源。
	it("触发器带 menu 语义，关闭态不出菜单项", () => {
		const html = trigger();
		expect(html).toContain('aria-haspopup="menu"');
		expect(html).toContain('aria-expanded="false"');
		expect(html).toContain("附件");
		expect(html).not.toContain("上传图片");
	});

	// 弹层经 Portal 只在客户端渲染，SSR 恒不出现内容；受控 open 只反映在触发器状态。
	it("受控展开时 aria-expanded 翻转，弹层内容不出现在 SSR 输出", () => {
		const html = trigger(true);
		expect(html).toContain('aria-expanded="true"');
		expect(html).not.toContain("上传图片");
	});
});
