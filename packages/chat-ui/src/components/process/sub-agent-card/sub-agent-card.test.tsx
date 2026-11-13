import type { ChatMultiAgent } from "@openagentpack/kit-sdk/chat";
import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubAgentCard } from "./index.tsx";

type Thread = ChatMultiAgent["threads"][number];

function thread(overrides: Partial<Thread> = {}): Thread {
	return {
		id: "sthr_a",
		name: "研究员",
		status: "idle",
		messages: [],
		loading: false,
		error: null,
		nextPageToken: null,
		historyAvailable: true,
		loaded: true,
		...overrides,
	};
}

function multiAgent(threads: Thread[]): ChatMultiAgent {
	return {
		selectedThreadId: null,
		threads,
		loading: false,
		error: null,
		selectThread: () => undefined,
		refreshThreads: async () => undefined,
		loadThreadEvents: async () => undefined,
	};
}

const childMessages: ChatMessage[] = [
	{
		id: "c1",
		role: "assistant",
		status: "done",
		parts: [
			{ type: "reasoning", text: "拆解任务", status: "done", startedAt: "2026-10-28T00:00:01Z" },
			{ type: "tool", toolId: "t1", name: "read_file", status: "done", input: { path: "/mnt/data.csv" } },
			{ type: "text", text: "**研究结论**" },
		],
	},
];

describe("子 Agent 卡", () => {
	it("运行中默认展开并显示逐秒计时；完成后收起并带耗时", () => {
		const running = renderToStaticMarkup(
			<SubAgentCard threadId="sthr_a" multiAgent={multiAgent([thread({ status: "running" })])} />,
		);
		expect(running).toMatch(/<details[^>]* open/);
		expect(running).toContain("正在执行");
		const tagAt = running.indexOf(">子 Agent</span>");
		expect(tagAt).toBeGreaterThan(-1);
		// Tag 在图标之后、名称之前。
		expect(tagAt).toBeLessThan(running.indexOf(">研究员"));
		const done = renderToStaticMarkup(
			<SubAgentCard
				threadId="sthr_a"
				multiAgent={multiAgent([thread({ createdAt: "2026-10-28T00:00:00Z", endedAt: "2026-10-28T00:00:40Z" })])}
			/>,
		);
		expect(done).not.toMatch(/<details[^>]* open/);
		expect(done).toContain("已完成 · 40s");
	});

	it("同名并行不加序号", () => {
		const pair = [thread({ id: "sthr_a" }), thread({ id: "sthr_b" })];
		const first = renderToStaticMarkup(<SubAgentCard threadId="sthr_a" multiAgent={multiAgent(pair)} />);
		const second = renderToStaticMarkup(<SubAgentCard threadId="sthr_b" multiAgent={multiAgent(pair)} />);
		expect(first).not.toContain("子 Agent 1");
		expect(second).not.toContain("子 Agent 2");
	});

	it("失败状态标红提示，不显示耗时", () => {
		const failed = renderToStaticMarkup(
			<SubAgentCard threadId="sthr_a" multiAgent={multiAgent([thread({ status: "failed" })])} />,
		);
		expect(failed).toContain("执行出错");
		expect(failed).not.toContain("已完成");
	});

	it("卡头展示任务摘要，展开体带主 Agent 指令，加载失败给出行内重试", () => {
		const task = renderToStaticMarkup(
			<SubAgentCard threadId="sthr_a" multiAgent={multiAgent([thread({ task: "调研协作要点" })])} />,
		);
		expect(task).toContain("· 调研协作要点");
		expect(task).toContain("主 Agent 指令：");
		const failed = renderToStaticMarkup(
			<SubAgentCard threadId="sthr_a" multiAgent={multiAgent([thread({ error: "网络中断" })])} />,
		);
		expect(failed).toContain("消息加载失败：网络中断");
		expect(failed).toContain("重试");
	});

	it("展开体渲染子线程时间线：思考、工具、正文", () => {
		const html = renderToStaticMarkup(
			<SubAgentCard threadId="sthr_a" multiAgent={multiAgent([thread({ messages: childMessages })])} />,
		);
		const positions = ["已思考", "读取文件", "data.csv", "研究结论"].map((text) => html.indexOf(text));
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});

	it("正文按 Markdown 渲染", () => {
		const html = renderToStaticMarkup(
			<SubAgentCard threadId="sthr_a" multiAgent={multiAgent([thread({ messages: childMessages })])} />,
		);
		expect(html).toMatch(/<strong[^>]*>研究结论<\/strong>/);
		expect(html).not.toContain("**研究结论**");
	});

	it("产物行有回调时可下载，无回调时不可下载", () => {
		const artifactMessages: ChatMessage[] = [
			{
				id: "c2",
				role: "assistant",
				status: "done",
				parts: [
					{
						type: "artifact",
						artifact: { file_id: "file_1", filename: "report.csv", content_type: "text/csv", size: 128 },
					},
				],
			},
		];
		const withDownload = renderToStaticMarkup(
			<SubAgentCard
				threadId="sthr_a"
				multiAgent={multiAgent([thread({ messages: artifactMessages })])}
				onArtifactDownload={() => undefined}
			/>,
		);
		expect(withDownload).toContain('aria-label="下载 report.csv"');
		const without = renderToStaticMarkup(
			<SubAgentCard threadId="sthr_a" multiAgent={multiAgent([thread({ messages: artifactMessages })])} />,
		);
		expect(without).not.toContain('aria-label="下载 report.csv"');
	});

	it("未接 multiAgent 或线程缺失时不渲染", () => {
		expect(renderToStaticMarkup(<SubAgentCard threadId="sthr_a" />)).toBe("");
		expect(renderToStaticMarkup(<SubAgentCard threadId="sthr_missing" multiAgent={multiAgent([thread()])} />)).toBe("");
	});

	it("后端未提供历史查询时提示仅显示本次连接消息", () => {
		const html = renderToStaticMarkup(
			<SubAgentCard threadId="sthr_a" multiAgent={multiAgent([thread({ historyAvailable: false })])} />,
		);
		expect(html).toContain("仅显示本次连接收到的消息");
	});
});
