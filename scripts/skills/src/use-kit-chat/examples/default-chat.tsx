import { Chat, Sender } from "@openagentpack/kit-chat-ui";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";
import { KitError } from "@openagentpack/kit-sdk/protocol";
import { createKitClient, type KitClient } from "@openagentpack/kit-sdk/providers/kit";
import { KitProvider } from "@openagentpack/kit-sdk/providers/kit/react";
import { useRef, useState } from "react";
import { ApprovalList } from "./approval-list.tsx";

// Initialize once. apiBaseUrl comes from runtime configuration, not location.origin.
// getAppToken supplies application identity, never a Bailian API key.
export function createDefaultClient(apiBaseUrl: string, getAppToken: () => Promise<string>) {
	return createKitClient({
		baseUrl: apiBaseUrl,
		headers: async () => ({ Authorization: `Bearer ${await getAppToken()}` }),
	});
}

export function DefaultChat({ client, sessionId }: { client: KitClient; sessionId: string | null }) {
	return (
		<KitProvider client={client}>
			<ChatPanel key={sessionId ?? "unselected"} sessionId={sessionId} />
		</KitProvider>
	);
}

function ChatPanel({ sessionId }: { sessionId: string | null }) {
	const chat = useChat(sessionId);
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);
	const sending = useRef(false);
	const report = (cause: unknown) => setError(cause instanceof KitError ? cause.message : "The request failed.");

	async function send(text: string) {
		if (!text.trim() || !chat.canSend || sending.current) return;
		sending.current = true;
		setError(null);
		try {
			await chat.send(text.trim());
			setDraft((current) => (current === text ? "" : current));
		} catch (cause) {
			report(cause);
		} finally {
			sending.current = false;
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col" data-kit-appearance="workspace">
			<p role="status">{`${chat.connection} / ${chat.phase}`}</p>
			{(error || chat.streamError) && <p role="alert">{error ?? chat.streamError?.message}</p>}
			<Chat
				variant="workspace"
				messages={chat.messages}
				multiAgent={chat.multiAgent}
				scrollKey={sessionId}
				turnRunning={chat.turnRunning}
				canSend={chat.canSend}
				onStop={() => chat.stop().catch(report)}
				approvals={chat.approvals.length > 0 ? <ApprovalList chat={chat} /> : null}
				sender={
					<Sender
						variant="workspace"
						value={draft}
						onChange={setDraft}
						loading={chat.turnRunning}
						submitDisabled={!chat.canSend}
						onSubmit={(text) => void send(text)}
						onCancel={() => void chat.stop().catch(report)}
						placeholder={sessionId ? "Send a message" : "Select a session to begin"}
					/>
				}
			/>
		</div>
	);
}
