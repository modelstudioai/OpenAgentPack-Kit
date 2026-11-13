import { MessageList } from "@openagentpack/kit-chat-ui";
import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";

const lookupName =
	"finance_workflow__verify_monthly_expense_settlement_references_and_cross_department_approval_records";
const failedOutput = [
	"审批服务暂时不可用，请保留结算单号后重试。",
	'<script>alert("这段日志只能作为文本显示")</script>',
	"追踪编号：EXPENSE_APPROVAL_LOOKUP_20261027_CROSS_DEPARTMENT_COLLABORATION_MONTHLY_SETTLEMENT_REFERENCE_ARCHIVE_PENDING_RECONCILIATION_RETRY",
].join("\n");

/** 相同消息和分片 id 的累计更新，不接 Provider 或工具服务。 */
function ExecutionFixture() {
	const [stage, setStage] = useState(0);
	const complete = stage >= 2;
	const messages: ChatMessage[] = [
		{
			id: "expense-execution",
			role: "assistant",
			status: complete ? "done" : "streaming",
			parts: [
				{ id: "intro", type: "text", text: "我会先检查结算记录，再确认是否有遗漏的审批。" },
				{
					id: "reasoning",
					type: "reasoning",
					status: complete ? "done" : "streaming",
					text: [
						"先核对结算单号，再检查审批结果。",
						stage >= 1 ? "已确认结算单号有效，正在读取审批状态。" : "",
						complete ? "已整理可以确认的结果，失败的查询保留重试信息。" : "",
					]
						.filter(Boolean)
						.join("\n"),
				},
				{ id: "lookup-intro", type: "text", text: "先查询这笔费用是否还需要补充材料。" },
				{
					id: "lookup",
					type: "tool",
					toolId: "lookup-expense",
					name: lookupName,
					status: complete ? "done" : "running",
					input: 0,
					...(stage >= 1 ? { output: false } : {}),
				},
				{ id: "approval-intro", type: "text", text: "接着读取审批记录，查询异常会单独保留。" },
				{
					id: "approval-lookup",
					type: "tool",
					toolId: "lookup-approval",
					name: "读取审批记录",
					status: "error",
					input: null,
					output: failedOutput,
				},
				{
					id: "conclusion",
					type: "text",
					text: complete
						? `核对完成：费用无需补充材料，审批记录需要稍后重试。${stage >= 3 ? "\n\n补充说明：重试前请保留完整的追踪编号。" : ""}`
						: "已有结果会直接展示，详细查询过程可以按需展开。",
				},
			],
		},
	];
	return (
		<main className="flex min-h-full min-w-0 flex-col">
			<div className="flex flex-wrap gap-3 border-b border-[var(--kit-border)] p-4">
				<button type="button" onClick={() => setStage(1)}>
					继续流式更新
				</button>
				<button type="button" onClick={() => setStage(2)}>
					完成执行
				</button>
				<button type="button" onClick={() => setStage(3)}>
					补充结论
				</button>
			</div>
			<MessageList variant="workspace" messages={messages} autoScroll={false} />
		</main>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(<ExecutionFixture />);
