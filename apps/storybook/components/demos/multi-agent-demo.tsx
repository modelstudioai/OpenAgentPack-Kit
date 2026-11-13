"use client";

import { Chat } from "@openagentpack/kit-chat-ui";
import type { ChatAgentThread, ChatMultiAgent } from "@openagentpack/kit-sdk/chat";
import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import { useCallback, useEffect, useRef, useState } from "react";

const RESEARCH = "sthr_demo_research";
const REVIEW = "sthr_demo_review";
const controlClass =
	"rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] px-3 py-2 text-[length:var(--kit-text-label)] hover:bg-[var(--kit-bg-subtle)] focus-visible:outline-2 focus-visible:outline-[var(--kit-focus)] disabled:cursor-not-allowed disabled:opacity-50";

function message(
	id: string,
	text: string,
	options: { threadId?: string; role?: "user" | "assistant"; parts?: ChatMessage["parts"] } = {},
): ChatMessage {
	return {
		id,
		role: options.role ?? "assistant",
		status: "done",
		threadId: options.threadId,
		parts: options.parts ?? [{ id: `${id}:text`, type: "text", text }],
	};
}

function initialThreads(): ChatAgentThread[] {
	return [
		{ id: RESEARCH, name: "资料研究员", task: "整理资料并交叉验证来源" },
		{ id: REVIEW, name: "方案审阅员", task: "检查方案并给出修改建议" },
	].map((agent) => ({
		...agent,
		status: "idle",
		messages: [],
		loading: false,
		error: null,
		nextPageToken: null,
		historyAvailable: true,
		loaded: false,
	}));
}

/** 模拟等待而不请求网络；切换预览或离开页面时结清定时任务，避免迟到更新。 */
function useLocalDelay() {
	const pending = useRef(new Map<number, (ready: boolean) => void>());
	useEffect(() => {
		const timers = pending.current;
		return () => {
			for (const [timer, resolve] of timers) {
				window.clearTimeout(timer);
				resolve(false);
			}
			timers.clear();
		};
	}, []);
	return useCallback(
		() =>
			new Promise<boolean>((resolve) => {
				const timer = window.setTimeout(() => {
					pending.current.delete(timer);
					resolve(true);
				}, 800);
				pending.current.set(timer, resolve);
			}),
		[],
	);
}

/** 只实现 ChatMultiAgent 的受控展示合同；分页数据为本地样本，不模拟或新增 Provider 协议。 */
export function MultiAgentDemo() {
	const [messages, setMessages] = useState<ChatMessage[]>([
		message("main-request", "请一起整理资料并检查方案。", { role: "user" }),
		message("main-answer", "已安排资料研究员和方案审阅员协作，展开卡片可查看各自进展。", {
			parts: [
				{ id: "main-answer:text", type: "text", text: "已安排资料研究员和方案审阅员协作，展开卡片可查看各自进展。" },
				{ id: "card:research", type: "sub-agent", threadId: RESEARCH },
				{ id: "card:review", type: "sub-agent", threadId: REVIEW },
			],
		}),
	]);
	const [threads, setThreads] = useState(initialThreads);
	const [selectedThreadId, selectThreadId] = useState<string | null>(null);
	const loading = useRef(new Set<string>());
	const failNext = useRef(new Set<string>());
	const lastRequest = useRef(new Map<string, boolean>());
	const sequence = useRef(0);
	const delay = useLocalDelay();
	const patchThread = (id: string, update: (thread: ChatAgentThread) => ChatAgentThread) =>
		setThreads((current) => current.map((thread) => (thread.id === id ? update(thread) : thread)));

	const loadThreadEvents: ChatMultiAgent["loadThreadEvents"] = async (id, options = {}) => {
		const thread = threads.find((item) => item.id === id);
		if (!thread || loading.current.has(id)) return;
		const more = options.retry ? (lastRequest.current.get(id) ?? false) : Boolean(options.more);
		lastRequest.current.set(id, more);
		loading.current.add(id);
		const fail = failNext.current.delete(id);
		patchThread(id, (current) => ({ ...current, loading: true, error: null }));
		try {
			if (!(await delay())) return;
			if (fail) {
				patchThread(id, (current) => ({ ...current, loading: false, error: "本地模拟查询失败，点击重试即可恢复。" }));
				return;
			}
			const older = message(`${id}:older`, "较早记录：已确认任务范围和资料来源。", { threadId: id });
			const latest = message(
				`${id}:latest`,
				id === RESEARCH
					? "资料汇总完成：已整理三项参考依据，等待主 Agent 汇总。"
					: "方案检查完成：建议补充失败重试与操作确认。",
				{ threadId: id },
			);
			patchThread(id, (current) => ({
				...current,
				messages: more
					? [older, ...current.messages.filter((item) => item.id !== older.id)]
					: current.messages.length > 0
						? current.messages
						: [latest],
				loading: false,
				error: null,
				loaded: true,
				nextPageToken: more || (current.loaded && !current.nextPageToken) ? null : "demo-older-page",
			}));
		} finally {
			loading.current.delete(id);
		}
	};

	const multiAgent: ChatMultiAgent = {
		selectedThreadId,
		threads,
		loading: false,
		error: null,
		selectThread(id) {
			selectThreadId(id);
			const thread = threads.find((item) => item.id === id);
			if (thread && !thread.loaded && !thread.error) void loadThreadEvents(thread.id);
		},
		async refreshThreads() {},
		loadThreadEvents,
	};

	return (
		<div data-kit-appearance="workspace" className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--kit-bg)]">
			<div className="shrink-0 space-y-2 border-b border-[var(--kit-border)] p-3">
				<p className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
					纯本地演示。先输入草稿，再展开子 Agent 卡查看各自消息；返回输入框草稿仍在。
				</p>
				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						className={controlClass}
						disabled={threads.some((thread) => thread.loading)}
						onClick={() => {
							const id = REVIEW;
							failNext.current.add(id);
							void loadThreadEvents(id, { more: Boolean(threads.find((thread) => thread.id === id)?.nextPageToken) });
						}}
					>
						演示消息加载失败
					</button>
				</div>
			</div>
			<Chat
				variant="workspace"
				messages={messages}
				multiAgent={multiAgent}
				onSend={(text) => {
					sequence.current += 1;
					const id = `main-local-${sequence.current}`;
					setMessages((current) => [
						...current,
						message(`${id}:user`, text, { role: "user" }),
						message(`${id}:answer`, "本地演示已收到消息。真实接入时由 useChat 提供多 Agent 状态和发送回调。"),
					]);
				}}
			/>
		</div>
	);
}
