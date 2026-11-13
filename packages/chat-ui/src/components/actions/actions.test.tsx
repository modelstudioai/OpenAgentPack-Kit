import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageList } from "../message-list/index.tsx";
import { Actions } from "./index.tsx";

describe("反馈操作", () => {
	// 未完成的回答不能被误当成完整结果；操作栏只对已完成且含正文的消息开放。
	// 用户消息为悬停显隐的图标复制（视觉由 class 承担），助手消息为常驻文字复制。
	it("助手完成后常驻复制，用户完成消息也有悬停操作行，流式和空正文不显示", () => {
		const messages: ChatMessage[] = [
			{ id: "user", role: "user", status: "done", parts: [{ type: "text", text: "问题" }] },
			{ id: "streaming", role: "assistant", status: "streaming", parts: [{ type: "text", text: "正在生成" }] },
			{ id: "failed", role: "assistant", status: "failed", parts: [{ type: "text", text: "生成失败" }] },
			{ id: "empty", role: "assistant", status: "done", parts: [{ type: "reasoning", text: "思考" }] },
			{ id: "done", role: "assistant", status: "done", parts: [{ type: "text", text: "完成的回答" }] },
		];
		const html = renderToStaticMarkup(<MessageList messages={messages} />);
		expect(html.match(/aria-label="消息操作"/g)).toHaveLength(2);
		expect(html.match(/aria-label="复制"/g)).toHaveLength(2);
		expect(html).toContain("⧉</span></button>");
	});

	// 无内容或禁用时拒绝操作；选择状态可被辅助技术读取，不把赞和踩同时标成选中。
	it("复制和反馈暴露禁用与互斥选择状态", () => {
		expect(renderToStaticMarkup(<Actions.Copy text="" />)).toMatch(/<button[^>]*disabled=""/);
		const html = renderToStaticMarkup(<Actions.Feedback value="like" onChange={() => {}} disabled />);
		expect(html).toMatch(/aria-label="点赞" aria-pressed="true" disabled=""/);
		expect(html).toMatch(/aria-label="点踩" aria-pressed="false" disabled=""/);
	});

	// 悬停时间跟在复制按钮后（助手在气泡内操作行、用户在气泡下方悬停行；视觉淡入由 class 承担）；
	// 缺失或不合法的 createdAt 不渲染时间。
	it("完成的消息带悬停时间，缺失或不合法的 createdAt 不渲染", () => {
		const messages: ChatMessage[] = [
			{
				id: "dated",
				role: "assistant",
				status: "done",
				parts: [{ type: "text", text: "回答" }],
				createdAt: "2026-11-09T06:30:00Z",
			},
			{
				id: "invalid",
				role: "assistant",
				status: "done",
				parts: [{ type: "text", text: "回答" }],
				createdAt: "not-a-date",
			},
			{ id: "missing", role: "assistant", status: "done", parts: [{ type: "text", text: "回答" }] },
			{
				id: "user-dated",
				role: "user",
				status: "done",
				parts: [{ type: "text", text: "问题" }],
				createdAt: "2026-11-09T06:30:00Z",
			},
		];
		const html = renderToStaticMarkup(<MessageList messages={messages} />);
		expect(html.match(/<time /g)).toHaveLength(2);
	});

	// 附属操作是独立按钮；禁用的分组不能通过展开入口泄漏可用操作。
	it("子操作与自定义槽可组合，禁用分组不提供展开入口", () => {
		const html = renderToStaticMarkup(
			<Actions
				items={[
					{ key: "more", label: "更多", subItems: [{ key: "save", label: "保存" }] },
					{ key: "locked", label: "未开放", disabled: true, subItems: [{ key: "hidden", label: "隐藏操作" }] },
				]}
			>
				<Actions.Copy text="回答" />
			</Actions>,
		);
		expect(html).toContain("<summary");
		expect(html).toContain("保存</button>");
		expect(html).not.toContain("隐藏操作");
		expect(html).toContain('aria-label="复制"');
	});
});
