import { Chat, Sender } from "@openagentpack/kit-chat-ui";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";
import { KitError } from "@openagentpack/kit-sdk/protocol";
import type { ChatProvider } from "@openagentpack/kit-sdk/providers";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ApprovalList } from "./approval-list.tsx";

// Both inputs are stable application-owned functions/objects.
// createSession calls the application's backend and returns its real Session ID.
export function CustomChat({
	provider,
	createSession,
}: {
	provider: ChatProvider;
	createSession: () => Promise<string>;
}) {
	const binding = useMemo(() => ({ provider, createSession }), [provider, createSession]);
	const [selection, setSelection] = useState<{ binding: typeof binding; id: string } | null>(null);
	const sessionId = selection?.binding === binding ? selection.id : null;
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const sending = useRef<object | null>(null);
	const chat = useChat({ sessionId, provider });
	const active = useRef<typeof binding | null>(binding);
	useLayoutEffect(() => {
		active.current = binding;
		sending.current = null;
		setBusy(false);
		setError(null);
		return () => {
			active.current = null;
		};
	}, [binding]);
	const report = (cause: unknown) => {
		if (active.current === binding)
			setError(cause instanceof KitError ? cause.message : "The request failed. Your draft was kept.");
	};
	const finish = (operation: object) => {
		// An old request must not unlock a newer backend's pending request.
		if (sending.current !== operation) return;
		sending.current = null;
		if (active.current === binding) setBusy(false);
	};

	async function send(text: string) {
		if (!text.trim() || sending.current || (sessionId !== null && !chat.canSend)) return;
		const operation = {};
		sending.current = operation;
		setBusy(true);
		setError(null);
		try {
			const target = sessionId ?? (await createSession());
			if (active.current !== binding) return;
			setSelection({ binding, id: target });
			// React may not have committed the new selection yet.
			await chat.send(text.trim(), { sessionId: target });
			if (active.current === binding) setDraft((current) => (current === text ? "" : current));
		} catch (cause) {
			report(cause);
		} finally {
			finish(operation);
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col" data-kit-appearance="workspace">
			{(error || chat.streamError) && <p role="alert">{error ?? chat.streamError?.message}</p>}
			<Chat
				variant="workspace"
				messages={chat.messages}
				multiAgent={chat.multiAgent}
				scrollKey={sessionId}
				turnRunning={chat.turnRunning}
				approvals={chat.approvals.length > 0 ? <ApprovalList chat={chat} /> : null}
				onStop={() => chat.stop().catch(report)}
				sender={
					<Sender
						variant="workspace"
						value={draft}
						onChange={setDraft}
						loading={chat.turnRunning}
						submitDisabled={busy || (sessionId !== null && !chat.canSend)}
						onSubmit={(text) => void send(text)}
						onCancel={() => void chat.stop().catch(report)}
						placeholder={sessionId ? "Send a message" : "Write the first message to create a session"}
					/>
				}
			/>
		</div>
	);
}
