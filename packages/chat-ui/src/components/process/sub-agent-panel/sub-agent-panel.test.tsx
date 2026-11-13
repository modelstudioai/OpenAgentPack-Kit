import type { ChatMultiAgent } from "@openagentpack/kit-sdk/chat";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubAgentPanel } from "./index.tsx";

type Thread = ChatMultiAgent["threads"][number];

function thread(overrides: Partial<Thread> = {}): Thread {
	return {
		id: "sthr_a",
		name: "research",
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

describe("右栏子 Agent 分区", () => {
	it("按展示名去重并给出派发次数，组内最新派发在前", () => {
		const html = renderToStaticMarkup(
			<SubAgentPanel
				multiAgent={multiAgent([
					thread({
						id: "sthr_1",
						name: "research",
						task: "调研基准变化",
						createdAt: "2026-11-01T00:00:00Z",
						endedAt: "2026-11-01T00:01:42Z",
					}),
					thread({ id: "sthr_2", name: "slide-maker", task: "生成初稿" }),
					thread({
						id: "sthr_0",
						name: "research",
						task: "补充价格对比",
						createdAt: "2026-11-02T00:00:00Z",
						endedAt: "2026-11-02T00:00:48Z",
					}),
				])}
			/>,
		);
		expect(html).toContain("子 Agent");
		expect(html).toContain("· 2");
		expect(html).toContain("research");
		expect(html).toContain("slide-maker");
		expect(html).toContain("2 次");
		expect(html).toContain("1 次");
		expect(html.indexOf("补充价格对比")).toBeLessThan(html.indexOf("调研基准变化"));
		expect(html).toContain("48s");
	});

	it("运行中、失败与缺任务行有对应标记", () => {
		const html = renderToStaticMarkup(
			<SubAgentPanel
				multiAgent={multiAgent([
					thread({ id: "sthr_r", status: "running", task: "生成初稿" }),
					thread({ id: "sthr_f", status: "failed", task: "检索失败" }),
					thread({ id: "sthr_n", task: undefined }),
				])}
			/>,
		);
		expect(html).toContain("执行中");
		expect(html).toContain("出错");
		expect(html).toContain("未记录任务");
	});

	it("无 multiAgent 或无线程时不渲染", () => {
		expect(renderToStaticMarkup(<SubAgentPanel />)).toBe("");
		expect(renderToStaticMarkup(<SubAgentPanel multiAgent={multiAgent([])} />)).toBe("");
	});
});
