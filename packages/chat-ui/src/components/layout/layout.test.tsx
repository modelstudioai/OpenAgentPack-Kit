import { useIsMobile } from "@openagentpack/kit-sdk/hooks";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Layout } from "./index.tsx";

vi.mock("@openagentpack/kit-sdk/hooks", () => ({ useIsMobile: vi.fn(() => false) }));
const isMobileMock = vi.mocked(useIsMobile);

describe("Layout aside 插槽", () => {
	it("桌面端打开：右列渲染面板内容，宽度消费 --kit-aside-width，面板内不注入关闭按钮", () => {
		const html = renderToStaticMarkup(
			<Layout
				sidebar={<nav />}
				aside={({ closeButton }) => (
					<>
						面板内容
						{closeButton}
					</>
				)}
				asideOpen
				asideLabel="资源面板"
			>
				<main>正文</main>
			</Layout>,
		);
		expect(html).toContain("面板内容");
		expect(html).toContain("width:var(--kit-aside-width)");
		// 桌面开合只经页头的面板开关；面板内关闭按钮仅移动覆盖层注入。
		expect(html).not.toContain("关闭资源面板");
	});

	it("桌面端收起：内容保持挂载（不丢面板状态），列宽过渡到 0 且不可聚焦", () => {
		const html = renderToStaticMarkup(
			<Layout sidebar={<nav />} aside={<>面板内容</>} asideOpen={false} onAsideOpenChange={() => {}}>
				<main>正文</main>
			</Layout>,
		);
		expect(html).toContain("面板内容");
		expect(html).toContain("width:0px");
		expect(html).toContain("inert");
	});

	it("未传 aside：不渲染右列与关闭按钮", () => {
		const html = renderToStaticMarkup(
			<Layout sidebar={<nav />}>
				<main>正文</main>
			</Layout>,
		);
		expect(html).not.toContain("width:var(--kit-aside-width)");
		expect(html).not.toContain("关闭资源面板");
	});

	it("桌面端：页头通栏（main 的直接子元素），面板列与正文并列在其下", () => {
		const html = renderToStaticMarkup(
			<Layout sidebar={<nav />} header={() => <div>页头</div>} aside={<>面板内容</>} asideOpen>
				<main>正文</main>
			</Layout>,
		);
		// 页头不再嵌进消息列：若被移回列内，页头会出现在 flex-col 包裹层里，此断言失败。
		expect(html).toMatch(/<main[^>]*><div>页头<\/div><div[^>]*class="flex min-h-0 min-w-0 flex-1"/);
	});

	it("移动端：面板走全屏覆盖层（Portal），静态标记中不出现内联右列", () => {
		isMobileMock.mockReturnValue(true);
		try {
			const html = renderToStaticMarkup(
				<Layout sidebar={<nav />} aside={<>面板内容</>} asideOpen>
					<main>正文</main>
				</Layout>,
			);
			expect(html).not.toContain("width:var(--kit-aside-width)");
			// Portal 内容不进 SSR 输出；未打开的覆盖层同样不渲染。
			expect(html).not.toContain("面板内容");
		} finally {
			isMobileMock.mockReturnValue(false);
		}
	});
});
