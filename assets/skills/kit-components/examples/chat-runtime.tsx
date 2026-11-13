import { Chat, type SenderSkill, ToolApprovalCard } from "@openagentpack/kit-chat-ui";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";
import { useState } from "react";

// Render below a configured KitProvider, inside a bounded Layout content area.
// The same component works with useChat({ sessionId, provider }) for a custom backend.
export function SessionChat({ sessionId, skills }: { sessionId: string | null; skills?: SenderSkill[] }) {
	const chat = useChat(sessionId);
	const [error, setError] = useState<string | null>(null);
	const report = (cause: unknown) => setError(cause instanceof Error ? cause.message : "The request failed.");

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-kit-appearance="workspace">
			{error || chat.streamError ? <p role="alert">{error ?? chat.streamError?.message}</p> : null}
			<Chat
				variant="workspace"
				messages={chat.messages}
				skills={skills}
				multiAgent={chat.multiAgent}
				scrollKey={sessionId}
				turnRunning={chat.turnRunning}
				canSend={chat.canSend}
				onSend={async (text, selectedSkills) => {
					setError(null);
					try {
						await chat.send(text, { skills: selectedSkills });
					} catch (cause) {
						report(cause);
						throw cause; // Preserve Chat's draft when sending fails.
					}
				}}
				onStop={() => chat.stop().catch(report)}
				approvals={
					chat.approvals.length > 0
						? chat.approvals.map((approval) => (
								<ToolApprovalCard
									key={JSON.stringify([approval.batch_id, approval.call_id])}
									approval={approval}
									onDecision={chat.submitApproval}
									onRefresh={chat.refreshApprovals}
									onStop={() => void chat.stop().catch(report)}
								/>
							))
						: null
				}
			/>
		</div>
	);
}
