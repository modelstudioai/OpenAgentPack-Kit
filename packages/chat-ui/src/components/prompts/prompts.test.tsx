import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Prompts } from "./index.tsx";

function maxButtonDepth(html: string): number {
	let depth = 0;
	let max = 0;
	for (const [tag] of html.matchAll(/<\/?button\b/g)) {
		depth += tag.startsWith("</") ? -1 : 1;
		max = Math.max(max, depth);
	}
	return max;
}

describe("提示集", () => {
	// 体验页直接透传 catalog 的示例问题：没有示例时不能留下孤立标题或空容器。
	it("没有条目时不渲染任何内容", () => {
		expect(renderToStaticMarkup(<Prompts title="试试这样问" items={[]} />)).toBe("");
	});

	// 保护点击可达性：分组卡片不能是按钮（嵌套按钮在真实点击时会吞掉子项），禁用必须落到原生 disabled。
	it("分组卡片只承载子项按钮，禁用项与禁用分组的子项都不可点击", () => {
		const html = renderToStaticMarkup(
			<Prompts
				items={[
					{ key: "a", label: "可用问题" },
					{ key: "b", label: "禁用问题", disabled: true },
					{ key: "g", label: "运维分组", disabled: true, children: [{ key: "g1", label: "归档会话" }] },
					{ key: "h", label: "热门分组", children: [{ key: "h1", label: "能做什么" }] },
				]}
			/>,
		);
		expect(maxButtonDepth(html)).toBe(1);
		const buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].map(([, attrs, body]) => ({
			text: body?.replace(/<[^>]+>/g, ""),
			disabled: /\sdisabled=""/.test(attrs ?? ""),
		}));
		expect(buttons).toEqual([
			{ text: "可用问题", disabled: false },
			{ text: "禁用问题", disabled: true },
			{ text: "归档会话", disabled: true },
			{ text: "能做什么", disabled: false },
		]);
		expect(html).toContain("运维分组");
		expect(html).toContain("热门分组");
	});
});
