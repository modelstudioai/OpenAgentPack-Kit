import { Chat, ToolApprovalCard } from "@openagentpack/kit-chat-ui";
import type { ChatToolApproval } from "@openagentpack/kit-sdk/chat";
import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";

const messages: ChatMessage[] = [
	{
		id: "expense-question",
		role: "user",
		status: "done",
		parts: [
			{
				id: "expense-question-text",
				type: "text",
				text: "请帮我核对十月份跨部门协作项目的报销情况，按部门、负责人、项目编号和费用类别整理审批进度。还需要列出提交日期、审批日期、预计到账日期、预算和实际金额，方便财务同学确认差额。\n\n请保留每笔费用的完整结算单号，并给出一段可以导出核对结果的代码；如果需要生成归档文件，先让我确认文件内容。",
			},
		],
	},
	{
		id: "expense-answer",
		role: "assistant",
		status: "done",
		parts: [
			{
				id: "expense-tool",
				type: "tool",
				toolId: "expense-reconcile",
				name: "finance_reporting_service__reconcile_monthly_expense_ledgers_and_verify_cross_department_purchase_order_references",
				status: "done",
				output:
					"核对完成，结果编号：FINANCE_RECONCILIATION_20261027_CROSS_DEPARTMENT_COLLABORATION_PROJECT_MONTHLY_EXPENSE_PURCHASE_ORDER_APPROVAL_AND_SETTLEMENT_REFERENCE_ARCHIVE_READY_FOR_REVIEW",
			},
			{
				id: "expense-summary",
				type: "text",
				text: `已完成核对，以下列出各部门的结算信息。表格较宽，可以横向查看最后一列的处理建议。

| 部门 | 负责人 | 项目编号 | 提交日期 | 审批日期 | 预计到账日期 | 费用类别 | 项目预算 | 实际金额 | 币种 | 结算单号 | 处理建议 |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- |
| 产品研发部 | 李明 | COLLAB-2026-1031 | 2026-10-21 | 2026-10-23 | 2026-10-29 | 跨部门项目差旅 | 28,000.00 | 24,680.00 | 人民币 | SETTLEMENT-202610-000128 | 可按期结算 |
| 客户服务部 | 王敏 | COLLAB-2026-1042 | 2026-10-22 | 2026-10-24 | 2026-10-30 | 客户现场培训 | 16,000.00 | 15,420.00 | 人民币 | SETTLEMENT-202610-000129 | 补齐发票后结算 |

导出时请保留原始结算编号：

\`\`\`javascript
const reconciliation = { reportName: "十月份跨部门费用核对", settlementReference: "FINANCE_RECONCILIATION_20261027_CROSS_DEPARTMENT_COLLABORATION_PROJECT_MONTHLY_EXPENSE_PURCHASE_ORDER_APPROVAL_AND_SETTLEMENT_REFERENCE_ARCHIVE_READY_FOR_REVIEW" };
console.log(JSON.stringify(reconciliation, null, 2));
\`\`\`

归档前请确认待审批的导出操作。`,
			},
		],
	},
];

const approval: ChatToolApproval = {
	batch_id: "expense-export-batch",
	call_id: "expense-export-call",
	request_event_id: "expense-export-request",
	name: "导出核对报告",
	arguments: { filename: "十月份费用核对.md" },
	tool_type: "文件写入",
	actionable: true,
	status: "pending",
};

/** 只通过公开组件注入阅读内容，不加载 Provider、外部图片或工具请求。 */
createRoot(document.getElementById("root") as HTMLElement).render(
	<div className="flex h-full min-h-0 min-w-0 flex-col">
		<Chat
			variant="workspace"
			messages={messages}
			approvals={
				<ToolApprovalCard approval={approval} onDecision={async () => undefined} onRefresh={async () => undefined} />
			}
		/>
	</div>,
);
