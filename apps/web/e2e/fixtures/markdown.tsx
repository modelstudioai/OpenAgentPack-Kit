import { MessageList } from "@openagentpack/kit-chat-ui";
import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";

const initial: ChatMessage[] = [
	{
		id: "diagram-answer",
		role: "assistant",
		status: new URLSearchParams(window.location.search).has("streaming") ? "streaming" : "done",
		parts: [{ id: "diagram-text", type: "text", text: "```mermaid\nflowchart LR\nA-->B\n```" }],
	},
];

/** 通过公开消息 props 模拟其他消息和同一快照的正文增长，不调用 Provider。 */
function MarkdownFixture() {
	const [messages, setMessages] = useState(initial);
	const sequence = useRef(0);
	const appendMessage = () => {
		const number = ++sequence.current;
		setMessages((current) => [
			...current,
			{
				id: `other-${number}`,
				role: "user",
				status: "done",
				parts: [{ id: `other-text-${number}`, type: "text", text: `其他消息 ${number}` }],
			},
		]);
	};
	const appendText = () => {
		const number = ++sequence.current;
		setMessages((current) =>
			current.map((message) =>
				message.id === "diagram-answer"
					? {
							...message,
							parts: message.parts.map((part) =>
								part.type === "text" ? { ...part, text: `${part.text}\n\n后续正文 ${number}` } : part,
							),
						}
					: message,
			),
		);
	};
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex flex-wrap items-center gap-2 border-b border-[var(--kit-border)] p-3">
				<button type="button" onClick={appendMessage}>
					追加其他消息
				</button>
				<button type="button" onClick={appendText}>
					继续流式正文
				</button>
			</div>
			<MessageList messages={messages} />
		</div>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(<MarkdownFixture />);
