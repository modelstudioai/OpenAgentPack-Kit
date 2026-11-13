import type { ChatMessage, MessagePart } from "@openagentpack/kit-sdk/messages";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { Tooltip } from "../tooltip/index.tsx";

export interface MessageAnchorItem {
	/** 回合标题：用户消息首句（折叠空白、截断）；纯附件回合回退为「附件消息」。 */
	label: string;
	/** 内容摘要：回合内助手回复的开头（无正文时为工具执行次数）；缺省时 tooltip 只显示标题。 */
	summary?: string;
}

export interface MessageAnchorTurn extends MessageAnchorItem {
	/** 回合起始用户消息在 messages 中的下标；据此定位滚动位置。 */
	messageIndex: number;
}

/** 元素内多处滚动动效共用：reduced-motion 下平滑滚动降级为瞬时。 */
export function prefersReducedMotion(): boolean {
	return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function collapseText(parts: MessagePart[]): string {
	return parts
		.filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 回合内摘要：助手回复的开头文本；没有正文时回退为工具执行次数，纯审批/等待回合无摘要。 */
function turnSummary(messages: ChatMessage[], start: number, end: number): string | undefined {
	let text: string | undefined;
	let tools = 0;
	for (let index = start; index < end; index += 1) {
		const reply = messages[index];
		if (reply?.role !== "assistant") continue;
		if (!text) {
			const found = collapseText(reply.parts);
			if (found) text = found;
		}
		tools += reply.parts.filter((part) => part.type === "tool").length;
	}
	if (text) return truncate(text, 80);
	return tools > 0 ? `执行工具 ${tools} 次` : undefined;
}

/** 回合推导：每条用户消息开启一个回合；标题取该消息文本首句，摘要取回合内助手回复。 */
export function deriveAnchorTurns(messages: ChatMessage[]): MessageAnchorTurn[] {
	const turns: MessageAnchorTurn[] = [];
	for (const [messageIndex, message] of messages.entries()) {
		if (message.role !== "user") continue;
		const text = collapseText(message.parts);
		const label = text ? truncate(text, 60) : message.parts.length > 0 ? "附件消息" : "新回合";
		turns.push({ messageIndex, label });
	}
	turns.forEach((turn, index) => {
		const end = turns[index + 1]?.messageIndex ?? messages.length;
		turn.summary = turnSummary(messages, turn.messageIndex + 1, end);
	});
	return turns;
}

const BAR_TRANSITION =
	"transition-[width,background-color] duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none";

/** 会话锚点栏：右缘一列固定间距的刻度（Qoder 形态），与内容位置无关、在会话区域垂直居中排列。
 * 悬停/键盘聚焦显示「标题 + 内容摘要」tooltip，当前回合常亮；点击经 onSelect 交还调用方。
 * 刻度不足两个时不渲染。 */
export function MessageAnchorRail({
	items,
	activeIndex,
	onSelect,
	className = "",
}: {
	items: readonly MessageAnchorItem[];
	activeIndex: number;
	onSelect?: (index: number) => void;
	className?: string;
}) {
	if (items.length < 2) return null;
	return (
		<nav
			aria-label="会话锚点"
			className={`pointer-events-none absolute inset-y-0 right-2 z-10 flex w-[26px] flex-col justify-center max-md:hidden ${className}`}
		>
			{items.map((item, index) => {
				const active = index === activeIndex;
				return (
					<Tooltip
						key={`${index}:${item.label}`}
						side="left"
						className="group pointer-events-auto relative block w-full shrink cursor-pointer"
						content={
							<span className="block">
								<span className="block font-medium">{item.label}</span>
								{item.summary ? <span className="mt-1 block text-[var(--kit-fg-muted)]">{item.summary}</span> : null}
							</span>
						}
					>
						<button
							type="button"
							aria-label={`第 ${index + 1} 回合：${item.label}`}
							aria-current={active || undefined}
							className="relative block h-4 w-full cursor-pointer border-0 bg-transparent p-0"
							onClick={() => onSelect?.(index)}
						>
							<span
								aria-hidden
								className={`absolute top-1/2 right-1.5 h-0.5 -translate-y-1/2 rounded-full ${BAR_TRANSITION} ${
									active
										? "w-[18px] bg-[var(--kit-fg)]"
										: "w-3 bg-[var(--kit-border)] group-hover:w-4 group-hover:bg-[var(--kit-fg-muted)] group-focus-visible:w-4 group-focus-visible:bg-[var(--kit-fg-muted)]"
								}`}
							/>
						</button>
					</Tooltip>
				);
			})}
		</nav>
	);
}

/** 当前回合：视口上沿 35% 处所在的回合（回合起点按文档顺序升序比较）；
 * 滚到底时最后一条用户消息可能仍在 35% 判定线下方（回合内容不足一屏），
 * 此时直接视为最后回合，否则锚点会停在前一回合。 */
function activeTurnIndex(
	viewport: HTMLElement,
	children: HTMLCollection | undefined,
	turns: readonly MessageAnchorTurn[],
): number {
	// scrollTop 可能有小数；scrollHeight/clientHeight 为整数，按像素取整避免误判（与 MessageList 跟随判定一致）。
	if (Math.ceil(viewport.scrollTop + viewport.clientHeight) >= viewport.scrollHeight) return turns.length - 1;
	const mid = viewport.getBoundingClientRect().top + viewport.clientHeight * 0.35;
	let current = 0;
	for (let index = 0; index < turns.length; index += 1) {
		const turn = turns[index];
		const element = turn ? children?.[turn.messageIndex] : undefined;
		if (!element) break;
		if (element.getBoundingClientRect().top > mid) break;
		current = index;
	}
	return current;
}

/** 虚拟窗口模式的当前回合：未渲染的行没有 DOM 可查，改按行顶偏移前缀和与 scrollTop 判定。 */
function activeTurnIndexFromOffsets(
	viewport: HTMLElement,
	turns: readonly MessageAnchorTurn[],
	offsets: readonly number[],
): number {
	if (Math.ceil(viewport.scrollTop + viewport.clientHeight) >= viewport.scrollHeight) return turns.length - 1;
	const line = viewport.scrollTop + viewport.clientHeight * 0.35;
	let current = 0;
	for (const [index, turn] of turns.entries()) {
		const top = offsets[turn.messageIndex];
		if (top === undefined || top > line) break;
		current = index;
	}
	return current;
}

/** 锚点栏与滚动容器联动：当前回合取视口上沿 35% 处所在的回合；
 * 跳转只滚动传入的容器自身（不 scrollIntoView，避免牵动外层页面）。
 * 传入 offsetsRef（虚拟窗口的行顶偏移前缀）时走前缀和定位，否则按内容子元素下标定位。 */
export function useAnchorRailSync(
	viewportRef: RefObject<HTMLElement | null>,
	contentRef: RefObject<HTMLElement | null>,
	turns: readonly MessageAnchorTurn[],
	enabled: boolean,
	offsetsRef?: RefObject<number[] | null>,
): { activeIndex: number; jumpTo: (turnIndex: number) => void } {
	const [activeIndex, setActiveIndex] = useState(0);
	const frameRef = useRef(0);

	const sync = useCallback(() => {
		if (frameRef.current) cancelAnimationFrame(frameRef.current);
		frameRef.current = requestAnimationFrame(() => {
			frameRef.current = 0;
			const viewport = viewportRef.current;
			if (!enabled || !viewport || turns.length === 0) return;
			const offsets = offsetsRef?.current;
			setActiveIndex(
				offsets
					? activeTurnIndexFromOffsets(viewport, turns, offsets)
					: activeTurnIndex(viewport, contentRef.current?.children, turns),
			);
		});
	}, [contentRef, enabled, offsetsRef, turns, viewportRef]);

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!enabled || !viewport) return;
		sync();
		viewport.addEventListener("scroll", sync, { passive: true });
		window.addEventListener("resize", sync);
		return () => {
			viewport.removeEventListener("scroll", sync);
			window.removeEventListener("resize", sync);
			if (frameRef.current) cancelAnimationFrame(frameRef.current);
			frameRef.current = 0;
		};
	}, [enabled, sync, viewportRef]);

	const jumpTo = useCallback(
		(turnIndex: number) => {
			const viewport = viewportRef.current;
			const turn = turns[turnIndex];
			if (!viewport || !turn) return;
			const offsets = offsetsRef?.current;
			const offsetTop = offsets?.[turn.messageIndex];
			if (offsetTop !== undefined) {
				viewport.scrollTo({ top: Math.max(0, offsetTop - 16), behavior: prefersReducedMotion() ? "auto" : "smooth" });
				return;
			}
			const element = contentRef.current?.children[turn.messageIndex];
			if (!element) return;
			const top = element.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
			viewport.scrollTo({ top: Math.max(0, top - 16), behavior: prefersReducedMotion() ? "auto" : "smooth" });
		},
		[contentRef, offsetsRef, turns, viewportRef],
	);

	return { activeIndex, jumpTo };
}
