import { MessageList } from "@openagentpack/kit-chat-ui";
import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";

const history: ChatMessage[] = [
	{
		id: "history",
		role: "user",
		status: "done",
		parts: [{ type: "text", text: Array.from({ length: 80 }, (_, index) => `历史记录第 ${index + 1} 行`).join("\n") }],
	},
	{ id: "reply", role: "assistant", status: "streaming", parts: [{ type: "text", text: "开始回答" }] },
];

/** 仅通过公开 props 注入消息，验证浏览器滚动行为，不接 Provider 或会话请求。 */
function MessageListFixture() {
	const [messages, setMessages] = useState(history);
	const [autoScroll, setAutoScroll] = useState(true);
	const messageSequence = useRef(0);
	const partSequence = useRef(0);
	const appendMessage = () => {
		const number = ++messageSequence.current;
		setMessages((current) => [
			...current,
			{
				id: `message-${number}`,
				role: "assistant",
				status: "streaming",
				parts: [{ type: "text", text: `新增消息 ${number}\n\n消息正文` }],
			},
		]);
	};
	const appendPart = () => {
		const number = ++partSequence.current;
		const text = `\n\n流式分片 ${number}\n\n${Array.from({ length: 8 }, (_, index) => `分片内容第 ${index + 1} 段`).join("\n\n")}`;
		setMessages((current) =>
			current.map((message, index) =>
				index === current.length - 1 ? { ...message, parts: [...message.parts, { type: "text", text }] } : message,
			),
		);
	};
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex flex-wrap items-center gap-2 border-b border-[var(--kit-border)] p-3">
				<button type="button" onClick={() => setMessages([])}>
					清空消息
				</button>
				<button type="button" onClick={() => setMessages(history)}>
					加载历史
				</button>
				<button type="button" onClick={appendMessage}>
					追加消息
				</button>
				<button type="button" onClick={appendPart}>
					追加分片
				</button>
				<label>
					<input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
					自动跟随
				</label>
			</div>
			<MessageList
				messages={messages}
				autoScroll={autoScroll}
				empty={
					<div className="whitespace-pre-wrap">
						<h2>欢迎开始对话</h2>
						<p>{Array.from({ length: 80 }, (_, index) => `开场说明第 ${index + 1} 行`).join("\n")}</p>
					</div>
				}
			/>
		</div>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(<MessageListFixture />);
