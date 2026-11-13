"use client";

import { EmptyState, MessageList, Sender, ToolApprovalCard } from "@openagentpack/kit-chat-ui";
import { type ChatController, createChatController } from "@openagentpack/kit-sdk/chat";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";
import {
	createSseParser,
	decodeFrame,
	KitError,
	type SessionEvent,
	type SessionSummary,
	type SseFrame,
} from "@openagentpack/kit-sdk/protocol";
import type { ChatProvider, StreamSessionOptions } from "@openagentpack/kit-sdk/providers";
import { createKitClient } from "@openagentpack/kit-sdk/providers/kit";
import { KitProvider, useKitClient } from "@openagentpack/kit-sdk/providers/kit/react";
import { createRequest, type RequestClient } from "@openagentpack/kit-sdk/request";
import { useSessions } from "@openagentpack/kit-sdk/sessions/hooks";
import { createSseStream } from "@openagentpack/kit-sdk/stream";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type LineEnding = "\n" | "\r\n";
type FrameEnding = "\n\n" | "\r\n\r\n";

export interface LogRow {
	seq: number;
	tone?: "muted";
	text: string;
	detail?: string;
}

export type PushLog = (row: Omit<LogRow, "seq">) => void;

const CHUNK_SIZE = 21;
const CHUNK_INTERVAL_MS = 140;
const TEXT_CHUNK_CHARS = 24;
const TEXT_CHUNK_MS = 70;
const KIT_FRAME_MS = 450;

/** 通用分块流：逐块入队并在读完或被取消时收尾，供三个演示复用。 */
function pacedStream<T>(chunks: T[], intervalMs: number): ReadableStream<T> {
	let index = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	return new ReadableStream<T>({
		start(controller) {
			const push = () => {
				if (index >= chunks.length) {
					controller.close();
					return;
				}
				controller.enqueue(chunks[index]);
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

function byteChunks(payload: string, size: number): Uint8Array[] {
	const bytes = new TextEncoder().encode(payload);
	const chunks: Uint8Array[] = [];
	for (let offset = 0; offset < bytes.length; offset += size) chunks.push(bytes.slice(offset, offset + size));
	return chunks;
}

export const PRIMARY_BTN =
	"inline-flex min-h-9 items-center justify-center rounded-[var(--kit-radius-sm)] bg-[var(--kit-accent)] px-4 text-[length:var(--kit-text-label)] text-[var(--kit-accent-fg)] transition-opacity duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

export const SECONDARY_BTN =
	"inline-flex min-h-8 items-center rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] bg-[var(--kit-surface)] px-3 text-[length:var(--kit-text-label)] transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:bg-[var(--kit-bg-subtle)] disabled:cursor-not-allowed disabled:opacity-60";

export function LogList({ rows, placeholder }: { rows: LogRow[]; placeholder: string }) {
	return (
		<div className="min-h-0 flex-1 overflow-y-auto rounded-[var(--kit-radius)] border border-[var(--kit-border-subtle)] bg-[var(--kit-surface)] p-3">
			{rows.length === 0 ? (
				<p className="text-[length:var(--kit-text-label)] text-[var(--kit-fg-muted)]">{placeholder}</p>
			) : (
				<ul className="flex flex-col gap-2">
					{rows.map((row) => (
						<li
							key={row.seq}
							className={`animate-(--kit-animate-in) px-2.5 py-1.5 ${
								row.tone === "muted"
									? "text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)]"
									: "rounded-[var(--kit-radius-sm)] border border-[var(--kit-border-subtle)] bg-[var(--kit-bg)] text-[length:var(--kit-text-label)]"
							}`}
						>
							<p>{row.text}</p>
							{row.detail ? (
								<p className="break-words font-mono text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)]">
									{row.detail}
								</p>
							) : null}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function Radio({
	name,
	checked,
	onChange,
	label,
}: {
	name: string;
	checked: boolean;
	onChange: () => void;
	label: string;
}) {
	return (
		<label className="inline-flex cursor-pointer items-center gap-1.5">
			<input
				type="radio"
				name={name}
				checked={checked}
				onChange={onChange}
				className="size-3.5 accent-[var(--kit-accent)]"
			/>
			<code className="text-[length:var(--kit-text-label)]">{label}</code>
		</label>
	);
}

const MOCK_FRAMES = [
	{ id: "1", event: "message", data: '{"content":"Hel"}' },
	{ id: "2", event: "message", data: '{"content":"lo Kit"}' },
	{ id: "3", event: "done", data: "[DONE]" },
];

function buildPayload(line: LineEnding, frame: FrameEnding): string {
	const frames = MOCK_FRAMES.map(
		(item) => `id: ${item.id}${line}event: ${item.event}${line}data: ${item.data}${frame}`,
	);
	return `: 心跳注释${frame}${frames.join("")}`;
}

/** SDK 演示：mock SSE 字节流经 createSseStream 解码分帧，切换分隔符观察 CR/LF/CRLF 兼容。 */
export function SseStreamDemo() {
	const [line, setLine] = useState<LineEnding>("\n");
	const [frame, setFrame] = useState<FrameEnding>("\n\n");
	const [rows, setRows] = useState<LogRow[]>([]);
	const [running, setRunning] = useState(false);
	const abortRef = useRef<AbortController | null>(null);

	useEffect(() => () => abortRef.current?.abort(), []);

	const push = (row: Omit<LogRow, "seq">) => setRows((current) => [...current, { seq: current.length, ...row }]);

	const consume = async (payload: string, signal: AbortSignal) => {
		let count = 0;
		try {
			for await (const frame of createSseStream(pacedStream(byteChunks(payload, CHUNK_SIZE), CHUNK_INTERVAL_MS), {
				signal,
				onComment: () => push({ tone: "muted", text: ": 心跳注释 → onComment 通知，不生成业务帧" }),
			})) {
				count += 1;
				push({
					text: `event=${frame.event}${frame.id ? ` · id=${frame.id}` : ""}`,
					detail: `data=${frame.data}`,
				});
			}
		} catch {
			// 重新运行或卸载导致的取消不需要展示
			return;
		}
		push({ tone: "muted", text: `EOF · 共 ${count} 帧 —— 自然结束只表示字节流读完，不代表 Agent 执行完成` });
	};

	const run = () => {
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		setRows([]);
		setRunning(true);
		void consume(buildPayload(line, frame), controller.signal).finally(() => {
			if (abortRef.current === controller) setRunning(false);
		});
	};

	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col gap-4 bg-[var(--kit-bg)] p-6 text-[var(--kit-fg)]"
		>
			<div className="flex flex-wrap items-center gap-x-6 gap-y-2">
				<span className="flex items-center gap-2 text-[length:var(--kit-text-label)]">
					<span className="text-[var(--kit-fg-muted)]">行分隔</span>
					<Radio name="sse-line" checked={line === "\n"} onChange={() => setLine("\n")} label={"\\n（默认）"} />
					<Radio name="sse-line" checked={line === "\r\n"} onChange={() => setLine("\r\n")} label={"\\r\\n"} />
				</span>
				<span className="flex items-center gap-2 text-[length:var(--kit-text-label)]">
					<span className="text-[var(--kit-fg-muted)]">帧分隔</span>
					<Radio
						name="sse-frame"
						checked={frame === "\n\n"}
						onChange={() => setFrame("\n\n")}
						label={"\\n\\n（默认）"}
					/>
					<Radio
						name="sse-frame"
						checked={frame === "\r\n\r\n"}
						onChange={() => setFrame("\r\n\r\n")}
						label={"\\r\\n\\r\\n"}
					/>
				</span>
			</div>
			<button type="button" onClick={run} disabled={running} className={PRIMARY_BTN}>
				{running ? "解析中…" : "Mock SSE 字节流"}
			</button>
			<LogList rows={rows} placeholder="字节流按所选分隔符编码、分块到达；帧逐个交付，data 保持字符串。" />
		</div>
	);
}

const PING_T = 1794316674;

const PARSER_PREFILL = `: 心跳注释

id: 1:7
event: event
data: {"event_id":"evt_1","type":"message","role":"user","content":[{"type":"text","text":"帮我总结这份周报"}]}

event: ping
data: {"t":${PING_T}}

event: hello
data: {"unknown":true}

id: 1:8
event: event
data: {"event_id":"evt_2","type":"message","role":"assistant","content":[{"type":"text","text":"已读取周报，正在整理要点。"}]}

event: done
data: {"session_id":"sess_demo","status":"completed","last_event_id":"1:8","reason":null}
`;

/** SDK 演示：文本分片推入 createSseParser，decodeFrame 识别 Kit 协议帧、未知 event 返回 null。 */
export function SseParserDemo() {
	const [text, setText] = useState(PARSER_PREFILL);
	const [rows, setRows] = useState<LogRow[]>([]);
	const [running, setRunning] = useState(false);
	const abortRef = useRef<AbortController | null>(null);

	useEffect(() => () => abortRef.current?.abort(), []);

	const push = (row: Omit<LogRow, "seq">) => setRows((current) => [...current, { seq: current.length, ...row }]);

	const consume = async (source: string, signal: AbortSignal) => {
		let unknown = 0;
		let count = 0;
		const parser = createSseParser(
			(raw) => {
				const frame: SseFrame | null = decodeFrame(raw);
				if (!frame) {
					unknown += 1;
					push({ tone: "muted", text: `未知 event「${raw.event}」→ decodeFrame 返回 null，由调用方决定丢弃` });
					return;
				}
				count += 1;
				push({
					text: `type=${frame.type}${frame.type === "event" && "cursor" in frame ? ` · cursor=${frame.cursor}` : ""}`,
					detail: `data=${JSON.stringify(frame.data)}`,
				});
			},
			{
				onComment: () => push({ tone: "muted", text: "注释心跳 → onComment，不生成业务帧" }),
			},
		);
		const chunks: string[] = [];
		for (let offset = 0; offset < source.length; offset += TEXT_CHUNK_CHARS) {
			chunks.push(source.slice(offset, offset + TEXT_CHUNK_CHARS));
		}
		const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
		for (const chunk of chunks) {
			if (signal.aborted) return;
			await wait(TEXT_CHUNK_MS);
			parser.push(chunk);
		}
		parser.end();
		push({ tone: "muted", text: `parser.end() —— 共 ${count} 帧，${unknown} 个未知 event` });
	};

	const run = () => {
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		setRows([]);
		setRunning(true);
		void consume(text, controller.signal).finally(() => {
			if (abortRef.current === controller) setRunning(false);
		});
	};

	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col gap-4 bg-[var(--kit-bg)] p-6 text-[var(--kit-fg)]"
		>
			<textarea
				aria-label="SSE 文本输入"
				value={text}
				onChange={(event) => setText(event.target.value)}
				spellCheck={false}
				className="min-h-40 shrink-0 rounded-[var(--kit-radius)] border border-[var(--kit-border-subtle)] bg-[var(--kit-surface)] p-3 font-mono text-[length:var(--kit-text-meta)] outline-none focus:border-[var(--kit-border)]"
			/>
			<button type="button" onClick={run} disabled={running} className={PRIMARY_BTN}>
				{running ? "推入中…" : "推入 parser"}
			</button>
			<LogList rows={rows} placeholder="分片推入后按到达顺序解码；可编辑文本观察未知帧与注释行为。" />
		</div>
	);
}

const KIT_EVENT_USER =
	'{"event_id":"evt_1","type":"message","role":"user","content":[{"type":"text","text":"帮我总结这份周报"}]}';
const KIT_EVENT_ASSISTANT =
	'{"event_id":"evt_2","type":"message","role":"assistant","content":[{"type":"text","text":"已读取周报，正在整理要点。"}]}';
const KIT_EVENT_IDLE =
	'{"event_id":"evt_3","type":"session_status","content":[{"type":"data","data":{"session_status":"idle"}}]}';
const KIT_DONE = '{"session_id":"sess_demo","status":"completed","last_event_id":"1:9","reason":null}';

function kitFrame(frame: { id?: string; event: string; data: string }): string {
	return `${frame.id ? `id: ${frame.id}\n` : ""}event: ${frame.event}\ndata: ${frame.data}\n\n`;
}

interface KitScenario {
	label: string;
	/** 传给 client.stream 的 after；undefined 表示首订。 */
	after?: string;
	frames: string[];
}

const KIT_SCENARIOS: KitScenario[] = [
	{
		label: "首订（完整重建）",
		frames: [
			kitFrame({ event: "reset", data: '{"session_id":"sess_demo"}' }),
			kitFrame({ id: "1:7", event: "event", data: KIT_EVENT_USER }),
			kitFrame({ id: "1:8", event: "event", data: KIT_EVENT_ASSISTANT }),
			kitFrame({ event: "ready", data: '{"session_id":"sess_demo","after":null,"replayed":2,"cursor":"1:8"}' }),
			kitFrame({ event: "ping", data: `{"t":${PING_T}}` }),
			kitFrame({ id: "1:9", event: "event", data: KIT_EVENT_IDLE }),
			kitFrame({ event: "done", data: KIT_DONE }),
		],
	},
	{
		label: "续传 after=1:8",
		after: "1:8",
		frames: [
			kitFrame({ event: "ready", data: '{"session_id":"sess_demo","after":"1:8","replayed":0,"cursor":"1:8"}' }),
			kitFrame({ id: "1:9", event: "event", data: KIT_EVENT_IDLE }),
			kitFrame({ event: "done", data: KIT_DONE }),
		],
	},
	{
		label: "游标失效 → reset",
		after: "0:3",
		frames: [
			kitFrame({ event: "reset", data: '{"session_id":"sess_demo"}' }),
			kitFrame({ id: "1:7", event: "event", data: KIT_EVENT_USER }),
			kitFrame({ id: "1:8", event: "event", data: KIT_EVENT_ASSISTANT }),
			kitFrame({ event: "ready", data: '{"session_id":"sess_demo","after":null,"replayed":2,"cursor":"1:8"}' }),
			kitFrame({ id: "1:9", event: "event", data: KIT_EVENT_IDLE }),
			kitFrame({ event: "done", data: KIT_DONE }),
		],
	},
];

/** SDK 演示：mock fetchImpl 返回 Kit 协议流，观察 client.stream 的 reset → event* → ready 重建与 after 续传。 */
export function KitStreamDemo() {
	const [rows, setRows] = useState<LogRow[]>([]);
	const [running, setRunning] = useState(false);
	const abortRef = useRef<AbortController | null>(null);

	useEffect(() => () => abortRef.current?.abort(), []);

	const push = (row: Omit<LogRow, "seq">) => setRows((current) => [...current, { seq: current.length, ...row }]);

	const consume = async (scenario: KitScenario, signal: AbortSignal) => {
		const client = createKitClient({
			baseUrl: "/mock-kit",
			fetchImpl: () => {
				const body = pacedStream(
					scenario.frames.map((frame) => new TextEncoder().encode(frame)),
					KIT_FRAME_MS,
				);
				return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
			},
		});
		try {
			await client.stream("sess_demo", {
				after: scenario.after,
				signal,
				onReset: () => push({ text: "onReset() —— 游标不可续传，开始重建" }),
				onEvent: (event, cursor) =>
					push({
						text: `onEvent cursor=${cursor} event_id=${event.event_id} type=${event.type}${event.role ? ` role=${event.role}` : ""}`,
						detail: JSON.stringify(event),
					}),
				onReady: ({ sessionId, replayed, cursor }) =>
					push({ text: `onReady sessionId=${sessionId} replayed=${replayed} cursor=${cursor}` }),
				onPing: (t) => push({ tone: "muted", text: `onPing t=${t} —— 每 15s 保活` }),
				onDone: ({ status, lastEventId }) =>
					push({ tone: "muted", text: `onDone status=${status} lastEventId=${lastEventId} —— 流正常关闭` }),
			});
		} catch {
			// 重新运行或卸载导致的取消不需要展示
			return;
		}
	};

	const run = (scenario: KitScenario) => {
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		setRows([
			{
				seq: 0,
				tone: "muted",
				text: `→ GET /mock-kit/api/kit/sessions/sess_demo/stream${scenario.after ? `?after=${scenario.after}` : ""}`,
			},
		]);
		setRunning(true);
		void consume(scenario, controller.signal).finally(() => {
			if (abortRef.current === controller) setRunning(false);
		});
	};

	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col gap-4 bg-[var(--kit-bg)] p-6 text-[var(--kit-fg)]"
		>
			<div className="flex flex-wrap items-center gap-2">
				{KIT_SCENARIOS.map((scenario) => (
					<button
						key={scenario.label}
						type="button"
						onClick={() => run(scenario)}
						disabled={running}
						className={SECONDARY_BTN}
					>
						{scenario.label}
					</button>
				))}
			</div>
			<LogList
				rows={rows}
				placeholder="选择场景建立订阅；transport 自动携带 Accept: text/event-stream 与协议版本头。"
			/>
		</div>
	);
}

const CTRL_READY_MS = 200;
const CTRL_SEND_MS = 300;
const CTRL_PARTIAL_MS = 500;
const CTRL_FULL_MS = 600;
const CTRL_IDLE_MS = 400;

const CTRL_PARTIAL_EVENT = (seq: number) =>
	`{"event_id":"evt_a${seq}","type":"message","role":"assistant","metadata":{"event_status":"in_progress"},"content":[{"type":"text","text":"已读取周报，正在整理要点…"}]}`;
const CTRL_FULL_EVENT = (seq: number) =>
	`{"event_id":"evt_a${seq}","type":"message","role":"assistant","metadata":{"event_status":"completed"},"content":[{"type":"text","text":"已读取周报，整理出三个要点：目标进度、风险与下周计划。"}]}`;
const CTRL_IDLE_EVENT =
	'{"event_id":"evt_s1","type":"session_status","content":[{"type":"data","data":{"session_status":"idle"}}]}';

interface ScriptedProviderHandle {
	provider: ChatProvider;
	dispose: () => void;
}

/** 脚本化五方法 ChatProvider：stream 保持连接，sendMessage 后按时间轴推用户回显、局部、完整与 idle。 */
function createScriptedProvider(): ScriptedProviderHandle {
	const optionsRef: { current: StreamSessionOptions | null } = { current: null };
	const cursorRef = { current: 0 };
	const timers: ReturnType<typeof setTimeout>[] = [];
	const signal = () => optionsRef.current?.signal;
	const emit = (json: string) => {
		cursorRef.current += 1;
		optionsRef.current?.onEvent?.(JSON.parse(json) as SessionEvent, `1:${cursorRef.current}`);
	};
	const schedule = (ms: number, fn: () => void) => {
		const timer = setTimeout(() => {
			timers.splice(timers.indexOf(timer), 1);
			fn();
		}, ms);
		timers.push(timer);
	};
	let sendSeq = 0;
	const provider: ChatProvider = {
		stream: (sessionId, options) => {
			optionsRef.current = options ?? null;
			void (async () => {
				await new Promise((resolve) => setTimeout(resolve, CTRL_READY_MS));
				if (signal()?.aborted) return;
				options?.onReset?.();
				options?.onReady?.({ sessionId, replayed: 0, cursor: "1:0" });
			})();
			return new Promise((resolve) => {
				if (signal()?.aborted) return resolve();
				signal()?.addEventListener("abort", () => resolve(), { once: true });
			});
		},
		sendMessage: async (sessionId, body) => {
			sendSeq += 1;
			const seq = sendSeq;
			await new Promise((resolve) => setTimeout(resolve, CTRL_SEND_MS));
			emit(
				`{"event_id":"evt_u${seq}","type":"message","role":"user","content":[{"type":"text","text":${JSON.stringify(body.text)}}]}`,
			);
			schedule(CTRL_PARTIAL_MS, () => emit(CTRL_PARTIAL_EVENT(seq)));
			schedule(CTRL_PARTIAL_MS + CTRL_FULL_MS, () => emit(CTRL_FULL_EVENT(seq)));
			schedule(CTRL_PARTIAL_MS + CTRL_FULL_MS + CTRL_IDLE_MS, () => emit(CTRL_IDLE_EVENT));
			return { session_id: sessionId, accepted: true, event_ids: [`evt_u${seq}`] };
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

/** SDK 演示：无 React 编排 —— 五方法 mock ChatProvider，观察 connect/send 的 promise 语义与 phase 变化。 */
export function ControllerDemo() {
	const [rows, setRows] = useState<LogRow[]>([]);
	const [text, setText] = useState("帮我总结这份周报");
	const [connected, setConnected] = useState(false);
	const [active, setActive] = useState(false);
	const [busy, setBusy] = useState(false);
	const controllerRef = useRef<ChatController | null>(null);
	const scriptedRef = useRef<ScriptedProviderHandle | null>(null);
	const signatureRef = useRef("");

	useEffect(
		() => () => {
			scriptedRef.current?.dispose();
			controllerRef.current?.dispose();
		},
		[],
	);

	const push = (row: Omit<LogRow, "seq">) => setRows((current) => [...current, { seq: current.length, ...row }]);

	const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

	const ensureController = () => {
		if (controllerRef.current) return controllerRef.current;
		signatureRef.current = "";
		const scripted = createScriptedProvider();
		scriptedRef.current = scripted;
		const controller = createChatController(scripted.provider, "sess_demo");
		const logSnapshot = () => {
			const snapshot = controller.getSnapshot();
			const signature = `${snapshot.connection}|${snapshot.phase}|${snapshot.turnRunning}|${snapshot.canSend}|${snapshot.messages.length}`;
			if (signature === signatureRef.current) return;
			signatureRef.current = signature;
			push({
				tone: "muted",
				text: `snapshot · connection=${snapshot.connection} phase=${snapshot.phase} turnRunning=${snapshot.turnRunning} canSend=${snapshot.canSend} messages=${snapshot.messages.length}`,
			});
		};
		controller.subscribe(logSnapshot);
		logSnapshot();
		controllerRef.current = controller;
		setActive(true);
		return controller;
	};

	const doConnect = async () => {
		const controller = ensureController();
		setBusy(true);
		try {
			await controller.connect();
			setConnected(true);
			push({ text: "connect() resolve —— 订阅就绪，可以发送" });
		} catch (error) {
			push({ tone: "muted", text: `connect() 失败：${errorMessage(error)}` });
		} finally {
			setBusy(false);
		}
	};

	const doSend = async () => {
		const controller = controllerRef.current ?? ensureController();
		setBusy(true);
		try {
			await controller.send(text);
			push({ text: "send() resolve —— 消息已提交；Turn 未结束，继续观察 phase" });
		} catch (error) {
			push({ tone: "muted", text: `send() 失败：${errorMessage(error)}` });
		} finally {
			setBusy(false);
		}
	};

	const doDispose = () => {
		scriptedRef.current?.dispose();
		scriptedRef.current = null;
		controllerRef.current?.dispose();
		controllerRef.current = null;
		setConnected(false);
		setActive(false);
		push({ tone: "muted", text: "dispose() —— 释放订阅与 store；可重新编排" });
	};

	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col gap-4 bg-[var(--kit-bg)] p-6 text-[var(--kit-fg)]"
		>
			<div className="flex flex-wrap items-center gap-2">
				<button type="button" onClick={doConnect} disabled={connected || busy} className={SECONDARY_BTN}>
					{connected ? "已连接" : "connect()"}
				</button>
				<input
					aria-label="消息文本"
					value={text}
					onChange={(event) => setText(event.target.value)}
					className="min-h-8 min-w-0 flex-1 rounded-[var(--kit-radius-sm)] border border-[var(--kit-border-subtle)] bg-[var(--kit-surface)] px-3 text-[length:var(--kit-text-label)] outline-none focus:border-[var(--kit-border)]"
				/>
				<button type="button" onClick={doSend} disabled={busy || text.trim().length === 0} className={PRIMARY_BTN}>
					{busy ? "等待…" : "send()"}
				</button>
				<button type="button" onClick={doDispose} disabled={!active} className={SECONDARY_BTN}>
					dispose()
				</button>
			</div>
			<LogList
				rows={rows}
				placeholder="connect() 等订阅就绪，send() 等消息提交；回答期间 snapshot 的 phase/turnRunning 变化，回到 idle 是一轮结束。"
			/>
		</div>
	);
}

const REQ_SSE_FRAMES = [
	'id: 1\nevent: message\ndata: {"content":"Hel"}\n\n',
	'id: 2\nevent: message\ndata: {"content":"lo Kit"}\n\n',
	"event: done\ndata: [DONE]\n\n",
];
const REQ_STATUS_BODY = '{"available":true,"region":"cn-hangzhou"}';
const REQ_LIMITED_BODY = '{"error":"quota exceeded"}';
const REQ_FRAME_MS = 450;

/** 共享 mock fetch：记录解析后的身份头，按路径返回 JSON / SSE / 429。 */
function createLoggedMockRequest(
	push: PushLog,
	tokenSeq: { current: number },
	mapHttpError?: (response: Response) => Error,
): RequestClient {
	tokenSeq.current += 1;
	const token = `tok-${tokenSeq.current}`;
	return createRequest({
		baseUrl: "/mock-api",
		headers: async () => ({ Authorization: `Bearer ${token}` }),
		mapHttpError,
		fetchImpl: (input, init) => {
			const url = input instanceof Request ? input.url : String(input);
			const authorization = new Headers(init?.headers).get("Authorization") ?? "-";
			push({
				text: `→ GET ${url}`,
				detail: `Authorization: ${authorization}（动态 headers 每次请求重新解析）`,
			});
			if (url.endsWith("/limited"))
				return Promise.resolve(
					new Response(REQ_LIMITED_BODY, { status: 429, headers: { "content-type": "application/json" } }),
				);
			if (url.endsWith("/updates"))
				return Promise.resolve(
					new Response(
						pacedStream(
							REQ_SSE_FRAMES.map((frame) => new TextEncoder().encode(frame)),
							REQ_FRAME_MS,
						),
						{ status: 200, headers: { "content-type": "text/event-stream" } },
					),
				);
			return Promise.resolve(
				new Response(REQ_STATUS_BODY, { status: 200, headers: { "content-type": "application/json" } }),
			);
		},
	});
}

/** SDK 演示：json() 单次读取，动态身份头逐请求重新解析。 */
export function RequestBasicDemo() {
	const [rows, setRows] = useState<LogRow[]>([]);
	const [running, setRunning] = useState(false);
	const tokenSeq = useRef(0);

	const push: PushLog = (row) => setRows((current) => [...current, { seq: current.length, ...row }]);

	const run = () => {
		setRows([]);
		setRunning(true);
		const request = createLoggedMockRequest(push, tokenSeq);
		void request
			.json<unknown>("/status")
			.then((data) => {
				push({ text: "← 200 · json() 解析结果", detail: JSON.stringify(data) });
			})
			.finally(() => setRunning(false));
	};

	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col gap-4 bg-[var(--kit-bg)] p-6 text-[var(--kit-fg)]"
		>
			<div className="flex flex-wrap items-center gap-2">
				<button type="button" onClick={run} disabled={running} className={PRIMARY_BTN}>
					json() /status
				</button>
			</div>
			<LogList rows={rows} placeholder="json() 检查 HTTP 状态后解析 JSON；再点一次可见身份头重新解析。" />
		</div>
	);
}

/** SDK 演示：单次 RequestInit 覆盖同名动态头并合并下发，方法与 body 由调用方显式配置。 */
export function RequestCustomDemo() {
	const [rows, setRows] = useState<LogRow[]>([]);
	const [running, setRunning] = useState(false);

	const push: PushLog = (row) => setRows((current) => [...current, { seq: current.length, ...row }]);

	const run = () => {
		setRows([]);
		setRunning(true);
		const request = createRequest({
			baseUrl: "/mock-api",
			headers: async () => ({ Authorization: "Bearer tok-dynamic" }),
			fetchImpl: (input, init) => {
				const headers = [...new Headers(init?.headers)].map(([name, value]) => `${name}: ${value}`).join(" · ");
				push({ text: `→ ${init?.method ?? "GET"} ${String(input)}`, detail: headers });
				return Promise.resolve(
					new Response('{"received":true}', { status: 200, headers: { "content-type": "application/json" } }),
				);
			},
		});
		void request
			.json<unknown>("/messages", {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: "Bearer tok-call" },
				body: JSON.stringify({ text: "帮我总结周报" }),
			})
			.then((data) => {
				push({ text: "← 200 · json() 解析结果", detail: JSON.stringify(data) });
			})
			.finally(() => setRunning(false));
	};

	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col gap-4 bg-[var(--kit-bg)] p-6 text-[var(--kit-fg)]"
		>
			<div className="flex flex-wrap items-center gap-2">
				<button type="button" onClick={run} disabled={running} className={PRIMARY_BTN}>
					POST /messages
				</button>
			</div>
			<LogList
				rows={rows}
				placeholder="动态头是 Bearer tok-dynamic，单次传入 tok-call 覆盖同名头并新增 Content-Type。"
			/>
		</div>
	);
}

async function consumeRequestStream(
	request: RequestClient,
	signal: AbortSignal,
	push: PushLog,
	onCancelled: () => void,
): Promise<void> {
	let count = 0;
	try {
		for await (const frame of request.stream("/updates", {
			signal,
			headers: { Accept: "text/event-stream" },
		})) {
			count += 1;
			push({
				text: `帧 ${count} · event=${frame.event}${frame.id ? ` · id=${frame.id}` : ""}`,
				detail: `data=${frame.data}`,
			});
		}
		push({ tone: "muted", text: "EOF · stream() 退出时关闭 reader" });
	} catch {
		if (signal.aborted) onCancelled();
	}
}

/** SDK 演示：stream() 委托 Stream 分帧；abort() 取消贯穿 fetch 与读取。 */
export function RequestStreamDemo() {
	const [rows, setRows] = useState<LogRow[]>([]);
	const [running, setRunning] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const tokenSeq = useRef(0);

	useEffect(() => () => abortRef.current?.abort(), []);

	const push: PushLog = (row) => setRows((current) => [...current, { seq: current.length, ...row }]);

	const run = () => {
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		setRows([]);
		setRunning(true);
		const request = createLoggedMockRequest(push, tokenSeq);

		void consumeRequestStream(request, controller.signal, push, () =>
			push({ tone: "muted", text: "AbortError · 取消贯穿 fetch 与读取，迟到帧被丢弃" }),
		).finally(() => {
			if (abortRef.current === controller) setRunning(false);
		});
	};

	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col gap-4 bg-[var(--kit-bg)] p-6 text-[var(--kit-fg)]"
		>
			<div className="flex flex-wrap items-center gap-2">
				<button type="button" onClick={run} disabled={running} className={PRIMARY_BTN}>
					stream() /updates
				</button>
				<button type="button" onClick={() => abortRef.current?.abort()} disabled={!running} className={SECONDARY_BTN}>
					abort()
				</button>
			</div>
			<LogList rows={rows} placeholder="逐帧交付 RawSseMessage；读取中途 abort() 也会关闭 reader。" />
		</div>
	);
}

/** SDK 演示：非成功 HTTP 的默认安全 KitError 与 mapHttpError 自定义映射。 */
export function RequestErrorDemo() {
	const [rows, setRows] = useState<LogRow[]>([]);
	const [running, setRunning] = useState(false);
	const tokenSeq = useRef(0);

	const push: PushLog = (row) => setRows((current) => [...current, { seq: current.length, ...row }]);

	const run = (custom: boolean) => {
		setRows([]);
		setRunning(true);
		const request = createLoggedMockRequest(
			push,
			tokenSeq,
			custom
				? (response) => new KitError("quota_exceeded", "月度配额已用尽", { status: response.status, retryable: false })
				: undefined,
		);
		void request
			.json<unknown>("/limited")
			.catch((error: unknown) => {
				if (error instanceof KitError)
					push({
						text: `← ${error.status} · KitError code=${error.code} retryable=${String(error.retryable)}`,
						detail: error.message,
					});
				else push({ tone: "muted", text: `← 失败：${error instanceof Error ? error.message : String(error)}` });
			})
			.finally(() => setRunning(false));
	};

	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col gap-4 bg-[var(--kit-bg)] p-6 text-[var(--kit-fg)]"
		>
			<div className="flex flex-wrap items-center gap-2">
				<button type="button" onClick={() => run(false)} disabled={running} className={PRIMARY_BTN}>
					默认映射 /limited
				</button>
				<button type="button" onClick={() => run(true)} disabled={running} className={SECONDARY_BTN}>
					mapHttpError /limited
				</button>
			</div>
			<LogList
				rows={rows}
				placeholder="默认映射只保留 HTTP 429 与 retryable；mapHttpError 换成带业务语义的安全错误。"
			/>
		</div>
	);
}

const SESSIONS_AGENT = "report-helper";
const SEED_SESSIONS: SessionSummary[] = [
	{
		session_id: "sess_demo-1",
		agent_slug: SESSIONS_AGENT,
		title: "周报整理",
		created_at: "2026-11-09T09:30:00Z",
		last_event_at: "2026-11-10T18:02:00Z",
	},
	{
		session_id: "sess_demo-2",
		agent_slug: SESSIONS_AGENT,
		title: "数据清洗脚本",
		created_at: "2026-11-08T14:10:00Z",
		last_event_at: "2026-11-09T11:45:00Z",
	},
	{
		session_id: "sess_demo-3",
		agent_slug: SESSIONS_AGENT,
		title: "季度复盘提纲",
		created_at: "2026-11-07T10:00:00Z",
		last_event_at: "2026-11-07T12:20:00Z",
	},
];
const SESSION_ROW_BTN =
	"flex w-full min-h-9 items-center justify-between gap-3 rounded-[var(--kit-radius-sm)] border border-[var(--kit-border-subtle)] bg-[var(--kit-bg)] px-3 text-left text-[length:var(--kit-text-label)] transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:bg-[var(--kit-bg-subtle)]";
const SESSION_ROW_ACTIVE = "border-[var(--kit-accent)]";

/** SDK 演示：mock KitClient 上运行 useSessions —— 查询、创建会话与 reload 刷新，选中交给页面状态。 */
export function SessionsDemo() {
	const [rows, setRows] = useState<LogRow[]>([]);
	const sessionsRef = useRef<SessionSummary[]>(SEED_SESSIONS);
	const seqRef = useRef(SEED_SESSIONS.length);
	const push = useCallback(
		(row: Omit<LogRow, "seq">) => setRows((current) => [...current, { seq: current.length, ...row }]),
		[],
	);

	const fetchImpl = useCallback((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = input instanceof Request ? input.url : String(input);
		if (init?.method === "POST") {
			const body = JSON.parse(String(init.body)) as { agent_slug: string; title?: string };
			seqRef.current += 1;
			const created: SessionSummary = {
				session_id: `sess_demo-${seqRef.current}`,
				agent_slug: body.agent_slug,
				...(body.title ? { title: body.title } : {}),
				created_at: "2026-11-11T10:00:00Z",
			};
			sessionsRef.current = [created, ...sessionsRef.current];
			return Promise.resolve(
				new Response(JSON.stringify({ data: created }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			);
		}
		const query = new URL(url, "http://localhost").searchParams;
		const agentSlug = query.get("agent_slug");
		const data = sessionsRef.current.filter((session) => !agentSlug || session.agent_slug === agentSlug);
		return Promise.resolve(
			new Response(JSON.stringify({ data, next_page_token: null }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
	}, []);

	const client = useMemo(
		() =>
			createKitClient({
				baseUrl: "/mock-kit",
				fetchImpl: (input, init) => {
					if (init?.method === "POST") push({ text: "→ POST /api/kit/sessions（createSession）" });
					else push({ text: `→ GET /api/kit/sessions?agent_slug=${SESSIONS_AGENT}` });
					return fetchImpl(input, init);
				},
			}),
		[fetchImpl, push],
	);

	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col gap-4 bg-[var(--kit-bg)] p-6 text-[var(--kit-fg)]"
		>
			<KitProvider client={client}>
				<SessionsPanel push={push} />
			</KitProvider>
			<LogList rows={rows} placeholder="hook 挂载即查询；新建会话由 useKitClient 完成，成功后 reload() 刷新列表。" />
		</div>
	);
}

function SessionsPanel({ push }: { push: (row: Omit<LogRow, "seq">) => void }) {
	const client = useKitClient();
	const { sessions, loading, reload } = useSessions({ agentSlug: SESSIONS_AGENT });
	const [activeId, setActiveId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const loadedRef = useRef(false);

	useEffect(() => {
		if (loading) return;
		push(
			loadedRef.current
				? { text: `reload() 完成 · ${sessions.length} 条会话` }
				: {
						tone: "muted",
						text: `首次加载完成 · ${sessions.length} 条会话（useSessions({ agentSlug: "${SESSIONS_AGENT}" })）`,
					},
		);
		loadedRef.current = true;
	}, [loading, sessions.length, push]);

	const create = async () => {
		setCreating(true);
		try {
			const session = await client.createSession({ agentSlug: SESSIONS_AGENT, title: "线上问题排查" });
			setActiveId(session.session_id);
			push({ text: `createSession() → ${session.session_id}，选中并 reload()` });
			reload();
		} finally {
			setCreating(false);
		}
	};

	return (
		<div className="flex min-h-0 flex-col gap-3">
			<div className="max-h-44 shrink-0 overflow-y-auto rounded-[var(--kit-radius)] border border-[var(--kit-border-subtle)] bg-[var(--kit-surface)] p-3">
				{loading ? (
					<p role="status" className="text-[length:var(--kit-text-label)] text-[var(--kit-fg-muted)]">
						正在加载会话…
					</p>
				) : (
					<ul className="flex flex-col gap-2">
						{sessions.map((session) => (
							<li key={session.session_id}>
								<button
									type="button"
									aria-current={session.session_id === activeId ? "true" : undefined}
									onClick={() => {
										setActiveId(session.session_id);
										push({ text: `选中 ${session.session_id} —— 选中状态由页面或路由保存` });
									}}
									className={`${SESSION_ROW_BTN} ${session.session_id === activeId ? SESSION_ROW_ACTIVE : ""}`}
								>
									<span className="truncate">{session.title || "未命名会话"}</span>
									<code className="shrink-0 font-mono text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)]">
										{session.session_id}
									</code>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
			<button type="button" onClick={() => void create()} disabled={creating} className={PRIMARY_BTN}>
				{creating ? "正在创建…" : "新建会话（createSession + reload）"}
			</button>
		</div>
	);
}

const USE_CHAT_SESSION_ID = "sess_demo";

function StatusChip({ label, value }: { label: string; value: string }) {
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--kit-border-subtle)] bg-[var(--kit-surface)] px-2.5 py-0.5 text-[length:var(--kit-text-meta)]">
			<span className="text-[var(--kit-fg-muted)]">{label}</span>
			<code className="font-mono text-[var(--kit-fg)]">{value}</code>
		</span>
	);
}

/** SDK 演示：同一份脚本化 Provider 接进 React —— useChat 交付 messages 与状态，Sender 触发一轮。 */
export function UseChatDemo() {
	const [scripted] = useState(() => createScriptedProvider());
	const cleanupEpoch = useRef(0);
	useEffect(() => {
		const epoch = ++cleanupEpoch.current;
		// StrictMode 假卸载会跑 cleanup，但控制器存活仍使用同一 Provider；只有真实卸载才释放。
		return () => {
			queueMicrotask(() => {
				if (cleanupEpoch.current === epoch) scripted.dispose();
			});
		};
	}, [scripted]);
	const chat = useChat({ sessionId: USE_CHAT_SESSION_ID, provider: scripted.provider });
	const [draft, setDraft] = useState("帮我总结这份周报");

	const send = async (message: string) => {
		const text = message.trim();
		if (!text || !chat.canSend) return;
		await chat.send(text);
		setDraft((current) => (current === text ? "" : current));
	};

	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col gap-3 bg-[var(--kit-bg)] p-6 text-[var(--kit-fg)]"
		>
			<div className="flex flex-wrap items-center gap-2">
				<StatusChip label="connection" value={chat.connection} />
				<StatusChip label="phase" value={chat.phase} />
				<StatusChip label="canSend" value={String(chat.canSend)} />
				<StatusChip label="turnRunning" value={String(chat.turnRunning)} />
			</div>
			<div className="relative min-h-0 flex-1">
				<div className="absolute inset-0">
					<MessageList
						variant="workspace"
						messages={chat.messages}
						scrollKey={USE_CHAT_SESSION_ID}
						autoScroll
						empty={<EmptyState title="useChat 就绪" hint="发送一条消息，观察状态行与消息流" />}
					/>
				</div>
			</div>
			{chat.streamError ? (
				<p role="alert" className="text-[length:var(--kit-text-label)] text-[var(--kit-danger)]">
					{chat.streamError.message}
				</p>
			) : null}
			<Sender
				value={draft}
				onChange={setDraft}
				loading={chat.turnRunning}
				submitDisabled={!chat.canSend}
				onSubmit={(message) => void send(message)}
				onCancel={() => void chat.stop()}
			/>
		</div>
	);
}

const APPROVAL_BATCH = "batch-1";
const APPROVAL_CALL = "call-1";
const APPROVAL_TOOL_NAME = "delete_file";
const APPROVAL_TOOL_ARGS = { path: "周报草稿.md" };
const APPROVAL_REQUEST_MS = 400;
const APPROVAL_PAUSE_MS = 400;
const APPROVAL_RESUME_MS = 400;
const APPROVAL_DONE_MS = 400;

interface ApprovalProviderHandle {
	provider: ChatProvider;
	dispose: () => void;
}

/** 审批脚本 Provider：发送后进入 requires_action，提交后按决策继续执行或取消。 */
function createApprovalProvider(): ApprovalProviderHandle {
	const optionsRef: { current: StreamSessionOptions | null } = { current: null };
	const cursorRef = { current: 0 };
	const timers: ReturnType<typeof setTimeout>[] = [];
	let sendSeq = 0;
	let approvalPending = false;
	const signal = () => optionsRef.current?.signal;
	const emit = (json: string) => {
		cursorRef.current += 1;
		optionsRef.current?.onEvent?.(JSON.parse(json) as SessionEvent, `1:${cursorRef.current}`);
	};
	const schedule = (ms: number, fn: () => void) => {
		const timer = setTimeout(() => {
			timers.splice(timers.indexOf(timer), 1);
			fn();
		}, ms);
		timers.push(timer);
	};
	const assistantCompleted = (eventId: string, text: string) =>
		`{"event_id":"${eventId}","type":"message","role":"assistant","metadata":{"event_status":"completed"},"content":[{"type":"text","text":${JSON.stringify(text)}}]}`;
	const provider: ChatProvider = {
		stream: (sessionId, options) => {
			optionsRef.current = options ?? null;
			void (async () => {
				await new Promise((resolve) => setTimeout(resolve, CTRL_READY_MS));
				if (signal()?.aborted) return;
				options?.onReset?.();
				options?.onReady?.({ sessionId, replayed: 0, cursor: "1:0" });
			})();
			return new Promise((resolve) => {
				if (signal()?.aborted) return resolve();
				signal()?.addEventListener("abort", () => resolve(), { once: true });
			});
		},
		sendMessage: async (sessionId, body) => {
			sendSeq += 1;
			const seq = sendSeq;
			approvalPending = true;
			await new Promise((resolve) => setTimeout(resolve, CTRL_SEND_MS));
			emit(
				`{"event_id":"evt_u${seq}","type":"message","role":"user","content":[{"type":"text","text":${JSON.stringify(body.text)}}]}`,
			);
			schedule(APPROVAL_REQUEST_MS, () =>
				emit(
					`{"event_id":"evt_t${seq}","type":"tool_approval_request","content":[{"type":"data","data":{"batch_id":"${APPROVAL_BATCH}","call_id":"${APPROVAL_CALL}","name":"${APPROVAL_TOOL_NAME}","arguments":${JSON.stringify(APPROVAL_TOOL_ARGS)},"tool_type":"builtin"}}]}`,
				),
			);
			schedule(APPROVAL_REQUEST_MS + APPROVAL_PAUSE_MS, () =>
				emit(
					`{"event_id":"evt_s${seq}","type":"session_status","content":[{"type":"data","data":{"session_status":"idle","stop_reason":{"type":"requires_action","pending_batch_id":"${APPROVAL_BATCH}","pending_call_ids":["${APPROVAL_CALL}"]}}}]}`,
				),
			);
			return { session_id: sessionId, accepted: true, event_ids: [`evt_u${seq}`] };
		},
		toolApprovals: async () => {
			if (!approvalPending) return { requires_action: false, batch_id: null, pending_call_ids: [], requests: [] };
			return {
				requires_action: true,
				batch_id: APPROVAL_BATCH,
				pending_call_ids: [APPROVAL_CALL],
				requests: [
					{
						batch_id: APPROVAL_BATCH,
						call_id: APPROVAL_CALL,
						request_event_id: `evt_t${sendSeq}`,
						name: APPROVAL_TOOL_NAME,
						arguments: APPROVAL_TOOL_ARGS,
						tool_type: "builtin",
						actionable: true,
						status: "pending",
					},
				],
			};
		},
		submitToolApproval: async (sessionId, decision) => {
			approvalPending = false;
			const seq = sendSeq;
			const reply = decision.result === "allow" ? "已删除周报草稿.md。" : "已取消删除，周报草稿保留。";
			schedule(APPROVAL_RESUME_MS, () => emit(assistantCompleted(`evt_r${seq}`, reply)));
			schedule(APPROVAL_RESUME_MS + APPROVAL_DONE_MS, () => emit(CTRL_IDLE_EVENT));
			return { session_id: sessionId, accepted: true, event_ids: [`evt_r${seq}`] };
		},
		interrupt: async () => ({ interrupted: true }),
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

/** SDK 演示：真实 useChat 审批编排 —— requires_action 挂起，卡片允许或拒绝后 Turn 恢复到 idle。 */
export function ApprovalDemo() {
	const [scripted] = useState(() => createApprovalProvider());
	const cleanupEpoch = useRef(0);
	useEffect(() => {
		const epoch = ++cleanupEpoch.current;
		// StrictMode 假卸载会跑 cleanup，但控制器存活仍使用同一 Provider；只有真实卸载才释放。
		return () => {
			queueMicrotask(() => {
				if (cleanupEpoch.current === epoch) scripted.dispose();
			});
		};
	}, [scripted]);
	const chat = useChat({ sessionId: USE_CHAT_SESSION_ID, provider: scripted.provider });
	const [draft, setDraft] = useState("帮我删除周报草稿.md");

	const send = async (message: string) => {
		const text = message.trim();
		if (!text || !chat.canSend) return;
		await chat.send(text);
		setDraft((current) => (current === text ? "" : current));
	};

	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col gap-3 bg-[var(--kit-bg)] p-6 text-[var(--kit-fg)]"
		>
			<div className="flex flex-wrap items-center gap-2">
				<StatusChip label="connection" value={chat.connection} />
				<StatusChip label="phase" value={chat.phase} />
				<StatusChip label="canSend" value={String(chat.canSend)} />
				<StatusChip label="turnRunning" value={String(chat.turnRunning)} />
			</div>
			<div className="relative min-h-0 flex-1">
				<div className="absolute inset-0">
					<MessageList
						variant="workspace"
						messages={chat.messages}
						scrollKey={USE_CHAT_SESSION_ID}
						autoScroll
						approvals={chat.approvals.map((approval) => (
							<ToolApprovalCard
								key={approval.call_id}
								approval={approval}
								onDecision={chat.submitApproval}
								onRefresh={chat.refreshApprovals}
							/>
						))}
						empty={<EmptyState title="审批演示就绪" hint="发送一条会触发工具调用的消息" />}
					/>
				</div>
			</div>
			{chat.streamError ? (
				<p role="alert" className="text-[length:var(--kit-text-label)] text-[var(--kit-danger)]">
					{chat.streamError.message}
				</p>
			) : null}
			<Sender
				value={draft}
				onChange={setDraft}
				loading={chat.turnRunning}
				submitDisabled={!chat.canSend}
				onSubmit={(message) => void send(message)}
				onCancel={() => void chat.stop()}
			/>
		</div>
	);
}
