import { type MessageTransformer, transformSessionEvent } from "@openagentpack/kit-sdk/messages";
import type { ChatProvider } from "@openagentpack/kit-sdk/providers";

// A display-only label replacement. Reapplying it is safe when later events
// rebuild the same thread. The original SessionEvent and lifecycle stay intact.
const replaceDisplayLabel: MessageTransformer = (input) => {
	const result = transformSessionEvent(input);
	return {
		...result,
		messages: result.messages.map((message) => ({
			...message,
			parts: message.parts.map((part) =>
				part.type === "text" ? { ...part, text: part.text.replaceAll("[[agent-name]]", "Support assistant") } : part,
			),
		})),
	};
};

// Construct this wrapper once with the backend binding, not on every render.
// Chat owns returned messages; this shared Provider stores no Session messages.
export function withDisplayLabel(provider: ChatProvider): ChatProvider {
	// Forward calls on the original instance, including class prototype methods.
	return {
		transformMessage: replaceDisplayLabel,
		stream: (sessionId, options) => provider.stream(sessionId, options),
		sendMessage: (sessionId, body) => provider.sendMessage(sessionId, body),
		interrupt: (sessionId) => provider.interrupt(sessionId),
		toolApprovals: (sessionId) => provider.toolApprovals(sessionId),
		submitToolApproval: (sessionId, decision) => provider.submitToolApproval(sessionId, decision),
	};
}
