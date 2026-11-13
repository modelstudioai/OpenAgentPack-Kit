import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CodeHighlighter } from "../code-highlighter/index.tsx";
import { Mermaid } from "../mermaid/index.tsx";
import { Markdown } from "./index.tsx";

describe("代码与图表反馈", () => {
	// 保护模型代码内容的展示边界：高亮只能生成文本节点，不得执行模型生成的 HTML。
	it("已知语言提供高亮，未知语言安全保留原文", () => {
		const highlighted = renderToStaticMarkup(
			<CodeHighlighter lang="tsx" showLineNumbers>
				{'const label = "<script>";\nreturn label;'}
			</CodeHighlighter>,
		);
		expect(highlighted).toMatch(/<span[^>]*>const<\/span>/);
		expect(highlighted).toMatch(/<pre[^>]*role="region"[^>]*aria-label="代码内容"[^>]*tabindex="0"/);
		expect(highlighted).toContain('aria-hidden="true"');
		expect(highlighted).toContain("&lt;script&gt;");
		const source = '<script>alert("test")</script>\n  原文\n';
		const language = "unknown-language-for-an-unavailable-report-generator";
		const unknown = renderToStaticMarkup(<CodeHighlighter lang={language}>{source}</CodeHighlighter>);
		expect(unknown).toContain(`title="${language}"`);
		expect(unknown).toContain("&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;\n  原文\n");
		expect(unknown).not.toContain("<script>");
	});

	// Markdown 同时承载行内代码、代码围栏和引用链接，新增反馈组件不能改变普通内容的语义。
	it("仅替换块级代码并保留安全链接与行内代码", () => {
		const html = renderToStaticMarkup(
			<Markdown>
				{
					'行内 `const inline = 1`\n\n```json\n{"answer":42}\n```\n\n[文档](https://example.com/docs) [危险](javascript:alert(1))'
				}
			</Markdown>,
		);
		expect(html).toMatch(/<code\b[^>]*>const inline = 1<\/code>/);
		expect(html.match(/data-code-highlighter/g)).toHaveLength(1);
		expect(html).toContain('data-language="json"');
		expect(html).toContain('href="https://example.com/docs"');
		expect(html).toContain('rel="noreferrer noopener"');
		expect(html).not.toContain('href="javascript:');
	});

	// 首屏和流式半截图表都不能启动错误图；关闭围栏后切换成图表加载入口。
	it("未闭合 Mermaid 围栏显示源码，完整围栏进入图表加载", () => {
		const incomplete = "```mermaid\nflowchart LR\nA-->B";
		const html = renderToStaticMarkup(<Markdown>{incomplete}</Markdown>);
		expect(html).toContain("图表生成中，先显示源码。");
		expect(html).toContain("A--&gt;B");
		expect(html).not.toContain("正在渲染图表…");
		for (const source of [
			`${incomplete}\n\`\`\``,
			"~~~mermaid\nflowchart LR\nA-->B\n~~~~",
			"> ```mermaid\n> flowchart LR\n> A-->B\n> ```",
		]) {
			const complete = renderToStaticMarkup(<Markdown>{source}</Markdown>);
			expect(complete).toContain("正在渲染图表…");
			expect(complete).not.toContain("图表生成中，先显示源码。");
		}
	});

	// Mermaid 导入和 DOM 渲染只允许在客户端执行；文档预渲染和用户直接查看源码都应可用。
	it("源码视图在无 DOM 的环境中可直接渲染", () => {
		const html = renderToStaticMarkup(
			<Mermaid defaultRenderType="code" copyable={false}>
				{"flowchart LR\nA-->B"}
			</Mermaid>,
		);
		expect(html).toContain("A--&gt;B");
		expect(html).not.toContain("正在渲染图表…");
		expect(html).not.toContain("复制图表源码");
	});

	// 上游 strict 仍会为图片节点下载资源；资源扩展必须在渲染器运行前回退到源码。
	it("图片扩展与编码后的 CSS 资源只显示源码", () => {
		for (const source of [
			'flowchart LR\nA@{ img: "//example.com/image.svg" }',
			'flowchart LR\nA["![image](data:image/svg+xml,example)"]',
			'flowchart LR\nA["&lt;img src=example.png&gt;"]',
			"flowchart LR\nA-->B\nclassDef image fill:u\\72l(//example.com/image.svg)",
		]) {
			const html = renderToStaticMarkup(<Mermaid>{source}</Mermaid>);
			expect(html).toContain("图片节点、嵌入资源及扩展节点语法仅显示源码。");
			expect(html).not.toContain("正在渲染图表…");
			expect(html).not.toContain("<img");
		}
	});

	// 大段日志或代码仍必须完整展示与复制，不能因语法分析开销阻塞持续到达的消息。
	it("很长的代码保留全文并退回纯文本", () => {
		const source = 'const entry = "完整输出";\n'.repeat(10_000);
		const html = renderToStaticMarkup(<CodeHighlighter lang="javascript">{source}</CodeHighlighter>);
		expect(html.match(/完整输出/g)).toHaveLength(10_000);
		expect(html.match(/<code\b[^>]*>([\s\S]*?)<\/code>/)?.[1]).not.toContain("<span");
	});
});
