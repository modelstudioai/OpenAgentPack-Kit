import { Chat } from "@openagentpack/kit-chat-ui";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";
import type { ChatProvider } from "@openagentpack/kit-sdk/providers";
import {
	type BailianChatProviderOptions,
	createBailianChatProvider,
	createBailianThreadOperations,
} from "@openagentpack/kit-sdk/providers/bailian";
import { useState } from "react";

// Normalized backends implement these two optional operations using public DTOs.
// Event pages must be oldest-to-newest; next_page_token points to older history.
export function withNormalizedThreads(
	provider: ChatProvider,
	queries: Required<Pick<ChatProvider, "listThreads" | "listThreadEvents">>,
): ChatProvider {
	return { ...provider, ...queries };
}

// The backend proxies the two standard Bailian REST paths and { data, next_page }.
// Application authentication stays in options.request; provider secrets stay server-side.
export function withBailianThreads(options: BailianChatProviderOptions) {
	return createBailianChatProvider({
		...options,
		...createBailianThreadOperations({ basePath: "/api/v1/agentstudio" }),
	});
}

// Both Provider variants use the same native Chat, without KitProvider or Kit Server.
// Supply one stable provider instance; errors from writes remain visible to the caller.
export function MultiAgentChat({ sessionId, provider }: { sessionId: string; provider: ChatProvider }) {
	const chat = useChat({ sessionId, provider });
	const [error, setError] = useState<string | null>(null);
	return (
		<>
			{(error || chat.streamError) && <p role="alert">{error ?? chat.streamError?.message}</p>}
			<Chat
				messages={chat.messages}
				multiAgent={chat.multiAgent}
				scrollKey={sessionId}
				turnRunning={chat.turnRunning}
				canSend={chat.canSend}
				onSend={async (text) => {
					setError(null);
					try {
						await chat.send(text);
					} catch (cause) {
						setError(cause instanceof Error ? cause.message : "Sending failed. Your draft was kept.");
						throw cause;
					}
				}}
				onStop={chat.stop}
			/>
		</>
	);
}
