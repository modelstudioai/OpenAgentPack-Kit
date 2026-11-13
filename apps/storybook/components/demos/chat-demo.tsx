"use client";

import { Chat, EmptyState, Prompts } from "@openagentpack/kit-chat-ui";
import type { ChatMessage, MessagePart } from "@openagentpack/kit-sdk/messages";
import { composeSkillDirective } from "@openagentpack/kit-sdk/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEMO_SKILLS } from "./demo-skills.ts";

/**
 * Chat 的离线预览：没有 server，由本地脚本按 turn 语义推流。
 * 目的是让人看到真实组件在流式过程中的中间态（思考默认收起且可手动展开、工具卡 running→done、
 * artifact 卡、Sender 的停止按钮），这些静态截图讲不清楚。
 */
let seq = 0;
function nextId(): string {
	seq += 1;
	return `demo_${seq}`;
}

const CHUNKS = [
	"这是**离线预览**：没有 server，",
	"由本地脚本按 turn 语义推流，",
	"覆盖 reasoning、工具卡与 artifact。",
];

export function ChatDemo() {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [turnRunning, setTurnRunning] = useState(false);
	const [note, setNote] = useState<string | null>(null);
	const timers = useRef<number[]>([]);
	const activeTurn = useRef<string | null>(null);

	useEffect(
		() => () => {
			for (const timer of timers.current) clearTimeout(timer);
		},
		[],
	);

	const onSend = useCallback((text: string, skills?: string[]) => {
		if (activeTurn.current || !text.trim()) return;
		setNote(null);
		const userId = nextId();
		const botId = nextId();
		activeTurn.current = botId;
		const createdAt = new Date().toISOString();
		setMessages((prev) => [
			...prev,
			{
				id: userId,
				role: "user",
				createdAt,
				parts: [{ id: `${userId}:text`, type: "text", text: composeSkillDirective(text, skills ?? []) }],
				status: "done",
			},
			{
				id: botId,
				role: "assistant",
				createdAt,
				parts: [{ id: `${botId}:reasoning`, type: "reasoning", text: "先确认问题的目标。", status: "streaming" }],
				status: "streaming",
			},
		]);
		setTurnRunning(true);

		const patch = (id: string, fn: (parts: MessagePart[]) => MessagePart[]) =>
			setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, parts: fn(m.parts) } : m)));
		const schedule = (at: number, run: () => void) => {
			timers.current.push(
				window.setTimeout(() => {
					if (activeTurn.current === botId) run();
				}, at),
			);
		};

		schedule(900, () =>
			patch(botId, (parts) =>
				parts.map((part) =>
					part.type === "reasoning" ? { ...part, text: `${part.text}\n再整理需要的资料，准备本地演示结果。` } : part,
				),
			),
		);
		schedule(2400, () =>
			patch(botId, (parts) => parts.map((part) => (part.type === "reasoning" ? { ...part, status: "done" } : part))),
		);
		let at = 2700;
		for (const chunk of CHUNKS) {
			schedule(at, () =>
				patch(botId, (parts) =>
					parts.some((part) => part.id === `${botId}:text`)
						? parts.map((part) => (part.type === "text" ? { ...part, text: part.text + chunk } : part))
						: [...parts, { id: `${botId}:text`, type: "text", text: chunk }],
				),
			);
			at += 450;
		}
		schedule(at, () =>
			patch(botId, (p) => [
				...p,
				{
					id: `${botId}:tool`,
					type: "tool",
					toolId: `${botId}:search`,
					name: "web_search",
					status: "running",
					input: '{"query":"kit chat-ui"}',
				},
			]),
		);
		at += 900;
		schedule(at, () =>
			patch(botId, (p) =>
				p.map((part) => (part.type === "tool" ? { ...part, status: "done", output: "命中 3 条结果" } : part)),
			),
		);
		at += 400;
		schedule(at, () =>
			patch(botId, (p) => [
				...p,
				{
					id: `${botId}:artifact`,
					type: "artifact",
					artifact: {
						file_id: "file_demo_report",
						filename: "kit-preview-report.md",
						content_type: "text/markdown",
						size: 2048,
					},
				},
			]),
		);
		at += 500;
		schedule(at, () => {
			setMessages((prev) => prev.map((m) => (m.id === botId ? { ...m, status: "done" } : m)));
			setTurnRunning(false);
			activeTurn.current = null;
			timers.current = [];
		});
	}, []);

	const onStop = useCallback(() => {
		for (const timer of timers.current) clearTimeout(timer);
		timers.current = [];
		activeTurn.current = null;
		setMessages((prev) =>
			prev.map((message) =>
				message.status === "streaming"
					? {
							...message,
							status: "interrupted",
							parts: message.parts.map((part) => {
								if (part.type === "reasoning" && part.status === "streaming") return { ...part, status: "interrupted" };
								if (part.type === "tool" && part.status === "running")
									return { ...part, status: "error", output: "执行已停止（本地演示）" };
								return part;
							}),
						}
					: message,
			),
		);
		setTurnRunning(false);
		setNote("已中断（本地脚本停止推流）");
	}, []);

	return (
		<div data-kit-appearance="workspace" className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--kit-bg)]">
			{note ? (
				<p role="status" className="px-4 pt-2 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
					{note}
				</p>
			) : null}
			<Chat
				variant="workspace"
				messages={messages}
				skills={DEMO_SKILLS}
				turnRunning={turnRunning}
				onSend={onSend}
				onStop={onStop}
				onArtifactOpen={(fileId) => setNote(`触发预览：${fileId}（本地演示）`)}
				onArtifactDownload={(fileId) => setNote(`触发下载：${fileId}（预览里不真下载）`)}
				empty={
					<div className="flex flex-1 flex-col items-center justify-center gap-5 p-6">
						<EmptyState title="和「客服助手」聊聊" hint="选择下面任一示例，或直接输入你的问题" />
						<Prompts
							wrap
							items={["查一下我的订单", "帮我改收货地址", "怎么开发票？"].map((prompt) => ({
								key: prompt,
								label: prompt,
							}))}
							onItemClick={({ data }) => onSend(data.key)}
							classNames={{ list: "justify-center" }}
						/>
					</div>
				}
			/>
		</div>
	);
}
