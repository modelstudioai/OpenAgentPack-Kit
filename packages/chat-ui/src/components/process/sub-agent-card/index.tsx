import type { ChatAgentThread, ChatMultiAgent } from "@openagentpack/kit-sdk/chat";
import type { ChatMessage, MessagePart } from "@openagentpack/kit-sdk/messages";
import { useEffect, useState } from "react";
import { FileCard } from "../../file-card/index.tsx";
import { Markdown } from "../../markdown/index.tsx";
import { ReasoningBlock } from "../reasoning-block/index.tsx";
import { ToolCallCard } from "../tool-call-card/index.tsx";

export function formatDuration(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	if (total < 60) return `${total}s`;
	const minutes = Math.floor(total / 60);
	if (minutes < 60) return `${minutes}m${total % 60}s`;
	return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

type ArtifactPart = Extract<MessagePart, { type: "artifact" }>;

/** 子线程产物行：与主消息 ArtifactCard 同合同——点名称打开预览、并列下载入口。 */
function ArtifactRow({
	artifact,
	className,
	onArtifactDownload,
	onArtifactOpen,
}: {
	artifact: ArtifactPart["artifact"];
	className?: string;
	onArtifactDownload?: (fileId: string) => void;
	onArtifactOpen?: (fileId: string, contentType?: string) => void;
}) {
	return (
		<FileCard
			name={artifact.filename ?? artifact.file_id}
			type={artifact.content_type}
			onClick={onArtifactOpen ? () => onArtifactOpen(artifact.file_id, artifact.content_type) : undefined}
			onDownload={onArtifactDownload ? () => onArtifactDownload(artifact.file_id) : undefined}
			className={className}
		/>
	);
}

const loadMoreClass =
	"rounded-[var(--kit-radius-sm)] px-2 py-1 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)] transition-colors hover:bg-[var(--kit-bg-subtle)] hover:text-[var(--kit-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] disabled:cursor-not-allowed disabled:opacity-50";

/** 子线程消息的时间线行：思考/工具复用既有步骤行，正文与产物按各自形态展开。 */
export function StepRows({
	messages,
	onArtifactDownload,
	onArtifactOpen,
}: {
	messages: ChatMessage[];
	onArtifactDownload?: (fileId: string) => void;
	onArtifactOpen?: (fileId: string, contentType?: string) => void;
}) {
	const rows = messages.flatMap((message) =>
		message.parts.map((part, index) => ({ part, key: part.id ?? `${message.id}:${index}` })),
	);
	return (
		<>
			{rows.map(({ part, key }) => {
				if (part.type === "reasoning") return <ReasoningBlock key={key} text={part.text} status={part.status} />;
				if (part.type === "tool") return <ToolCallCard key={key} part={part} />;
				if (part.type === "artifact")
					return (
						<ArtifactRow
							key={key}
							artifact={part.artifact}
							className="my-1"
							onArtifactDownload={onArtifactDownload}
							onArtifactOpen={onArtifactOpen}
						/>
					);
				if (part.type === "status")
					return (
						<p key={key} className="px-2 py-1.5 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
							{part.text}
						</p>
					);
				if (part.type === "text" && part.text.trim())
					return (
						<div key={key} className="px-2 py-1.5">
							<Markdown>{part.text}</Markdown>
						</div>
					);
				return null;
			})}
		</>
	);
}

const TERMINAL = new Set(["idle", "terminated"]);

/** 运行中判定：非失败且未达终态；状态未知时按进行中呈现（摘要未回前先给进行中文案）。 */
export function isThreadRunning(status: string | null): boolean {
	return status !== "failed" && !TERMINAL.has(status ?? "");
}

/** 卡头状态段：内联跟随任务摘要，失败标红、终态带耗时、运行中逐秒计时（Qoder 形态无动画点）。 */
function HeadStatus({
	status,
	elapsed,
	duration,
}: {
	status: string | null;
	elapsed: string | null;
	duration: string | null;
}) {
	const failed = status === "failed";
	const done = !failed && TERMINAL.has(status ?? "");
	const label = failed
		? "执行出错"
		: done
			? duration
				? `已完成 · ${duration}`
				: "已完成"
			: elapsed
				? `正在执行 ${elapsed}`
				: "正在执行";
	return (
		<span
			className={`shrink-0 text-[length:var(--kit-text-caption)] ${failed ? "text-[var(--kit-danger)]" : "text-[var(--kit-fg-muted)]"}`}
		>
			{`· ${label}`}
		</span>
	);
}

/** 时间线尾部状态块：失败重试 / 加载中 / 空态 / 翻页加载；卡内嵌时间线与右栏任务弹窗共用。 */
export function ThreadEventStates({
	thread,
	threadId,
	multiAgent,
}: {
	thread: ChatAgentThread;
	threadId: string;
	multiAgent: ChatMultiAgent;
}) {
	return (
		<>
			{thread.error ? (
				<p
					role="alert"
					className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-[length:var(--kit-text-label)] text-[var(--kit-danger)]"
				>
					消息加载失败：{thread.error}
					<button
						type="button"
						className={loadMoreClass}
						disabled={thread.loading}
						onClick={() => void multiAgent.loadThreadEvents(threadId, { retry: true })}
					>
						重试
					</button>
				</p>
			) : null}
			{!thread.loaded && thread.loading ? (
				<p role="status" className="px-2 py-1.5 text-[length:var(--kit-text-label)] text-[var(--kit-fg-muted)]">
					正在加载 Agent 消息…
				</p>
			) : null}
			{thread.loaded && thread.messages.length === 0 ? (
				<p className="px-2 py-1.5 text-[length:var(--kit-text-label)] text-[var(--kit-fg-muted)]">
					{thread.historyAvailable ? "此 Agent 暂无消息" : "仅显示本次连接收到的消息"}
				</p>
			) : null}
			{thread.nextPageToken ? (
				<button
					type="button"
					className={`ml-2 ${loadMoreClass}`}
					disabled={thread.loading}
					onClick={() => void multiAgent.loadThreadEvents(threadId, { more: true })}
				>
					{thread.loading ? "正在加载 Agent 消息…" : "加载更早消息"}
				</button>
			) : null}
		</>
	);
}

/** 展开体：时间线行 + 加载/错误/空态与翻页；纯缩进对齐卡头文字，不加竖线边框。 */
function CardBody({
	thread,
	threadId,
	multiAgent,
	onArtifactDownload,
	onArtifactOpen,
}: {
	thread: ChatAgentThread;
	threadId: string;
	multiAgent: ChatMultiAgent;
	onArtifactDownload?: (fileId: string) => void;
	onArtifactOpen?: (fileId: string, contentType?: string) => void;
}) {
	return (
		<div className="mt-0.5 mb-1 ml-5 max-h-[var(--kit-sub-agent-body-height)] min-w-0 overflow-y-auto pl-3">
			{thread.task ? (
				<p className="px-2 py-1.5 text-[length:var(--kit-text-label)] leading-[var(--kit-leading-body)] whitespace-pre-wrap [overflow-wrap:anywhere]">
					<span className="text-[var(--kit-fg-muted)]">主 Agent 指令：</span>
					{thread.task}
				</p>
			) : null}
			<StepRows messages={thread.messages} onArtifactDownload={onArtifactDownload} onArtifactOpen={onArtifactOpen} />
			<ThreadEventStates thread={thread} threadId={threadId} multiAgent={multiAgent} />
		</div>
	);
}

/**
 * 子 Agent 卡：thread_created 分片在主消息流的落点。卡头状态与耗时来自 multiAgent
 * 快照（事件推导），展开后内嵌该子线程的时间线；未接 multiAgent 的宿主不渲染。
 */
export function SubAgentCard({
	threadId,
	multiAgent,
	onArtifactDownload,
	onArtifactOpen,
}: {
	threadId: string;
	multiAgent?: ChatMultiAgent;
	onArtifactDownload?: (fileId: string) => void;
	onArtifactOpen?: (fileId: string, contentType?: string) => void;
}) {
	const thread = multiAgent?.threads.find((item) => item.id === threadId);
	const running = !!thread && isThreadRunning(thread.status);
	// 运行中逐秒推进，驱动「正在执行 Ns」实时计时。
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!running) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [running]);
	// 运行中自动展开并补拉历史；完成后自动收起，用户手动展开由 onToggle 接管加载。
	useEffect(() => {
		if (!running || !multiAgent || !thread) return;
		if (!thread.historyAvailable || thread.loaded || thread.loading || thread.error) return;
		void multiAgent.loadThreadEvents(threadId);
	}, [running, multiAgent, thread, threadId]);
	if (!multiAgent || !thread) return null;
	const duration =
		thread.createdAt && thread.endedAt
			? formatDuration(Date.parse(thread.endedAt) - Date.parse(thread.createdAt))
			: null;
	const elapsed = running && thread.createdAt ? formatDuration(Math.max(0, now - Date.parse(thread.createdAt))) : null;
	return (
		<details
			open={running}
			onToggle={(event) => {
				if (!event.currentTarget.open || !thread) return;
				if (!thread.historyAvailable || thread.loaded || thread.loading || thread.error) return;
				void multiAgent.loadThreadEvents(threadId);
			}}
			aria-label={`子 Agent ${thread.name}`}
			className="kit-collapse group/sub my-1 min-w-0 text-[length:var(--kit-text-label)] animate-[var(--kit-animate-in)]"
		>
			<summary className="flex min-w-0 cursor-pointer list-none items-center gap-5 rounded-[var(--kit-radius-sm)] px-2 py-1.5 text-[var(--kit-fg-muted)] transition-colors select-none hover:bg-[var(--kit-bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] [&::-webkit-details-marker]:hidden">
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					aria-hidden="true"
					className={`size-4.5 shrink-0 transition-colors ${running ? "text-[var(--kit-accent)]" : "text-[var(--kit-fg-muted)]"}`}
				>
					<path strokeLinecap="round" strokeLinejoin="round" d="M12 8V4H8" />
					<rect x="4" y="8" width="16" height="12" rx="2" />
					<path strokeLinecap="round" strokeLinejoin="round" d="M2 14h2M20 14h2M15 13v2M9 13v2" />
				</svg>
				<span className="shrink-0 rounded-[var(--kit-radius-xs)] border border-[var(--kit-border)] px-1.5 py-px text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
					子 Agent
				</span>
				<span className="min-w-0 truncate text-[var(--kit-fg)]">
					{thread.name}
					{thread.task ? <span className="text-[var(--kit-fg-muted)]">{` · ${thread.task}`}</span> : null}
				</span>
				<HeadStatus status={thread.status} elapsed={elapsed} duration={duration} />
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					aria-hidden="true"
					className="size-4 shrink-0 text-[var(--kit-fg-muted)] transition-transform group-open/sub:rotate-180"
				>
					<path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
				</svg>
			</summary>
			<CardBody
				thread={thread}
				threadId={threadId}
				multiAgent={multiAgent}
				onArtifactDownload={onArtifactDownload}
				onArtifactOpen={onArtifactOpen}
			/>
		</details>
	);
}
