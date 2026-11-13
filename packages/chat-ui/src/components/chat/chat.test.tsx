import type { ChatMultiAgent } from "@openagentpack/kit-sdk/chat";
import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Chat } from "./index.tsx";

const multiAgent = (changes: Partial<ChatMultiAgent> = {}): ChatMultiAgent => ({
	selectedThreadId: "sthr_research",
	threads: [
		{
			id: "sthr_research",
			name: "资料研究员",
			task: "调研协作要点",
			status: "running",
			messages: [
				{ id: "reply", role: "assistant", status: "done", parts: [{ id: "body", type: "text", text: "研究结论" }] },
			],
			loading: false,
			loaded: true,
			error: null,
			nextPageToken: "older",
			historyAvailable: true,
		},
	],
	loading: false,
	error: null,
	selectThread: () => {},
	refreshThreads: async () => {},
	loadThreadEvents: async () => {},
	...changes,
});

const cardMessage: ChatMessage = {
	id: "m1",
	role: "assistant",
	status: "done",
	parts: [{ id: "card", type: "sub-agent", threadId: "sthr_research" }],
};

describe("Chat 原生多 Agent", () => {
	// 子 Agent 以流内嵌卡呈现：卡头状态与任务来自 multiAgent 快照，主输入与审批保持挂载。
	it("sub-agent 分片渲染内嵌卡，主输入与审批保持挂载", () => {
		const html = renderToStaticMarkup(
			<Chat
				messages={[cardMessage]}
				multiAgent={multiAgent()}
				turnRunning
				onStop={() => {}}
				approvals={<p>待审批工具</p>}
				sender={<textarea defaultValue="主 Agent 草稿" />}
			/>,
		);
		for (const text of ["资料研究员", "· 调研协作要点", "正在执行", "研究结论", "主 Agent 草稿", "待审批工具"])
			expect(html).toContain(text);
		expect(html).not.toContain('role="tablist"');
	});

	// 未接 multiAgent 的宿主不渲染卡，也不报错。
	it("无 multiAgent 快照时 sub-agent 分片静默跳过", () => {
		const html = renderToStaticMarkup(<Chat messages={[cardMessage]} />);
		expect(html).not.toContain("资料研究员");
		expect(html).toContain('aria-label="消息输入"');
	});
});

// 默认输入框由 Chat 组合 Suggestion + Sender：skills 提供时可从 "/" 唤起候选，
// 输入框仍保持 combobox 语义（弹层关闭时 aria-expanded=false）。
it("默认 Sender 与 Suggestion 组合，skills 提供时挂载 combobox 语义", () => {
	const html = renderToStaticMarkup(<Chat messages={[]} skills={[{ name: "research", description: "深度调研" }]} />);
	expect(html).toContain('role="combobox"');
	expect(html).toContain('aria-expanded="false"');
	expect(html).toContain('aria-label="消息输入"');
});

// 发出消息后 Agent 未返回任何内容时不能空白等待；流式恢复后列表指示与正文指示不叠加。
it("turnRunning 且无流式助手消息时显示生成中指示，流式中只保留一处", () => {
	const user: ChatMessage = {
		id: "u",
		role: "user",
		status: "done",
		parts: [{ id: "q", type: "text", text: "问" }],
	};
	const waiting = renderToStaticMarkup(<Chat messages={[user]} turnRunning />);
	expect(waiting).toContain("生成中…");
	const streaming = renderToStaticMarkup(
		<Chat
			turnRunning
			messages={[
				user,
				{ id: "a", role: "assistant", status: "streaming", parts: [{ id: "r", type: "text", text: "答" }] },
			]}
		/>,
	);
	expect(streaming.match(/生成中…/g)).toHaveLength(1);
});

// 审批卡内嵌消息流末尾；输入区只留等待提示，避免与列表首帧等待指示叠加。
it("有待审批时卡片进消息流，输入区只留等待提示且不叠加生成中指示", () => {
	const user: ChatMessage = {
		id: "u",
		role: "user",
		status: "done",
		parts: [{ id: "q", type: "text", text: "问" }],
	};
	const html = renderToStaticMarkup(<Chat messages={[user]} turnRunning approvals={<div>工具审批 write_file</div>} />);
	expect(html).toContain("工具审批 write_file");
	expect(html).toContain("等待审批");
	expect(html).not.toContain("生成中…");
});
