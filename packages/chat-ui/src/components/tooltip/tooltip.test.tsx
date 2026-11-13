import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolveTransform, Tooltip } from "./index.tsx";

describe("Tooltip", () => {
	// 气泡走 portal 且初始关闭：SSR 只渲染触发器本体（className 透传，截断类由调用方放这里），
	// 不出现气泡内容或 role；溢出检测依赖真实布局，行为归浏览器验证。
	it("SSR 渲染触发器并透传 className，不渲染气泡", () => {
		const html = renderToStaticMarkup(
			<Tooltip className="block truncate" content="完整标题" overflowOnly>
				截断的标题
			</Tooltip>,
		);
		expect(html).toContain("block truncate");
		expect(html).toContain("截断的标题");
		expect(html).not.toContain("完整标题");
		expect(html).not.toContain("role=");
	});
});

// 摆位碰撞检测：贴边触发器（侧栏行、锚点栏）不得把气泡推出视口（历史缺陷：tooltip 左缘被裁）。
describe("resolveTransform", () => {
	it("top 摆位左缘越界时夹回安全边距", () => {
		// 居中位 120 - 400/2 = -80 → 夹到 8
		expect(resolveTransform("top", { left: 120, top: 100 }, 400, 40, 1024, 768)).toBe("translate(-112px, -48px)");
	});

	it("空间充足时保持居中摆位", () => {
		expect(resolveTransform("top", { left: 300, top: 100 }, 200, 40, 1024, 768)).toBe("translate(-100px, -48px)");
	});

	it("left 摆位贴左触发器时夹回安全边距", () => {
		// 20 - 200 - 8 = -188 → 夹到 8
		expect(resolveTransform("left", { left: 20, top: 100 }, 200, 40, 1024, 768)).toBe("translate(-12px, -20px)");
	});

	it("视口装不下气泡时保住右缘不整块消失", () => {
		// 上限侧 300 - 8 - 400 < 边距 → 取上限侧，右缘停在 292
		expect(resolveTransform("top", { left: 150, top: 100 }, 400, 40, 300, 768)).toBe("translate(-258px, -48px)");
	});
});
