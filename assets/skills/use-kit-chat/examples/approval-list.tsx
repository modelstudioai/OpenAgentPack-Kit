import { ToolApprovalCard } from "@openagentpack/kit-chat-ui";
import type { UseChatResult } from "@openagentpack/kit-sdk/chat/hooks";

export function ApprovalList({ chat }: { chat: UseChatResult }) {
	return (
		<section aria-label="Tool approvals">
			{chat.approvals.map((approval) => (
				<ToolApprovalCard
					key={JSON.stringify([approval.batch_id, approval.call_id])}
					approval={approval}
					onDecision={chat.submitApproval}
					onRefresh={chat.refreshApprovals}
				/>
			))}
		</section>
	);
}
