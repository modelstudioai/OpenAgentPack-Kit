import type { ChatMessage, MessagePart } from "@openagentpack/kit-sdk/messages";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageList } from "../../message-list/index.tsx";
import { ExecutionGroup, type ProcessPart } from "../execution-group/index.tsx";
import { ReasoningBlock } from "../reasoning-block/index.tsx";
import { toolSummary } from "../tool-summary/index.ts";
import { ToolCallCard } from "./index.tsx";

function toolPart(overrides: Partial<Extract<MessagePart, { type: "tool" }>> = {}) {
	return { type: "tool", toolId: "t1", name: "echo", status: "done", ...overrides } as const;
}

describe("工具摘要文案", () => {
	it("已知工具给动词 + 操作对象徽标", () => {
		expect(toolSummary({ name: "read_file", input: { path: "/mnt/report.md" } })).toEqual({
			verb: "读取文件",
			badge: "report.md",
		});
		expect(toolSummary({ name: "write_file", input: { path: "/tmp/out.txt" } })).toEqual({
			verb: "写入文件",
			badge: "out.txt",
		});
		expect(toolSummary({ name: "web_search", input: { query: "竞品定价" } })).toEqual({
			verb: "搜索",
			badge: "竞品定价",
		});
		expect(toolSummary({ name: "bash", input: { command: "ls -la /workspace" } })).toEqual({
			verb: "执行命令",
			badge: "ls -la /workspace",
		});
	});

	it("未知工具回退到工具名 + 首个字符串字段徽标；长值被截断", () => {
		expect(toolSummary({ name: "generate_report", input: { format: "md" } })).toEqual({
			verb: "generate_report",
			badge: "md",
		});
		const long = toolSummary({ name: "custom", input: { path: `/${"a".repeat(80)}.txt` } });
		expect(long.badge).toMatch(/…$/);
		expect(toolSummary({ name: "mystery" })).toEqual({ verb: "mystery" });
	});

	it("模板字段缺失或为非字符串时回退，不显示残缺文案", () => {
		expect(toolSummary({ name: "read_file", input: {} })).toEqual({ verb: "read_file" });
		expect(toolSummary({ name: "read_file", input: { path: 0 } })).toEqual({ verb: "read_file" });
		expect(toolSummary({ name: "echo", input: { text: "hi" } })).toEqual({ verb: "echo", badge: "hi" });
	});
});

describe("工具调用卡", () => {
	it("动词与徽标出现在摘要行；运行中带执行中状态", () => {
		const html = renderToStaticMarkup(
			<ToolCallCard part={toolPart({ name: "read_file", input: { path: "/mnt/report.md" } })} />,
		);
		expect(html).toContain("读取文件");
		expect(html).toContain("report.md");
		expect(html).toContain("已完成");
		const running = renderToStaticMarkup(<ToolCallCard part={toolPart({ status: "running" })} />);
		expect(running).toContain("执行中");
	});

	it("JSON 输出用代码块语言标记，文本输出保留原文", () => {
		const json = renderToStaticMarkup(<ToolCallCard part={toolPart({ output: { rows: [1, 2], total: 2 } })} />);
		expect(json).toContain('data-language="json"');
		expect(json).toContain("&quot;total&quot;");
		const text = renderToStaticMarkup(<ToolCallCard part={toolPart({ output: "# 标题\n\n正文段落。" })} />);
		expect(text).not.toContain("lang-json");
		expect(text).toMatch(/<pre[^>]*>[\s\S]*# 标题[\s\S]*正文段落。/);
	});

	it("残缺 JSON（截断的流式输出）回退为正文渲染，不报错", () => {
		const html = renderToStaticMarkup(<ToolCallCard part={toolPart({ output: '{"partial": ' })} />);
		expect(html).toContain("&quot;partial&quot;");
	});
});

describe("思考块", () => {
	it("始终默认收起，同一行露出内容预览；完成标签为已思考", () => {
		const streaming = renderToStaticMarkup(<ReasoningBlock text="第一行分析\n第二行" status="streaming" />);
		expect(streaming).toContain("思考中");
		expect(streaming).not.toMatch(/<details[^>]* open/);
		expect(streaming).toContain("第一行分析");
		const done = renderToStaticMarkup(<ReasoningBlock text="分析" status="done" />);
		expect(done).toContain("已思考");
		expect(done).not.toMatch(/<details[^>]* open/);
	});
});

describe("展开区限高", () => {
	it("默认 max-h-80（卡片内滚动不撑开页面）", () => {
		const html = renderToStaticMarkup(<ReasoningBlock text="分析" status="done" />);
		expect(html).toContain("max-h-80");
		expect(html).toContain("overflow-y-auto");
	});

	it("contentMaxHeight 整体替换默认值，不与默认类叠加", () => {
		const custom = renderToStaticMarkup(<ReasoningBlock text="分析" status="done" contentMaxHeight="max-h-96" />);
		expect(custom).toContain("max-h-96");
		expect(custom).not.toContain("max-h-80");
		const tool = renderToStaticMarkup(<ToolCallCard part={toolPart()} contentMaxHeight="max-h-none" />);
		expect(tool).toContain("max-h-none");
		expect(tool).not.toContain("max-h-80");
	});
});

describe("className 透传", () => {
	it("追加到卡片根节点 details", () => {
		const tool = renderToStaticMarkup(<ToolCallCard part={toolPart()} className="my-4" />);
		expect(tool).toMatch(/<details[^>]*class="[^"]*my-4/);
		const reasoning = renderToStaticMarkup(<ReasoningBlock text="分析" status="done" className="w-full" />);
		expect(reasoning).toMatch(/<details[^>]*class="[^"]*w-full/);
		const group = renderToStaticMarkup(<ExecutionGroup parts={[toolPart()]} className="mt-0" />);
		expect(group).toMatch(/<details[^>]*class="[^"]*mt-0/);
	});
});

describe("执行容器分组", () => {
	const parts: ProcessPart[] = [
		{ type: "reasoning", text: "先想想", status: "done", startedAt: "2026-10-30T03:00:00Z" },
		toolPart({
			toolId: "t1",
			name: "read_file",
			input: { path: "/a.css" },
			status: "done",
			startedAt: "2026-10-30T03:00:01Z",
			endedAt: "2026-10-30T03:00:04Z",
		}),
	];

	it("连续思考/工具折成一个容器：头部状态、步数、总时长与时间线步骤", () => {
		const html = renderToStaticMarkup(<ExecutionGroup parts={parts} />);
		expect(html).toContain('aria-label="执行过程"');
		expect(html).toContain("已执行");
		expect(html).toContain("2 步");
		expect(html).toContain("· 4s");
		expect(html).toContain("读取文件");
		expect(html).toContain("a.css");
	});

	it("运行中显示正在执行；缺时间戳时不显示时长", () => {
		const running = renderToStaticMarkup(
			<ExecutionGroup
				parts={[toolPart({ status: "running" }), { type: "reasoning", text: "想", status: "streaming" }]}
			/>,
		);
		expect(running).toContain("正在执行");
		// 执行中标题走流光扫光；结束后回到静态文字。
		expect(running).toContain("kit-shimmer-text");
		expect(running).not.toContain("· ");
		const done = renderToStaticMarkup(<ExecutionGroup parts={[toolPart({ status: "done" })]} />);
		expect(done).toContain("已执行");
		expect(done).not.toContain("kit-shimmer-text");
	});

	it("运行中默认展开；流式期间最后一组保持展开，被正文终结或完成后收起", () => {
		const running = renderToStaticMarkup(<ExecutionGroup parts={[toolPart({ status: "running" })]} />);
		expect(running).toMatch(/<details[^>]* open[^>]* aria-label="执行过程"/);
		const done = renderToStaticMarkup(<ExecutionGroup parts={parts} />);
		expect(done).not.toMatch(/<details[^>]* open[^>]* aria-label="执行过程"/);
		const streaming = renderToStaticMarkup(<ExecutionGroup parts={parts} messageStreaming />);
		expect(streaming).toMatch(/<details[^>]* open[^>]* aria-label="执行过程"/);
		const endedRun = renderToStaticMarkup(<ExecutionGroup parts={parts} messageStreaming ended />);
		expect(endedRun).not.toMatch(/<details[^>]* open[^>]* aria-label="执行过程"/);
	});
});

describe("消息列表集成", () => {
	it("工具摘要进入消息流且保持交错顺序；正文打断分组", () => {
		const message: ChatMessage = {
			id: "m1",
			role: "assistant",
			status: "done",
			parts: [
				{ type: "text", text: "先查资料" },
				{ type: "tool", toolId: "t", name: "web_search", status: "done", input: { query: "价格" } },
				{ type: "text", text: "结论" },
			],
		};
		const html = renderToStaticMarkup(<MessageList messages={[message]} />);
		const positions = ["先查资料", "搜索", "价格", "结论"].map((t) => html.indexOf(t));
		expect(positions.every((p) => p >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
		// 单个工具分片也归入执行容器，独立列表与子线程复用同一渲染。
		expect(html).toContain('aria-label="执行过程"');
		expect(html).toContain("1 步");
	});
});
