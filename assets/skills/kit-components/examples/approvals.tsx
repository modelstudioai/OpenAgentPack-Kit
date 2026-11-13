import { ToolApprovalGroup } from "@openagentpack/kit-chat-ui";
import type { ChatToolApproval } from "@openagentpack/kit-sdk/chat";
import type { ToolApprovalDecision } from "@openagentpack/kit-sdk/protocol";

export interface ApprovalListProps {
	approvals: ChatToolApproval[];
	submitApproval: (decision: ToolApprovalDecision) => Promise<void>;
	refreshApprovals: () => Promise<void>;
	stop: () => void;
}

// Pass useChat's approvals, submitApproval, refreshApprovals, and stop.
// Allow and deny are one-click submissions. Multiple pending approvals page
// horizontally, one card at a time. The backend confirms validity.
export function ApprovalList({ approvals, submitApproval, refreshApprovals, stop }: ApprovalListProps) {
	if (approvals.length === 0) return null;
	return (
		<ToolApprovalGroup approvals={approvals} onDecision={submitApproval} onRefresh={refreshApprovals} onStop={stop} />
	);
}
