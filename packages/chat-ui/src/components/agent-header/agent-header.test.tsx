import { AgentSummarySchema } from "@openagentpack/kit-sdk/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentHeader } from "./index.tsx";

const agent = AgentSummarySchema.parse({ slug: "writer", display_name: "写作助手", icon: "✍️", capabilities: {} });

describe("Agent 头部", () => {
	// 合并后的标题切换器与已有操作区必须能并存，不能回退到覆盖 actions 的旧头部。
	it("切换器保留当前选择和自定义操作，静态标题仍可独立使用", () => {
		const html = renderToStaticMarkup(
			<AgentHeader
				agent={agent}
				agents={[agent, { ...agent, slug: "reviewer", display_name: "评审助手" }]}
				onPickAgent={() => {}}
				onNewSession={() => {}}
				actions={<button type="button">会话管理</button>}
			/>,
		);
		expect(html).toContain('aria-label="切换 Agent"');
		expect(html).toMatch(/<option value="writer" selected="">写作助手<\/option>/);
		expect(html).toContain("评审助手");
		expect(html).toContain("会话管理");
		expect(html).not.toContain("新会话");
		const plain = renderToStaticMarkup(<AgentHeader agent={agent} onNewSession={() => {}} />);
		expect(plain).not.toContain("<select");
		expect(plain).toContain("新会话");
	});

	// catalog 允许用户填 emoji；不能把文本误渲染成会发起请求的 img。
	it("emoji 显示为文本，图片地址仍显示图片", () => {
		const emoji = renderToStaticMarkup(<AgentHeader agent={agent} />);
		expect(emoji).toContain("✍️");
		expect(emoji).not.toContain("<img");
		for (const icon of ["https://example.test/agent.png", "data:image/png;base64,aA==", "/agent.png", "./agent.png"]) {
			const html = renderToStaticMarkup(<AgentHeader agent={{ ...agent, icon }} />);
			expect(html).toContain(`<img src="${icon}"`);
		}
	});
});
