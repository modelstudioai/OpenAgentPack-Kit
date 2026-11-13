import type { PlazaEntry } from "@openagentpack/kit-sdk/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlazaCard, relativeUsedLabel } from "../plaza/index.ts";

const ALL_ON = { streaming: true, fileUpload: true, artifacts: true, threads: true, reasoning: true };

const base: PlazaEntry = {
	slug: "a1",
	display_name: "测试 Agent",
	suggested_prompts: [],
	capabilities: ALL_ON,
	category: "general",
	featured: false,
	stats: { mine: false, turns_30d: 3 },
};

describe("广场卡片", () => {
	// 卡片是广场唯一的可点击入口：全字段渲染时各信息区必须可见，缺失字段不能把相邻区块挤没。
	it("完整字段：精选/分类/我的、描述、试试问、能力徽标与统计齐全", () => {
		const html = renderToStaticMarkup(
			<PlazaCard
				entry={{
					...base,
					description: "帮你看数据",
					suggested_prompts: ["怎么导入表格", "其他问题"],
					featured: true,
					stats: { mine: true, turns_30d: 3, last_used_at: new Date().toISOString() },
				}}
				onOpen={() => {}}
			/>,
		);
		expect(html).toContain("精选");
		expect(html).toContain("通用");
		expect(html).toContain("我的");
		expect(html).toContain("帮你看数据");
		expect(html).toContain("试试问：「怎么导入表格」");
		for (const label of ["流式输出", "文件上传", "产物", "多会话", "深度思考"]) {
			expect(html).toContain(label);
		}
		expect(html).toContain("近 30 天");
		expect(html).toContain("今天使用过");
	});

	// 描述/开场白/推荐问法/last_used_at 都是可选：全缺时只留占位描述，能力行按 capabilities 逐项过滤。
	it("最小字段：占位描述、无试试问、能力只渲染开启项", () => {
		const html = renderToStaticMarkup(
			<PlazaCard entry={{ ...base, capabilities: { ...ALL_ON, reasoning: false } }} onOpen={() => {}} />,
		);
		expect(html).toContain("暂无描述");
		expect(html).not.toContain("试试问");
		expect(html).not.toContain("精选");
		expect(html).not.toContain("我的");
		expect(html).not.toContain("深度思考");
		expect(html).toContain("流式输出");
		expect(html).not.toContain("使用过");
	});

	// 描述缺失时回退开场白，避免新上架条目只有「暂无描述」。
	it("描述缺失时回退展示开场白", () => {
		const html = renderToStaticMarkup(<PlazaCard entry={{ ...base, opening_remarks: "你好呀" }} onOpen={() => {}} />);
		expect(html).toContain("你好呀");
		expect(html).not.toContain("暂无描述");
	});
});

describe("relativeUsedLabel", () => {
	// now 注入后用本地构造日期，断言与时区无关。
	it("按本地日历日差给出今天/昨天/N 天前", () => {
		const now = new Date(2026, 10, 2, 12, 0, 0);
		expect(relativeUsedLabel(new Date(2026, 10, 2, 0, 30).toISOString(), now)).toBe("今天使用过");
		expect(relativeUsedLabel(new Date(2026, 10, 1, 20, 0).toISOString(), now)).toBe("昨天使用过");
		expect(relativeUsedLabel(new Date(2026, 9, 30, 3, 0).toISOString(), now)).toBe("3 天前使用过");
	});
});
