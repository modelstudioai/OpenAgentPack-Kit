import { ToolApprovalCard } from "@openagentpack/kit-chat-ui";
import type { ChatToolApproval } from "@openagentpack/kit-sdk/chat";
import type { ToolApprovalDecision } from "@openagentpack/kit-sdk/protocol";

export interface ApprovalCardProps {
	approval: ChatToolApproval;
	submitApproval: (decision: ToolApprovalDecision) => Promise<void>;
	refreshApprovals: () => Promise<void>;
	stop: () => void;
}

// Single pending approval rendered directly. Allow and deny are one-click
// submissions; no confirmation dialog. Prefer ToolApprovalGroup when multiple approvals exist.
export function ApprovalCard({ approval, submitApproval, refreshApprovals, stop }: ApprovalCardProps) {
	return (
		<ToolApprovalCard approval={approval} onDecision={submitApproval} onRefresh={refreshApprovals} onStop={stop} />
	);
}
