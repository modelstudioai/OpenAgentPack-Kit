import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageList } from "../message-list/index.tsx";
import { deriveAnchorTurns, MessageAnchorRail } from "./index.tsx";

const userMessage = (id: string, parts: ChatMessage["parts"]): ChatMessage => ({
	id,
	role: "user",
	status: "done",
	parts,
});

describe("回合推导", () => {
	it("每条用户消息一个回合：标签取文本分片，折叠空白并截断，跳过助手消息", () => {
		const messages: ChatMessage[] = [
			userMessage("u1", [{ type: "text", text: "帮我把这份  季度报告\n的要点总结一下" }]),
			{ id: "a1", role: "assistant", status: "done", parts: [{ type: "text", text: "好的" }] },
			userMessage("u2", [{ type: "text", text: "长".repeat(61) }]),
		];
		const turns = deriveAnchorTurns(messages);
		expect(turns.map((turn) => turn.messageIndex)).toEqual([0, 2]);
		expect(turns[0]?.label).toBe("帮我把这份 季度报告 的要点总结一下");
		expect(turns[1]?.label).toBe(`${"长".repeat(60)}…`);
	});

	it("无文本分片的回合回退为附件消息或新回合", () => {
		const turns = deriveAnchorTurns([
			userMessage("u1", [{ type: "artifact", artifact: { file_id: "f1" } }]),
			userMessage("u2", []),
		]);
		expect(turns.map((turn) => turn.label)).toEqual(["附件消息", "新回合"]);
	});

	// 悬停 tooltip 显示「标题 + 内容摘要」：摘要是回合内助手回复的开头文本，不是重复标题。
	it("摘要取回合内助手回复开头文本，无正文回退为工具执行次数，无内容则缺省", () => {
		const messages: ChatMessage[] = [
			userMessage("u1", [{ type: "text", text: "第一问" }]),
			{
				id: "a1",
				role: "assistant",
				status: "done",
				parts: [{ type: "text", text: "前".repeat(85) }],
			},
			userMessage("u2", [{ type: "text", text: "第二问" }]),
			{
				id: "a2",
				role: "assistant",
				status: "done",
				parts: [
					{ type: "tool", toolId: "t1", name: "search", status: "done" },
					{ type: "tool", toolId: "t2", name: "search", status: "done" },
				],
			},
			userMessage("u3", [{ type: "text", text: "第三问" }]),
		];
		const turns = deriveAnchorTurns(messages);
		expect(turns[0]?.summary).toBe(`${"前".repeat(80)}…`);
		expect(turns[1]?.summary).toBe("执行工具 2 次");
		expect(turns[2]?.summary).toBeUndefined();
	});
});

describe("会话锚点栏", () => {
	// 保护 Qoder 形态合同：等距刻度、当前回合常亮、点击经 onSelect 交还调用方。
	it("按回合渲染刻度并标记当前回合，不足两个回合不渲染", () => {
		const items = [{ label: "总结要点" }, { label: "翻译结论" }, { label: "生成摘要" }];
		const html = renderToStaticMarkup(<MessageAnchorRail items={items} activeIndex={1} />);
		expect(html).toContain('aria-label="会话锚点"');
		expect(html).toContain('aria-label="第 1 回合：总结要点"');
		expect(html).toContain('aria-label="第 3 回合：生成摘要"');
		expect(html).toContain('aria-current="true"');
		expect(html).not.toContain('aria-current="false"');
		expect(renderToStaticMarkup(<MessageAnchorRail items={items.slice(0, 1)} activeIndex={0} />)).toBe("");
	});

	it("MessageList 开启 anchorRail 时渲染锚点栏并按消息下标定位回合，默认关闭", () => {
		const messages: ChatMessage[] = [
			userMessage("u1", [{ type: "text", text: "第一问" }]),
			{ id: "a1", role: "assistant", status: "done", parts: [{ type: "text", text: "回答" }] },
			userMessage("u2", [{ type: "text", text: "第二问" }]),
		];
		const enabled = renderToStaticMarkup(<MessageList messages={messages} anchorRail />);
		expect(enabled).toContain('aria-label="会话锚点"');
		expect(enabled).toContain('aria-label="第 1 回合：第一问"');
		expect(enabled).toContain('aria-label="第 2 回合：第二问"');
		expect(renderToStaticMarkup(<MessageList messages={messages} />)).not.toContain("会话锚点");
	});
});
