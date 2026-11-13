"use client";

import { type ChatMessage, type MessageTransformer, transformSessionEvent } from "@openagentpack/kit-sdk/messages";
import {
	KitError,
	type SendMessageResponse,
	type SessionEvent,
	type ToolApprovalsResponse,
} from "@openagentpack/kit-sdk/protocol";
import type { ChatProvider, StreamSessionOptions } from "@openagentpack/kit-sdk/providers";
import { type BailianChatProviderOptions, createBailianChatProvider } from "@openagentpack/kit-sdk/providers/bailian";
import { createRequest } from "@openagentpack/kit-sdk/request";
import { useEffect, useRef, useState } from "react";
import { LogList, type LogRow, PRIMARY_BTN, type PushLog, SECONDARY_BTN } from "./sdk-demo.tsx";

const PROVIDER_BASE = "/mock-bailian";
const PROVIDER_SESSION = "sess-1";
const PROVIDER_FRAME_MS = 350;
const PROVIDER_READY_MS = 900;

const at = (second: number) => `2026-11-11T09:00:${String(second).padStart(2, "0")}Z`;

// 原始百炼事件形状与 packages/sdk/src/providers/bailian/stream.test.ts 的 fixture 一致。
const HISTORY_EVENTS: Record<string, unknown>[] = [
	{
		object: "message",
		id: "msg-1",
		type: "message",
		role: "assistant",
		status: "completed",
		created_at: at(1),
		content: [{ type: "text", text: "上周会议纪要已归档到 /docs/weekly。" }],
	},
	{
		object: "message",
		id: "st-1",
		type: "session_status",
		status: "completed",
		created_at: at(2),
		content: [{ type: "data", data: { session_status: "idle" } }],
	},
];

const LIVE_EVENTS: Record<string, unknown>[] = [
	{
		object: "message",
		id: "msg-2",
		type: "message",
		role: "assistant",
		status: "in_progress",
		created_at: at(3),
		content: [{ type: "text", text: "" }],
	},
	{ object: "content", msg_id: "msg-2", index: 0, type: "text", delta: true, text: "正在整理今天的安排…" },
	{ object: "content", msg_id: "msg-2", index: 0, type: "text", delta: true, text: "15:00 有一个 1:1 同步。" },
	{
		object: "message",
		id: "msg-2",
		type: "message",
		role: "assistant",
		status: "completed",
		created_at: at(4),
		content: [{ type: "text", text: "今天 15:00 有一个 1:1 同步，已写入日历。" }],
	},
	{
		object: "message",
		id: "st-2",
		type: "session_status",
		status: "completed",
		created_at: at(5),
		content: [{ type: "data", data: { session_status: "idle" } }],
	},
];

/** 持久订阅：演示帧发完后保持连接打开，自然 EOF 对原始百炼 Provider 是意外关闭。 */
function holdOpenStream(frames: Uint8Array[], intervalMs: number): ReadableStream<Uint8Array> {
	let index = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	return new ReadableStream<Uint8Array>({
		start(controller) {
			const push = () => {
				if (index >= frames.length) return;
				controller.enqueue(frames[index]);
				index += 1;
				timer = setTimeout(push, intervalMs);
			};
			timer = setTimeout(push, intervalMs);
		},
		cancel() {
			if (timer) clearTimeout(timer);
		},
	});
}

function createMockFetch(push: PushLog): typeof fetch {
	return async (input, init) => {
		const url = input instanceof Request ? input.url : String(input);
		const path = url.startsWith(PROVIDER_BASE) ? url.slice(PROVIDER_BASE.length) : url;
		const route = path.split("?")[0];
		if (route.endsWith("/stream")) {
			push({
				text: `HTTP → GET ${path} · 200 text/event-stream`,
				detail: "响应头 x-upstream-ready: true —— 后端先订阅百炼，再交付响应",
			});
			const frames = LIVE_EVENTS.map((event) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
			return new Response(holdOpenStream(frames, PROVIDER_FRAME_MS), {
				status: 200,
				headers: { "Content-Type": "text/event-stream; charset=utf-8", "x-upstream-ready": "true" },
			});
		}
		if (route.endsWith("/events")) {
			push({ text: `HTTP → GET ${path} · 200` });
			return new Response(JSON.stringify({ data: HISTORY_EVENTS, next_page_token: null }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		if (route.endsWith("/messages")) {
			push({ text: `HTTP → POST ${path} · 200` });
			return new Response(
				JSON.stringify({ result: { session_id: PROVIDER_SESSION, accepted: true, event_ids: ["evt-user-1"] } }),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}
		push({ tone: "muted", text: `HTTP → ${init?.method ?? "GET"} ${path} · mock 未配置` });
		return Response.json({ error: "not mocked" }, { status: 404 });
	};
}

async function unwrapResult(response: Response): Promise<Record<string, unknown>> {
	const envelope = (await response.json()) as { result?: Record<string, unknown> };
	if (!envelope.result) throw new KitError("provider_error", "后端响应缺少 result 包装");
	return envelope.result;
}

function describeEvent(event: SessionEvent): string {
	const text = (event.content ?? [])
		.map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
		.join("");
	const label = `${event.type}${event.role ? ` · ${event.role}` : ""}`;
	return text ? `${label} · ${text}` : label;
}

/** 示例后端合同的最小化实现：每项操作的 buildRequest / mapResponse 都记录到日志。 */
function createLoggedProvider(push: PushLog): ChatProvider {
	const request = createRequest({
		baseUrl: PROVIDER_BASE,
		headers: async () => ({ Authorization: "Bearer app-token" }),
		fetchImpl: createMockFetch(push),
	});
	const options: BailianChatProviderOptions = {
		request,
		openStream: {
			buildRequest: ({ sessionId }) => {
				push({ text: `openStream.buildRequest → GET /sessions/${sessionId}/stream` });
				return { path: `/sessions/${sessionId}/stream`, init: { headers: { Accept: "text/event-stream" } } };
			},
			mapResponse(response) {
				push({ tone: "muted", text: "openStream.mapResponse · 不读 body、不先等待 ready" });
				return {
					response,
					ready: new Promise<void>((resolve) => setTimeout(resolve, PROVIDER_READY_MS)),
				};
			},
		},
		listEvents: {
			buildRequest: ({ sessionId, pageToken }) => {
				const query = pageToken ? `page_token=${encodeURIComponent(pageToken)}` : "order=asc";
				push({ text: `listEvents.buildRequest → GET /sessions/${sessionId}/events?${query}` });
				return { path: `/sessions/${sessionId}/events?${query}` };
			},
			async mapResponse(response) {
				const page = (await response.json()) as { data: Record<string, unknown>[]; next_page_token?: string | null };
				push({
					text: `listEvents.mapResponse · ${page.data.length} 条完整快照 · nextPageToken=${page.next_page_token ?? "null"}`,
				});
				return { events: page.data, nextPageToken: page.next_page_token ?? null };
			},
		},
		sendMessage: {
			buildRequest({ sessionId, body }) {
				push({
					text: `sendMessage.buildRequest → POST /sessions/${sessionId}/messages`,
					detail: "body 映射为 { input, request_id }，URL 与包装由示例后端决定",
				});
				return {
					path: `/sessions/${sessionId}/messages`,
					init: {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ input: body.text, request_id: body.client_message_id }),
					},
				};
			},
			async mapResponse(response) {
				const result = await unwrapResult(response);
				push({
					text: `sendMessage.mapResponse · accepted=${String(result.accepted)} · event_ids=[${(result.event_ids as string[]).join(", ")}]`,
				});
				return result as unknown as SendMessageResponse;
			},
		},
		interrupt: {
			buildRequest: ({ sessionId }) => ({ path: `/sessions/${sessionId}/interrupt`, init: { method: "POST" } }),
			mapResponse: async (response) => (await unwrapResult(response)) as unknown as { interrupted: boolean },
		},
		toolApprovals: {
			buildRequest: ({ sessionId }) => ({ path: `/sessions/${sessionId}/approvals` }),
			mapResponse: async (response) => (await unwrapResult(response)) as unknown as ToolApprovalsResponse,
		},
		submitToolApproval: {
			buildRequest: ({ sessionId, decision }) => ({
				path: `/sessions/${sessionId}/approvals`,
				init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(decision) },
			}),
			mapResponse: async (response) => (await unwrapResult(response)) as unknown as SendMessageResponse,
		},
	};
	return createBailianChatProvider(options);
}

/** SDK 演示：真实 createBailianChatProvider 跑在 mock Request 上 —— 连接时序、缓冲归并与操作映射。 */
export function BailianProviderDemo() {
	const [rows, setRows] = useState<LogRow[]>([]);
	const [running, setRunning] = useState(false);
	const [ready, setReady] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const providerRef = useRef<ChatProvider | null>(null);
	const readyRef = useRef(false);

	useEffect(() => () => abortRef.current?.abort(), []);

	const push: PushLog = (row) => setRows((current) => [...current, { seq: current.length, ...row }]);

	const connect = () => {
		abortRef.current?.abort();
		readyRef.current = false;
		setRows([]);
		setRunning(true);
		setReady(false);
		const controller = new AbortController();
		abortRef.current = controller;
		const provider = createLoggedProvider(push);
		providerRef.current = provider;
		void provider
			.stream(PROVIDER_SESSION, {
				signal: controller.signal,
				onReset: () => push({ tone: "muted", text: "onReset · 历史重建开始，此间实时帧进入缓冲" }),
				onEvent: (event) =>
					push(
						readyRef.current
							? { text: `实时 · ${describeEvent(event)}` }
							: { tone: "muted", text: `重建交付 · ${describeEvent(event)}` },
					),
				onReady: (info) => {
					readyRef.current = true;
					setReady(true);
					push({ text: `onReady · replayed=${info.replayed} · cursor=${String(info.cursor)}` });
					push({ tone: "muted", text: "仅此刻连接为 connected，canSend 才为 true" });
				},
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) push({ tone: "muted", text: "AbortError · 取消关闭订阅与历史重建" });
				else if (error instanceof KitError) push({ text: `KitError ${error.code} · ${error.message}` });
				else push({ tone: "muted", text: `连接失败 · ${error instanceof Error ? error.message : String(error)}` });
			})
			.finally(() => {
				if (abortRef.current === controller) {
					setRunning(false);
					setReady(false);
				}
			});
	};

	const send = async () => {
		const provider = providerRef.current;
		if (!provider) return;
		try {
			await provider.sendMessage(PROVIDER_SESSION, { text: "帮我看看今天的日程", client_message_id: "demo-1" });
		} catch (error) {
			push({ tone: "muted", text: `发送失败 · ${error instanceof Error ? error.message : String(error)}` });
		}
	};

	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col gap-4 bg-[var(--kit-bg)] p-6 text-[var(--kit-fg)]"
		>
			<div className="flex flex-wrap items-center gap-2">
				<button type="button" onClick={connect} disabled={running} className={PRIMARY_BTN}>
					连接 stream()（openStream + listEvents）
				</button>
				<button type="button" onClick={() => void send()} disabled={!running || !ready} className={SECONDARY_BTN}>
					发送消息 sendMessage()
				</button>
				<button type="button" onClick={() => abortRef.current?.abort()} disabled={!running} className={SECONDARY_BTN}>
					abort()
				</button>
			</div>
			<LogList
				rows={rows}
				placeholder="连接按「订阅 → 就绪 → 历史 → 合并缓冲 → onReady」执行；期间实时帧先缓冲后交付。"
			/>
		</div>
	);
}

const EVENTS_READY_MS = 400;
const EVENTS_SEND_MS = 400;
const EVENTS_LIVE_MS = 450;

const EVENTS_HISTORY: SessionEvent[] = [
	{ event_id: "evt-h1", type: "message", role: "user", content: [{ type: "text", text: "帮我看看今天的日程" }] },
	{
		event_id: "evt-h2",
		type: "message",
		role: "assistant",
		content: [{ type: "text", text: "今天 15:00 有一个 1:1 同步。" }],
	},
];

interface EventsProviderHandle {
	provider: ChatProvider;
	dispose: () => void;
}

/** 已转换事件脚本 Provider：只负责按时发出累计快照与游标，回调展示交给页面。 */
function createEventsProvider(): EventsProviderHandle {
	const optionsRef: { current: StreamSessionOptions | null } = { current: null };
	const timers: ReturnType<typeof setTimeout>[] = [];
	const cursorRef = { current: 0 };
	const sendSeq = { current: 0 };
	const signal = () => optionsRef.current?.signal;
	const schedule = (ms: number, fn: () => void) => {
		const timer = setTimeout(() => {
			timers.splice(timers.indexOf(timer), 1);
			fn();
		}, ms);
		timers.push(timer);
	};
	const emit = (event: SessionEvent) => {
		cursorRef.current += 1;
		optionsRef.current?.onEvent?.(event, `1:${cursorRef.current}`);
	};
	const provider: ChatProvider = {
		stream: (sessionId, options) => {
			optionsRef.current = options ?? null;
			void (async () => {
				await new Promise((resolve) => setTimeout(resolve, EVENTS_READY_MS));
				if (signal()?.aborted) return;
				options?.onReset?.();
				for (const event of EVENTS_HISTORY) emit(event);
				options?.onReady?.({ sessionId, replayed: EVENTS_HISTORY.length, cursor: `1:${cursorRef.current}` });
			})();
			return new Promise((resolve) => {
				if (signal()?.aborted) return resolve();
				signal()?.addEventListener("abort", () => resolve(), { once: true });
			});
		},
		sendMessage: async (sessionId, body) => {
			sendSeq.current += 1;
			const seq = sendSeq.current;
			emit({ event_id: `evt-u${seq}`, type: "message", role: "user", content: [{ type: "text", text: body.text }] });
			schedule(EVENTS_SEND_MS, () => {
				emit({
					event_id: `evt-a${seq}`,
					type: "message",
					role: "assistant",
					content: [{ type: "text", text: "正在查看日程…" }],
				});
			});
			schedule(EVENTS_SEND_MS + EVENTS_LIVE_MS, () => {
				emit({
					event_id: `evt-a${seq}`,
					type: "message",
					role: "assistant",
					content: [{ type: "text", text: "今天 15:00 的 1:1 已确认，已写入日历。" }],
				});
			});
			schedule(EVENTS_SEND_MS + EVENTS_LIVE_MS * 2, () => {
				emit({
					event_id: `evt-s${seq}`,
					type: "session_status",
					content: [{ type: "data", data: { session_status: "idle" } }],
				});
			});
			return { session_id: sessionId, accepted: true, event_ids: [`evt-u${seq}`] };
		},
		interrupt: async () => ({ interrupted: true }),
		toolApprovals: async () => ({ requires_action: false, batch_id: null, pending_call_ids: [], requests: [] }),
		submitToolApproval: async (sessionId) => ({ session_id: sessionId, accepted: true, event_ids: [] }),
	};
	return {
		provider,
		dispose: () => {
			for (const timer of timers) clearTimeout(timer);
			timers.length = 0;
			optionsRef.current = null;
		},
	};
}

/** SDK 演示：已转换事件的五方法合同 —— onReset → 完整事件 → onReady → 实时累计快照 + 游标。 */
export function TransformedProviderDemo() {
	const [rows, setRows] = useState<LogRow[]>([]);
	const [running, setRunning] = useState(false);
	const [ready, setReady] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const handleRef = useRef<EventsProviderHandle | null>(null);
	const readyRef = useRef(false);

	useEffect(
		() => () => {
			abortRef.current?.abort();
			handleRef.current?.dispose();
		},
		[],
	);

	const push: PushLog = (row) => setRows((current) => [...current, { seq: current.length, ...row }]);

	const connect = () => {
		abortRef.current?.abort();
		handleRef.current?.dispose();
		readyRef.current = false;
		setRows([]);
		setRunning(true);
		setReady(false);
		const controller = new AbortController();
		abortRef.current = controller;
		const handle = createEventsProvider();
		handleRef.current = handle;
		controller.signal.addEventListener(
			"abort",
			() => {
				handle.dispose();
				push({ tone: "muted", text: "取消 · 停止所有回调" });
			},
			{ once: true },
		);
		void handle.provider
			.stream(PROVIDER_SESSION, {
				signal: controller.signal,
				onReset: () => push({ tone: "muted", text: "onReset · 重建开始，随后交付完整事件" }),
				onEvent: (event, cursor) =>
					push(
						readyRef.current
							? { text: `onEvent · cursor=${String(cursor)} · ${describeEvent(event)}` }
							: { tone: "muted", text: `onEvent(重建) · ${describeEvent(event)}` },
					),
				onReady: (info) => {
					readyRef.current = true;
					setReady(true);
					push({ text: `onReady · replayed=${info.replayed} · cursor=${String(info.cursor)}` });
					push({ tone: "muted", text: "onReady 表示重建完成，不只是 fetch 成功" });
				},
			})
			.catch(() => {
				if (controller.signal.aborted) push({ tone: "muted", text: "取消 · 停止所有回调" });
			})
			.finally(() => {
				if (abortRef.current === controller) {
					setRunning(false);
					setReady(false);
				}
			});
	};

	const send = async () => {
		const handle = handleRef.current;
		if (!handle) return;
		const result = await handle.provider.sendMessage(PROVIDER_SESSION, {
			text: "帮我把 1:1 改到明天",
			client_message_id: "demo-2",
		});
		push({ text: `sendMessage → accepted=${String(result.accepted)} · event_ids=[${result.event_ids.join(", ")}]` });
	};

	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col gap-4 bg-[var(--kit-bg)] p-6 text-[var(--kit-fg)]"
		>
			<div className="flex flex-wrap items-center gap-2">
				<button type="button" onClick={connect} disabled={running} className={PRIMARY_BTN}>
					连接 stream()
				</button>
				<button type="button" onClick={() => void send()} disabled={!running || !ready} className={SECONDARY_BTN}>
					发送消息 sendMessage()
				</button>
				<button type="button" onClick={() => abortRef.current?.abort()} disabled={!running} className={SECONDARY_BTN}>
					abort()
				</button>
			</div>
			<LogList
				rows={rows}
				placeholder="实现方按 onReset → 完整事件 → onReady → onEvent（累计快照 + 游标）交付；取消后不再回调。"
			/>
		</div>
	);
}

const TRANSFORM_EVENT: SessionEvent = {
	event_id: "evt-1",
	type: "message",
	role: "assistant",
	content: [{ type: "text", text: "[[agent-name]] 已收到你的请求。" }],
};

/** 与 skill-example 相同的幂等展示替换：只改文本，不动生命周期。 */
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

const partsText = (messages: ChatMessage[]) =>
	messages.map((message) => message.parts.map((part) => (part.type === "text" ? part.text : "")).join("")).join(" / ");

/** SDK 演示：transformMessage 只换展示 —— 默认转换与标签替换包装在同一事件上的输出对比。 */
export function TransformMessageDemo() {
	const [rows, setRows] = useState<LogRow[]>([]);

	const push: PushLog = (row) => setRows((current) => [...current, { seq: current.length, ...row }]);

	const run = () => {
		setRows([]);
		push({
			text: `输入 · ${describeEvent(TRANSFORM_EVENT)}`,
			detail: "identity=evt-1 · messages=[]（每次重建从空集合开始）",
		});
		const def = transformSessionEvent({ messages: [], event: TRANSFORM_EVENT, identity: "evt-1" });
		push({ text: `默认 transformSessionEvent → 「${partsText(def.messages)}」` });
		const custom = replaceDisplayLabel({ messages: [], event: TRANSFORM_EVENT, identity: "evt-1" });
		push({ text: `withDisplayLabel 包装 → 「${partsText(custom.messages)}」` });
		push({ tone: "muted", text: "展示替换是幂等的：重建时按最新快照逐事件重放，生命周期与审批不变" });
	};

	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col gap-4 bg-[var(--kit-bg)] p-6 text-[var(--kit-fg)]"
		>
			<div className="flex flex-wrap items-center gap-2">
				<button type="button" onClick={run} className={PRIMARY_BTN}>
					转换一轮
				</button>
			</div>
			<LogList rows={rows} placeholder="同一事件分别走默认转换与标签替换包装，对比输出 ChatMessage 的文本。" />
		</div>
	);
}
