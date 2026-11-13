import { Chat } from "@openagentpack/kit-chat-ui";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";
import type {
	SendMessageResponse,
	SessionEvent,
	SessionThreadSummary,
	ToolApprovalsResponse,
} from "@openagentpack/kit-sdk/protocol";
import type { ChatProvider, StreamSessionOptions } from "@openagentpack/kit-sdk/providers";
import { createBailianChatProvider, createBailianThreadOperations } from "@openagentpack/kit-sdk/providers/bailian";
import { createRequest } from "@openagentpack/kit-sdk/request";
import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";

const query = new URLSearchParams(location.search);
const isRaw = query.has("raw");
const isLegacy = query.has("legacy");
const isEventStart = isRaw && query.has("event-start");
const isReasoning = !isRaw && query.has("reasoning");
const sessionId = "multi-agent-session";
const threadId = "sthr_research";
const time = "2026-10-28T01:00:00.000Z";
const timestamp = (second: number) => new Date(Date.parse(time) + second * 1000).toISOString();
const messageTime = (id: string) => {
	if (/^main-\d+$/.test(id)) return timestamp(Number(id.slice(5)));
	if (/^child-\d+$/.test(id)) return timestamp(50 + Number(id.slice(6)));
	return timestamp(id === "main-delegation" ? 24 : id === "live-child" ? 110 : 100);
};
const threads: SessionThreadSummary[] = [
	{
		id: threadId,
		session_id: sessionId,
		parent_thread_id: "thrd_main",
		agent: { id: "agent_research", name: "资料研究员" },
		status: "running",
		created_at: time,
		updated_at: time,
	},
	{
		id: "sthr_review",
		session_id: sessionId,
		parent_thread_id: "thrd_main",
		agent: { id: "agent_research", name: "资料研究员" },
		status: "idle",
		created_at: time,
		updated_at: time,
	},
	{
		id: "sthr_verify",
		session_id: sessionId,
		parent_thread_id: threadId,
		agent: { id: "agent_verify", name: "事实核验与引用整理 Agent" },
		status: "idle",
		created_at: time,
		updated_at: time,
	},
];
const message = (id: string, text: string, owner = "thrd_main"): SessionEvent => ({
	event_id: id,
	type: "message",
	role: "assistant",
	created_at: messageTime(id),
	content: [{ type: "text", text: `${text}\n\n` }],
	metadata: { thread_id: owner, event_status: "completed" },
});
const status = (value: string): SessionEvent => ({
	event_id: "main-status",
	type: "session_status",
	created_at: timestamp(30),
	content: [{ type: "data", data: { session_status: value } }],
	metadata: { thread_id: "thrd_main", event_status: "completed" },
});
const initial: SessionEvent[] = [
	...Array.from({ length: 24 }, (_, index) =>
		message(`main-${index}`, `主 Agent 第 ${index + 1} 条消息。\n\n正在整理本次任务的执行过程和资料。`),
	),
	message("main-delegation", "主 Agent 已委托研究任务"),
	status("running"),
	{
		event_id: "child-created",
		type: "thread_created",
		created_at: timestamp(40),
		metadata: { thread_id: threadId },
		content: [{ type: "data", data: { session_thread_id: threadId, agent_name: "资料研究员" } }],
	},
];
const emptyApprovals: ToolApprovalsResponse = {
	requires_action: false,
	batch_id: null,
	pending_call_ids: [],
	requests: [],
};
const stats = { opens: 0, stops: 0, history: [] as string[], paths: [] as string[], writes: [] as string[] };
let revision = 0;
const listeners = new Set<() => void>();
function changed() {
	revision++;
	for (const listener of listeners) listener();
}
const watch = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};
let streamOptions: StreamSessionOptions | undefined;
let rawSource: ReadableStreamDefaultController<Uint8Array> | undefined;
let failHistory = false;
let failStop = false;
let holdHistory = false;
const pending: (() => void)[] = [];
const rawEvent = (event: SessionEvent): Record<string, unknown> => ({
	object: "message",
	id: event.event_id,
	type: event.type,
	role: event.role,
	status: event.metadata?.event_status ?? "completed",
	created_at: event.created_at,
	thread_id: event.metadata?.thread_id,
	content: event.content,
	metadata: event.metadata,
});
const emitRaw = (frame: Record<string, unknown>) =>
	rawSource?.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(frame)}\n\n`));
const emit = (event: SessionEvent) => {
	if (isRaw) emitRaw(rawEvent(event));
	else streamOptions?.onEvent?.(event);
};
// 使用标准累计快照验证展示生命周期，不依赖原始 SSE 的 SDK 转换。
const reasoningEvent = (eventStatus: "in_progress" | "completed"): SessionEvent => ({
	...message("reasoning-disclosure", "先核对思考生命周期。"),
	type: "reasoning",
	metadata: { thread_id: "thrd_main", event_status: eventStatus },
});
const reasoningControls: Record<string, () => void> = {
	开始思考: () => emit(reasoningEvent("in_progress")),
	完成思考: () => {
		emit(reasoningEvent("completed"));
		emit(message("reasoning-body", "正文第一段。"));
	},
	更新正文: () => emit(message("reasoning-body", "正文第一段，正文第二段。")),
};
// 保留真实 BMA 帧形状：start/delta 没有顶层 id、role、thread_id 或 created_at。
const liveReasoningId = "msg_live_reasoning";
const liveMessageId = "msg_live_message";
const completeRaw = (id: string, type: string, text: string) =>
	emitRaw({
		object: "message",
		status: "completed",
		id,
		created_at: timestamp(120),
		sequence_number: null,
		type,
		role: "assistant",
		thread_id: "thrd_main",
		content: [{ type: "text", text }],
	});
const eventStartControls: Record<string, () => void> = {
	开始原始流: () => {
		emitRaw({
			type: "event_start",
			event: { id: liveReasoningId, type: "reasoning" },
			object: "message",
			status: "in_progress",
		});
		for (const reasoning of ["先核对", "事件流。"])
			emitRaw({
				type: "event_delta",
				event_id: liveReasoningId,
				delta: { type: "reasoning_delta", index: 0, reasoning },
				object: "content",
				status: "in_progress",
			});
	},
	发送正文增量: () => {
		completeRaw(liveReasoningId, "reasoning", "先核对事件流。");
		emitRaw({
			type: "event_start",
			event: { id: liveMessageId, type: "message" },
			object: "message",
			status: "in_progress",
		});
		emitRaw({
			type: "event_delta",
			event_id: liveMessageId,
			delta: { type: "content_delta", index: 0, content: { type: "text", text: "正文第一段，" } },
			object: "content",
			status: "in_progress",
		});
	},
	追加正文增量: () =>
		emitRaw({
			type: "event_delta",
			event_id: liveMessageId,
			delta: { type: "content_delta", index: 0, content: { type: "text", text: "正文第二段。" } },
			object: "content",
			status: "in_progress",
		}),
	发送最终快照: () => completeRaw(liveMessageId, "message", "正文第一段，正文第二段。"),
	结束原始轮次: () =>
		emitRaw({
			object: "message",
			status: "completed",
			id: "sevt_live_idle",
			created_at: timestamp(121),
			sequence_number: null,
			type: "session_status",
			content: [{ type: "data", data: { session_status: "idle", stop_reason: { type: "end_turn" } } }],
		}),
};
async function history(id: string, page?: string | null) {
	stats.history.push(`${id}/${page ?? "latest"}`);
	changed();
	if (holdHistory) await new Promise<void>((resolve) => pending.push(resolve));
	if (failHistory) {
		failHistory = false;
		throw new Error("线程历史暂不可用");
	}
	if (id !== threadId) return { data: [message(`${id}-empty`, "复核工作已完成", id)], next_page_token: null };
	const start = page ? 0 : 24;
	const data = Array.from({ length: 24 }, (_, index) =>
		message(`child-${start + index}`, `研究记录 ${start + index + 1}\n\n已核对资料来源，并保留了对应的参考依据。`, id),
	);
	return { data, next_page_token: page ? null : "older" };
}
const normalized: ChatProvider = {
	stream: async (_id, options = {}) => {
		stats.opens++;
		streamOptions = options;
		changed();
		for (const event of initial) options.onEvent?.(event);
		options.onReady?.({ sessionId, replayed: initial.length });
		await new Promise<void>((resolve) => options.signal?.addEventListener("abort", () => resolve(), { once: true }));
	},
	sendMessage: async (_id, body) => {
		stats.writes.push(body.text);
		changed();
		return { session_id: sessionId, accepted: true, event_ids: [] };
	},
	interrupt: async () => {
		if (failStop) {
			failStop = false;
			throw new Error("停止服务暂不可用");
		}
		stats.stops++;
		changed();
		// 思考场景在正文之后结束轮次，不能改写初始 running 所在的历史分界。
		emit(isReasoning ? { ...status("idle"), event_id: "reasoning-idle", created_at: timestamp(101) } : status("idle"));
		return { interrupted: true };
	},
	toolApprovals: async () => emptyApprovals,
	submitToolApproval: async () => ({ session_id: sessionId, accepted: true, event_ids: [] }),
	...(isLegacy
		? {}
		: {
				listThreads: async () => ({ data: threads, next_page_token: null }),
				listThreadEvents: async (_id: string, id: string, options?: { pageToken?: string }) =>
					history(id, options?.pageToken),
			}),
};
const result = async <T,>(response: Response) => (await response.json()) as T;
const request = createRequest({
	baseUrl: "https://business.example",
	fetchImpl: async (input, init) => {
		const url = new URL(String(input));
		stats.paths.push(url.pathname + url.search);
		changed();
		if (url.pathname.endsWith("/stream")) {
			stats.opens++;
			changed();
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						rawSource = controller;
					},
				}),
				{ headers: { "Content-Type": "text/event-stream" } },
			);
		}
		if (url.pathname.endsWith("/threads")) return Response.json({ data: threads, has_more: false });
		if (url.pathname.includes("/threads/") && url.pathname.endsWith("/events")) {
			try {
				const id = url.pathname.split("/").at(-2)!;
				const page = await history(id, url.searchParams.get("page"));
				return Response.json({
					data: page.data.toReversed().map(rawEvent),
					next_page: page.next_page_token,
					has_more: Boolean(page.next_page_token),
				});
			} catch {
				return Response.json({ message: "线程历史暂不可用" }, { status: 503 });
			}
		}
		if (url.pathname.endsWith("/events")) return Response.json({ data: initial.map(rawEvent) });
		if (url.pathname.endsWith("/stop")) {
			if (failStop) {
				failStop = false;
				return Response.json({ message: "停止服务暂不可用" }, { status: 503 });
			}
			stats.stops++;
			changed();
			emit(status("idle"));
			return Response.json({ interrupted: true });
		}
		if (url.pathname.endsWith("/send")) {
			stats.writes.push(String(init?.body));
			changed();
			return Response.json({ session_id: sessionId, accepted: true, event_ids: [] });
		}
		if (url.pathname.endsWith("/approvals")) return Response.json(emptyApprovals);
		return Response.json({ session_id: sessionId, accepted: true, event_ids: [] });
	},
});
const raw = createBailianChatProvider({
	request,
	...createBailianThreadOperations(),
	openStream: {
		buildRequest: () => ({ path: "/session/stream" }),
		mapResponse: (response) => ({ response, ready: Promise.resolve() }),
	},
	listEvents: {
		buildRequest: () => ({ path: "/session/events" }),
		mapResponse: async (response) => ({ events: (await result<{ data: Record<string, unknown>[] }>(response)).data }),
	},
	sendMessage: {
		buildRequest: ({ body }) => ({ path: "/session/send", init: { method: "POST", body: JSON.stringify(body) } }),
		mapResponse: result<SendMessageResponse>,
	},
	interrupt: {
		buildRequest: () => ({ path: "/session/stop", init: { method: "POST" } }),
		mapResponse: result<{ interrupted: boolean }>,
	},
	toolApprovals: { buildRequest: () => ({ path: "/session/approvals" }), mapResponse: result<ToolApprovalsResponse> },
	submitToolApproval: {
		buildRequest: () => ({ path: "/session/decision", init: { method: "POST" } }),
		mapResponse: result<SendMessageResponse>,
	},
});
const provider = isRaw ? raw : normalized;
function Harness() {
	useSyncExternalStore(watch, () => revision);
	const chat = useChat({ sessionId, provider });
	const [approval, setApproval] = useState(false);
	const controls: Record<string, () => void> = {
		下次停止失败: () => {
			failStop = true;
		},
		下次历史失败: () => {
			failHistory = true;
		},
		延迟历史: () => {
			holdHistory = true;
		},
		释放历史: () => {
			holdHistory = false;
			for (const resolve of pending.splice(0)) resolve();
		},
		"子 Agent 实时消息": () => emit(message("live-child", "实时研究结论", threadId)),
		显示审批: () => setApproval(true),
	};
	const visibleControls = isReasoning ? reasoningControls : controls;
	return (
		<main className="flex h-full min-h-0 min-w-0 flex-col">
			<div className="flex shrink-0 flex-wrap gap-2 border-b border-[var(--kit-border)] p-2">
				{Object.entries(isEventStart ? eventStartControls : visibleControls).map(([label, action]) => (
					<button key={label} type="button" onClick={action}>
						{label}
					</button>
				))}
			</div>
			<output data-testid="stats" hidden>
				{JSON.stringify(stats)}
			</output>
			<output data-testid="state" hidden>
				{JSON.stringify({ connected: chat.connected, phase: chat.phase })}
			</output>
			<Chat
				variant="workspace"
				messages={chat.messages}
				multiAgent={chat.multiAgent}
				turnRunning={chat.turnRunning}
				canSend={chat.canSend}
				onSend={chat.send}
				onStop={chat.stop}
				scrollKey={sessionId}
				approvals={approval ? <p>主 Agent 工具审批信息</p> : null}
			/>
		</main>
	);
}
createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
