import type { ChatMultiAgent } from "@openagentpack/kit-sdk/chat";
import type { ChatMessage, MessagePart } from "@openagentpack/kit-sdk/messages";
import { parseSkillDirective } from "@openagentpack/kit-sdk/protocol";
import type { ReactNode } from "react";
import { Actions } from "../actions/index.tsx";
import { ArtifactCard } from "../artifact-card/index.tsx";
import { FileCard } from "../file-card/index.tsx";
import { Markdown } from "../markdown/index.tsx";
import { ExecutionGroup, isProcessPart, type ProcessPart } from "../process/execution-group/index.tsx";
import { SubAgentCard } from "../process/sub-agent-card/index.tsx";
import { ProcessingIndicator } from "../processing-indicator/index.tsx";
import { SkillGlyph } from "../sender/index.tsx";

export { ArtifactCard } from "../artifact-card/index.tsx";
export { ReasoningBlock } from "../process/reasoning-block/index.tsx";
export { ToolCallCard } from "../process/tool-call-card/index.tsx";
export { ProcessingIndicator } from "../processing-indicator/index.tsx";

function displayValue(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return "内容无法序列化";
	}
}

export type MessageProps = {
	message: ChatMessage;
	/** workspace 使用右侧用户气泡与无外框的助手正文；默认保留双气泡。 */
	variant?: "default" | "workspace";
	onArtifactDownload?: (fileId: string) => void;
	/** 产物卡主操作（点名称打开预览）；与 onArtifactDownload 并列，缺一该入口不渲染。 */
	onArtifactOpen?: (fileId: string, contentType?: string) => void;
	onCopy?: (text: string) => void | Promise<void>;
	/** 子 Agent 卡的实时状态源；省略时不渲染 sub-agent 分片。 */
	multiAgent?: ChatMultiAgent;
	/** 当前 Agent 已绑定技能名；提供时用户气泡正文按协议 token 原位穿插还原技能 chip。 */
	skills?: string[];
};

/** 用户气泡正文：按已知技能名解析协议 token，在原位穿插还原技能 chip（ADR-0016）；
 * 未知名 token 与手打的未知 `/foo` 按原文显示，名单缺失时整段纯文本。键位按内容+出现序，
 * 不用数组序。 */
function UserText({ text, skills }: { text: string; skills?: string[] }) {
	const segments = skills?.length ? parseSkillDirective(text, skills) : null;
	if (!segments || segments.every((segment) => segment.kind === "text"))
		return <div className="whitespace-pre-wrap">{text}</div>;
	const counters = new Map<string, number>();
	return (
		<div className="whitespace-pre-wrap">
			{segments.map((segment) => {
				const base = segment.kind === "skill" ? `skill:${segment.name}` : `text:${segment.value}`;
				const occurrence = counters.get(base) ?? 0;
				counters.set(base, occurrence + 1);
				return segment.kind === "skill" ? (
					<span
						key={`${base}#${occurrence}`}
						className="inline-flex items-center gap-1 rounded-[var(--kit-radius-chip)] bg-[var(--kit-skill-chip-bg)] px-2 py-0.5 align-baseline text-[length:var(--kit-text-label)] font-medium text-[var(--kit-skill-chip-fg)]"
					>
						<SkillGlyph className="size-3.5" />
						{segment.name}
					</span>
				) : (
					<span key={`${base}#${occurrence}`}>{segment.value}</span>
				);
			})}
		</div>
	);
}

function MessageShell({
	role,
	variant,
	children,
	footer,
}: {
	role: ChatMessage["role"];
	variant: MessageProps["variant"];
	children: ReactNode;
	/** 绝对定位在气泡下方的悬停操作行；不占布局高度，悬停面是整行（group 挂在外层）。 */
	footer?: ReactNode;
}) {
	const surface =
		variant === "workspace"
			? role === "user"
				? "max-w-[85%] rounded-[var(--kit-radius)] bg-[var(--kit-user-bubble)] px-4 py-3 sm:max-w-[75%]"
				: "w-full"
			: `max-w-[78ch] rounded-[var(--kit-radius)] border border-[var(--kit-border)] px-4 py-3 ${role === "user" ? "bg-[var(--kit-user-bubble)]" : "bg-[var(--kit-assistant-bubble)]"}`;
	return (
		<div
			className={`group/message relative flex min-w-0 ${variant === "workspace" ? "" : "my-2"} ${role === "user" ? "justify-end" : "justify-start"}`}
		>
			<div
				className={`min-w-0 text-[length:var(--kit-text-body)] leading-[var(--kit-leading-body)] [overflow-wrap:anywhere] ${surface}`}
			>
				{children}
			</div>
			{footer}
		</div>
	);
}

function MessageStatus({ status, role }: { status: ChatMessage["status"]; role: ChatMessage["role"] }) {
	if (status === "pending")
		return <span className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">发送中…</span>;
	if (status === "failed")
		return (
			<span className="text-[length:var(--kit-text-caption)] text-[var(--kit-danger)]">
				{role === "user" ? "发送失败" : "生成失败"}
			</span>
		);
	if (status === "interrupted")
		return <span className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">已中断</span>;
	return null;
}

/** 悬停显隐参数：token 过渡 + 键盘聚焦到行内时同显 + reduced-motion 降级；MessageTime 与用户消息操作行共用。 */
const HOVER_REVEAL =
	"opacity-0 transition-opacity duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] group-hover/message:opacity-100 group-focus-within/message:opacity-100 motion-reduce:transition-none";

/** 消息时间文本：本地时区 yyyy-mm-dd HH:mm（拍板格式），显式拼接不随宿主 locale 漂移。 */
function formatMessageTime(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 消息时间：跟在复制按钮后，悬停消息时淡入；无效时间不渲染。 */
function MessageTime({ createdAt }: { createdAt: string }) {
	const date = new Date(createdAt);
	if (Number.isNaN(date.getTime())) return null;
	return (
		<time
			dateTime={createdAt}
			className={`text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)] ${HOVER_REVEAL}`}
		>
			{formatMessageTime(date)}
		</time>
	);
}

function RenderPart({
	part,
	role,
	onArtifactDownload,
	onArtifactOpen,
	multiAgent,
	skills,
}: {
	part: MessagePart;
	role: ChatMessage["role"];
	onArtifactDownload?: (fileId: string) => void;
	onArtifactOpen?: (fileId: string, contentType?: string) => void;
	multiAgent?: ChatMultiAgent;
	skills?: string[];
}) {
	if (part.type === "text")
		return role === "user" ? <UserText text={part.text} skills={skills} /> : <Markdown>{part.text}</Markdown>;
	if (part.type === "sub-agent")
		return (
			<SubAgentCard
				threadId={part.threadId}
				multiAgent={multiAgent}
				onArtifactDownload={onArtifactDownload}
				onArtifactOpen={onArtifactOpen}
			/>
		);
	if (part.type === "artifact")
		return (
			<ArtifactCard
				filename={part.artifact.filename ?? part.artifact.file_id}
				contentType={part.artifact.content_type}
				onOpen={onArtifactOpen ? () => onArtifactOpen(part.artifact.file_id, part.artifact.content_type) : undefined}
				onDownload={onArtifactDownload ? () => onArtifactDownload(part.artifact.file_id) : undefined}
			/>
		);
	// 用户消息的附件卡与输入框附件同款；上传件不提供下载入口（本地已有原件），下载只给 artifact。
	if (part.type === "attachment") return <FileCard name={part.file.filename ?? part.file.file_id} className="mb-1.5" />;
	if (part.type === "unknown")
		return (
			<details className="my-2 text-[length:var(--kit-text-label)] text-[var(--kit-fg-muted)]">
				<summary className="cursor-pointer">未识别内容：{part.label}</summary>
				<pre className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{displayValue(part.value)}</pre>
			</details>
		);
	if (part.type === "status")
		return <div className="my-1 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">{part.text}</div>;
	return null;
}

type RenderItem = { kind: "part"; part: MessagePart } | { kind: "run"; parts: ProcessPart[]; ended: boolean };

/** 连续的思考/工具分片折成一个执行容器；正文与其他分片打断分组，并标记该组执行已被正文终结。 */
function groupProcessRuns(parts: MessagePart[]): RenderItem[] {
	const items: RenderItem[] = [];
	let run: Extract<RenderItem, { kind: "run" }> | null = null;
	for (const part of parts) {
		if (isProcessPart(part)) {
			if (!run) {
				run = { kind: "run", parts: [], ended: false };
				items.push(run);
			}
			run.parts.push(part);
		} else {
			if (run) run.ended = true;
			run = null;
			items.push({ kind: "part", part });
		}
	}
	return items;
}

function copyableText(message: ChatMessage): string {
	return message.parts
		.filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("");
}

function MessageContent({ message, onArtifactDownload, onArtifactOpen, onCopy, multiAgent, skills }: MessageProps) {
	const text = copyableText(message);
	// 只拼接相邻同类文本，既保留 Markdown 分片，也不跨工具/文件重排内容。
	const parts: MessagePart[] = [];
	for (const part of message.parts) {
		const previous = parts.at(-1);
		if (part.type === "text" && previous?.type === "text") previous.text += part.text;
		else if (part.type === "reasoning" && previous?.type === "reasoning") {
			previous.text += part.text;
			previous.status = part.status;
		} else parts.push({ ...part });
	}
	const streaming = message.status === "streaming";
	return (
		<>
			{groupProcessRuns(parts).map((item, index) =>
				item.kind === "run" ? (
					<ExecutionGroup
						key={item.parts[0]?.id ?? `run:${index}`}
						parts={item.parts}
						createdAt={message.createdAt}
						messageStreaming={streaming}
						ended={item.ended}
					/>
				) : (
					// 分片新增挂载时一次性淡入；分片 id 稳定，快照替换复用同一 DOM，不会重放动画。
					<div key={item.part.id ?? `${message.id}:${index}`} className="animate-[var(--kit-animate-overlay-in)]">
						<RenderPart
							part={item.part}
							role={message.role}
							onArtifactDownload={onArtifactDownload}
							onArtifactOpen={onArtifactOpen}
							multiAgent={multiAgent}
							skills={skills}
						/>
					</div>
				),
			)}
			{message.role === "assistant" && streaming ? <ProcessingIndicator /> : null}
			{message.role === "assistant" && message.status === "done" && text.trim() ? (
				<Actions aria-label="消息操作" className="mt-2">
					<Actions.Copy text={text} onCopy={onCopy} />
					{message.createdAt ? <MessageTime createdAt={message.createdAt} /> : null}
				</Actions>
			) : null}
		</>
	);
}

export function Message({
	message,
	variant = "default",
	onArtifactDownload,
	onArtifactOpen,
	onCopy,
	multiAgent,
	skills,
}: MessageProps) {
	// streaming 的指示由 MessageContent 末尾的「生成中…」行承担，顶部不再重复。
	const showsStatus = message.status !== "done" && message.status !== "streaming";
	const status = <MessageStatus status={message.status} role={message.role} />;
	// 用户消息的悬停操作行挂在气泡下方（绝对定位不占气泡高度）；复制原文与时间整体淡入。
	const text = copyableText(message);
	const userFooter =
		message.role === "user" && message.status === "done" && text.trim() ? (
			<Actions aria-label="消息操作" className={`absolute top-full right-0 z-10 pt-1 ${HOVER_REVEAL}`}>
				<Actions.Copy text={text} onCopy={onCopy} iconOnly />
				{message.createdAt ? <MessageTime createdAt={message.createdAt} /> : null}
			</Actions>
		) : null;
	// workspace 用户消息分两块展示：附件卡独立右对齐、正文独占气泡；default 变体保持附件在气泡内。
	if (variant === "workspace" && message.role === "user" && message.parts.some((part) => part.type === "attachment")) {
		const attachments = message.parts.filter(
			(part): part is Extract<MessagePart, { type: "attachment" }> => part.type === "attachment",
		);
		const body: ChatMessage = { ...message, parts: message.parts.filter((part) => part.type !== "attachment") };
		return (
			<div className="flex min-w-0 flex-col gap-1.5">
				<div className="ml-auto flex max-w-[85%] flex-wrap animate-[var(--kit-animate-overlay-in)] justify-end gap-1.5 sm:max-w-[75%]">
					{attachments.map((part) => (
						<FileCard key={part.id ?? part.file.file_id} name={part.file.filename ?? part.file.file_id} />
					))}
				</div>
				<MessageShell role={message.role} variant="workspace" footer={userFooter}>
					{showsStatus ? <div className="mb-2">{status}</div> : null}
					<MessageContent
						message={body}
						onArtifactDownload={onArtifactDownload}
						onArtifactOpen={onArtifactOpen}
						onCopy={onCopy}
						multiAgent={multiAgent}
						skills={skills}
					/>
				</MessageShell>
			</div>
		);
	}
	return (
		<MessageShell role={message.role} variant={variant} footer={userFooter}>
			{variant === "workspace" && showsStatus ? <div className="mb-2">{status}</div> : status}
			<MessageContent
				message={message}
				onArtifactDownload={onArtifactDownload}
				onArtifactOpen={onArtifactOpen}
				onCopy={onCopy}
				multiAgent={multiAgent}
				skills={skills}
			/>
		</MessageShell>
	);
}
