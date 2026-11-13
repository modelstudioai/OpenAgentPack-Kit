import type { ChatToolApproval } from "@openagentpack/kit-sdk/chat";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolApprovalCard, ToolApprovalGroup } from "../tool-approval/index.ts";

const request: ChatToolApproval = {
	batch_id: "batch",
	call_id: "call",
	request_event_id: "request",
	name: "write_file",
	arguments: { text: "<script>unsafe</script>" },
	tool_type: "builtin",
	actionable: true,
	status: "pending",
};
const callbacks = { onDecision: async () => undefined, onRefresh: async () => undefined, onStop: () => undefined };

describe("工具审批展示", () => {
	// 保护不能审批的状态：未知合同、提交中、已提交不能提供决定入口或恢复操作。
	it.each(["submitting", "submitted"] as const)("%s 只显示状态，不提供任何操作", (status) => {
		const html = renderToStaticMarkup(<ToolApprovalCard approval={{ ...request, status }} {...callbacks} />);
		expect(html).not.toMatch(/>允许<|>拒绝</);
		expect(html).not.toContain("刷新审批状态");
	});
	// 结果不明与过期必须保留刷新恢复；连接恢复不自动重发，刷新是唯一入口。
	it.each(["uncertain", "stale"] as const)("%s 保留刷新恢复，不提供批准", (status) => {
		const html = renderToStaticMarkup(<ToolApprovalCard approval={{ ...request, status }} {...callbacks} />);
		expect(html).toContain("刷新审批状态");
		expect(html).not.toMatch(/>允许<|>拒绝</);
	});
	it("待审批露出参数摘要并直接提供允许入口，完整参数默认收起且保持安全文本", () => {
		const html = renderToStaticMarkup(<ToolApprovalCard approval={request} {...callbacks} />);
		expect(html).toContain("Agent 请求执行工具 write_file");
		expect(html).toContain(">builtin</span>");
		expect(html).not.toContain("builtin ·");
		expect(html).toContain("查看参数");
		expect(html).toContain(">允许</button>");
		expect(html).toContain(">拒绝</button>");
		expect(html).toContain("text: &lt;script&gt;unsafe&lt;/script&gt;");
		expect(html).not.toMatch(/<details[^>]*open/);
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("刷新审批状态");
	});
	it("不可操作的请求只读：无决定入口、提供停止执行", () => {
		const readonly = renderToStaticMarkup(
			<ToolApprovalCard approval={{ ...request, actionable: false }} {...callbacks} />,
		);
		expect(readonly).not.toMatch(/>允许<|>拒绝</);
		expect(readonly).toContain("停止执行");
	});
});

describe("多审批横向切换", () => {
	// 多个待审批一次只显示一张卡，翻页切换而不是纵向铺平。
	it("多请求只渲染当前卡并显示页码", () => {
		const html = renderToStaticMarkup(
			<ToolApprovalGroup approvals={[request, { ...request, call_id: "call2" }]} {...callbacks} />,
		);
		expect(html).toContain("1 / 2");
		expect(html.match(/Agent 请求执行工具/g)).toHaveLength(1);
		expect(html).toContain('aria-label="下一个审批"');
	});
	it("单请求不显示翻页", () => {
		const html = renderToStaticMarkup(<ToolApprovalGroup approvals={[request]} {...callbacks} />);
		expect(html).not.toMatch(/\d+ \/ \d+/);
		expect(html).toContain(">允许</button>");
	});
});
