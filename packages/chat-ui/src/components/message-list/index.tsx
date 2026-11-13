import type { ChatMultiAgent } from "@openagentpack/kit-sdk/chat";
import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import {
	Fragment,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Message, type MessageProps } from "../message/index.tsx";
import {
	deriveAnchorTurns,
	MessageAnchorRail,
	type MessageAnchorTurn,
	prefersReducedMotion,
	useAnchorRailSync,
} from "../message-anchor-rail/index.tsx";
import { SubAgentCard } from "../process/sub-agent-card/index.tsx";
import { ProcessingIndicator } from "../processing-indicator/index.tsx";

function followMessageContent(viewport: HTMLElement, isEmpty: boolean) {
	viewport.scrollTop = isEmpty ? 0 : viewport.scrollHeight;
}

const EMPTY_ANCHOR_TURNS: MessageAnchorTurn[] = [];

/** 分窗渲染参数：行高未实测前按估算占位；窗口在视口上下各多渲染若干行吸收快速滚动。 */
const VIRTUALIZE_THRESHOLD = 24;
const VIRTUAL_OVERSCAN = 6;
const INITIAL_WINDOW = 60;
const ROW_HEIGHT_ESTIMATE = 160;

interface VirtualSlice {
	start: number;
	end: number;
}

interface VirtualRowsState {
	enabled: boolean;
	slice: VirtualSlice | null;
	topPad: number;
	bottomPad: number;
	offsetsRef: RefObject<number[] | null>;
	measureRow: (id: string, element: HTMLElement | null) => void;
	handleScroll: () => void;
}

/** 行顶偏移前缀：offsets[i] = 行 i 距内容顶的距离（行高含其后的行间 gap），offsets[len] 供尾部 spacer 收尾。 */
export function rowOffsets(messages: ChatMessage[], heights: Map<string, number>, gap: number): number[] {
	const offsets = new Array<number>(messages.length + 1);
	let top = 0;
	for (const [index, message] of messages.entries()) {
		offsets[index] = top;
		top += (heights.get(message.id) ?? ROW_HEIGHT_ESTIMATE) + gap;
	}
	offsets[messages.length] = top;
	return offsets;
}

/** 视口覆盖的行窗口（上下各扩 overscan）：start=首个底边越过视口顶的行，end=首个顶边越出视口底的行。 */
export function windowSlice(offsets: readonly number[], top: number, viewportHeight: number): VirtualSlice {
	const len = offsets.length - 1;
	let low = 0;
	let high = len;
	while (low < high) {
		const mid = (low + high) >> 1;
		if ((offsets[mid + 1] ?? 0) <= top) low = mid + 1;
		else high = mid;
	}
	const start = Math.max(0, low - VIRTUAL_OVERSCAN);
	const bottom = top + viewportHeight;
	low = 0;
	high = len;
	while (low < high) {
		const mid = (low + high) >> 1;
		if ((offsets[mid] ?? 0) < bottom) low = mid + 1;
		else high = mid;
	}
	return { start, end: Math.min(len, low + VIRTUAL_OVERSCAN) };
}

/** 行高实测观察器：高度回写缓存；视口上方的行修正会推移下方内容，同步补偿 scrollTop。 */
function createRowHeightObserver(
	viewportRef: RefObject<HTMLElement | null>,
	heightsRef: RefObject<Map<string, number>>,
	onHeightsChanged: () => void,
): ResizeObserver | null {
	if (typeof ResizeObserver === "undefined") return null;
	return new ResizeObserver((entries) => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const heights = heightsRef.current;
		const viewportTop = viewport.getBoundingClientRect().top;
		let changed = false;
		for (const entry of entries) {
			changed = applyMeasuredHeight(entry.target as HTMLElement, heights, viewport, viewportTop) || changed;
		}
		if (changed) onHeightsChanged();
	});
}

/** 单行实测回写：返回高度是否变化；视口上方的行修正会把下方内容整体推移，补偿 scrollTop 保住阅读位置。 */
function applyMeasuredHeight(
	row: HTMLElement,
	heights: Map<string, number>,
	viewport: HTMLElement,
	viewportTop: number,
): boolean {
	const id = row.dataset.kitVirtualId;
	if (!id) return false;
	const height = row.offsetHeight;
	const previous = heights.get(id) ?? ROW_HEIGHT_ESTIMATE;
	if (height === previous) return false;
	if (row.getBoundingClientRect().bottom <= viewportTop) viewport.scrollTop += height - previous;
	heights.set(id, height);
	return true;
}

/** 窗口推导：由消息、行高缓存与布局几何算出行顶前缀、渲染切片与两侧 spacer 高度。 */
function deriveVirtualWindow(
	messages: ChatMessage[],
	heights: Map<string, number>,
	layout: { top: number; viewport: number; gap: number } | null,
): { offsets: number[]; slice: VirtualSlice; topPad: number; bottomPad: number } {
	const gap = layout?.gap ?? 0;
	const offsets = rowOffsets(messages, heights, gap);
	const slice = layout
		? windowSlice(offsets, layout.top, layout.viewport)
		: { start: Math.max(0, messages.length - INITIAL_WINDOW), end: messages.length };
	const topPad = slice.start > 0 ? Math.max(0, (offsets[slice.start] ?? 0) - gap) : 0;
	const bottomPad =
		slice.end < messages.length ? Math.max(0, (offsets[messages.length] ?? 0) - (offsets[slice.end] ?? 0) - gap) : 0;
	return { offsets, slice, topPad, bottomPad };
}

/** 分窗渲染状态：超过阈值条消息才启用（以下与整体渲染完全一致）。
 * 实测行高缓存 + 视口位置推导渲染窗口；视口上方行的高度修正会推移下方内容，
 * 实测回写时同步补偿 scrollTop 保住阅读位置。会话切换（scrollKey 变化）清缓存回底部初始窗。 */
function useVirtualMessages({
	messages,
	viewportRef,
	contentRef,
	scrollKey,
	virtualize,
}: {
	messages: ChatMessage[];
	viewportRef: RefObject<HTMLElement | null>;
	contentRef: RefObject<HTMLDivElement | null>;
	scrollKey: string | null | undefined;
	virtualize: boolean;
}): VirtualRowsState {
	const enabled = virtualize && messages.length > VIRTUALIZE_THRESHOLD;
	const heightsRef = useRef(new Map<string, number>());
	const elementByIdRef = useRef(new Map<string, HTMLElement>());
	const observerRef = useRef<ResizeObserver | null>(null);
	const offsetsRef = useRef<number[] | null>(null);
	const [layout, setLayout] = useState<{ top: number; viewport: number; gap: number } | null>(null);
	const frameRef = useRef(0);

	const scheduleLayout = useCallback(() => {
		if (frameRef.current) return;
		frameRef.current = requestAnimationFrame(() => {
			frameRef.current = 0;
			const viewport = viewportRef.current;
			// 隐藏容器（clientHeight 0）不产出布局，保留上一次窗口等重新显示。
			if (!viewport || viewport.clientHeight === 0) return;
			const gap = contentRef.current ? Number.parseFloat(getComputedStyle(contentRef.current).rowGap) || 0 : 0;
			setLayout((previous) =>
				previous &&
				previous.top === viewport.scrollTop &&
				previous.viewport === viewport.clientHeight &&
				previous.gap === gap
					? previous
					: { top: viewport.scrollTop, viewport: viewport.clientHeight, gap },
			);
		});
	}, [contentRef, viewportRef]);

	// 会话切换（render 期派生重置）：行高与别的会话无关，整体作废。
	const previousScrollKeyRef = useRef(scrollKey);
	if (scrollKey !== previousScrollKeyRef.current) {
		previousScrollKeyRef.current = scrollKey;
		heightsRef.current.clear();
	}

	const measureRow = useCallback(
		(id: string, element: HTMLElement | null) => {
			if (!enabled) return;
			if (!observerRef.current && element)
				observerRef.current = createRowHeightObserver(viewportRef, heightsRef, scheduleLayout);
			const previousElement = elementByIdRef.current.get(id);
			if (previousElement && previousElement !== element) {
				observerRef.current?.unobserve(previousElement);
				elementByIdRef.current.delete(id);
			}
			if (!element) return;
			element.dataset.kitVirtualId = id;
			elementByIdRef.current.set(id, element);
			observerRef.current?.observe(element);
			scheduleLayout();
		},
		[enabled, scheduleLayout, viewportRef],
	);

	useEffect(() => {
		if (!enabled) return;
		scheduleLayout();
		const viewport = viewportRef.current;
		if (!viewport || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(scheduleLayout);
		observer.observe(viewport);
		return () => observer.disconnect();
	}, [enabled, scheduleLayout, viewportRef]);

	useEffect(
		() => () => {
			if (frameRef.current) cancelAnimationFrame(frameRef.current);
			frameRef.current = 0;
			observerRef.current?.disconnect();
			observerRef.current = null;
			heightsRef.current.clear();
			elementByIdRef.current.clear();
		},
		[],
	);

	// 未启用时 slice 为 null：MessageRows 走整体渲染路径；启用但布局未就绪时按末窗推导。
	const derived = enabled ? deriveVirtualWindow(messages, heightsRef.current, layout) : null;
	offsetsRef.current = derived?.offsets ?? null;
	return {
		enabled,
		slice: derived?.slice ?? null,
		topPad: derived?.topPad ?? 0,
		bottomPad: derived?.bottomPad ?? 0,
		offsetsRef,
		measureRow,
		handleScroll: scheduleLayout,
	};
}

/** 分窗模式的行渲染：行外包测量容器（行高实测回写缓存），窗口外以 spacer 占位撑起滚动几何。
 * 非分窗路径与整体渲染逐字节一致（Fragment 不产生额外 DOM），既有结构断言不受影响。 */
function MessageRows({
	messages,
	virtual,
	variant,
	onArtifactDownload,
	onArtifactOpen,
	onCopy,
	multiAgent,
	skills,
}: {
	messages: ChatMessage[];
	virtual: VirtualRowsState;
	variant: MessageProps["variant"];
	onArtifactDownload?: (fileId: string) => void;
	onArtifactOpen?: (fileId: string, contentType?: string) => void;
	onCopy?: (text: string) => void | Promise<void>;
	multiAgent?: ChatMultiAgent;
	skills?: string[];
}) {
	const { enabled, slice, topPad, bottomPad, measureRow } = virtual;
	const rows = slice ? messages.slice(slice.start, slice.end) : messages;
	return (
		<>
			{enabled && slice && slice.start > 0 ? <div aria-hidden="true" style={{ height: topPad }} /> : null}
			{rows.map((message) => {
				const row = (
					<Message
						message={message}
						variant={variant}
						onArtifactDownload={onArtifactDownload}
						onArtifactOpen={onArtifactOpen}
						onCopy={onCopy}
						multiAgent={multiAgent}
						skills={skills}
					/>
				);
				if (!slice) return <Fragment key={message.id}>{row}</Fragment>;
				return (
					<div key={message.id} ref={(element) => measureRow(message.id, element)}>
						{row}
					</div>
				);
			})}
			{enabled && slice && slice.end < messages.length ? (
				<div aria-hidden="true" style={{ height: bottomPad }} />
			) : null}
		</>
	);
}

/** 收集消息流中已有 thread_created 分片（sub-agent 卡）的线程 id。 */
function collectShardThreadIds(messages: ChatMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const message of messages)
		for (const part of message.parts) if (part.type === "sub-agent") ids.add(part.threadId);
	return ids;
}

/**
 * 消息流末尾的多 Agent 尾部区：仅由线程列表摘要发现的线程（消息流没有 thread_created
 * 分片）在此补卡获得入口，否则其历史不可达；分片到达后按 id 去重回原位。无缺失时渲染 null。
 */
function MultiAgentTail({
	messages,
	multiAgent,
	onArtifactDownload,
	onArtifactOpen,
}: {
	messages: ChatMessage[];
	multiAgent?: ChatMultiAgent;
	onArtifactDownload?: (fileId: string) => void;
	onArtifactOpen?: (fileId: string, contentType?: string) => void;
}) {
	if (!multiAgent) return null;
	const shardThreadIds = collectShardThreadIds(messages);
	const threads = multiAgent.threads.filter((thread) => !shardThreadIds.has(thread.id));
	if (threads.length === 0) return null;
	return (
		<div>
			<p className="border-t border-dashed border-[var(--kit-border)] pt-3 text-center text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
				以下子 Agent 来自线程列表
			</p>
			{threads.map((thread) => (
				<SubAgentCard
					key={thread.id}
					threadId={thread.id}
					multiAgent={multiAgent}
					onArtifactDownload={onArtifactDownload}
					onArtifactOpen={onArtifactOpen}
				/>
			))}
		</div>
	);
}

/** 离底浮现的回到底部按钮；隐藏时不可交互、不占焦点，透明度/位移用 token 过渡。 */
function BackToBottomButton({ hidden, onClick }: { hidden: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			aria-label="回到底部"
			tabIndex={hidden ? -1 : 0}
			onClick={onClick}
			className={`absolute bottom-2 left-1/2 z-10 grid size-8 -translate-x-1/2 place-items-center rounded-full border border-[var(--kit-border)] bg-[var(--kit-surface)] text-[var(--kit-fg-muted)] shadow-[var(--kit-shadow)] transition-[opacity,translate,scale,visibility] duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] hover:bg-[var(--kit-bg-subtle)] hover:text-[var(--kit-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] active:scale-90 motion-reduce:transition-none ${
				hidden ? "pointer-events-none invisible scale-90 translate-y-1 opacity-0" : ""
			}`}
		>
			<svg
				aria-hidden="true"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				className="size-4"
			>
				<path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m0 0 6-6m-6 6-6-6" />
			</svg>
		</button>
	);
}

/** 独立消息列表：滚动只作用于自身，用户上翻历史后暂停跟随，回到底部恢复。 */
export function MessageList({
	messages,
	variant = "default",
	onArtifactDownload,
	onArtifactOpen,
	onCopy,
	empty,
	autoScroll = true,
	className,
	scrollKey,
	active = true,
	historyCursor,
	pending = false,
	pendingLabel,
	approvals,
	anchorRail = false,
	multiAgent,
	virtualize = true,
	skills,
}: {
	messages: ChatMessage[];
	/** workspace 将消息居中限制在阅读列内，并使用工作区消息样式。 */
	variant?: MessageProps["variant"];
	onArtifactDownload?: (fileId: string) => void;
	onArtifactOpen?: (fileId: string, contentType?: string) => void;
	onCopy?: (text: string) => void | Promise<void>;
	empty?: ReactNode;
	/** 默认跟随新消息与流式内容；false 时由调用方或用户控制滚动。 */
	autoScroll?: boolean;
	className?: string;
	/** 逻辑会话标识变化时重新跟随到底部；不影响同一会话中上翻历史。 */
	scrollKey?: string | null;
	/** 隐藏的线程保持挂载时暂停滚动副作用，再次显示后恢复原来的阅读位置。 */
	active?: boolean;
	/** 加载更早一页成功后变化的游标；即使同一 Turn 内消息被合并，也能保留阅读锚点。 */
	historyCursor?: string | null;
	/** 回合执行中但助手尚未返回首帧：在列表末尾常驻「生成中…」指示，避免空白等待。 */
	pending?: boolean;
	/** 覆盖 pending 指示文案（如发送请求在途时的「发送中…」）；省略用「生成中…」。 */
	pendingLabel?: string;
	/** 当前待审批卡：内嵌到列表末尾（当前回合的位置），存在时由调用方抑制 pending 指示。 */
	approvals?: ReactNode;
	/** 在列表右缘显示回合锚点栏（Qoder 形态）；每条用户消息是一个回合。 */
	anchorRail?: boolean;
	/** 子 Agent 卡（thread_created 分片）的实时状态源；省略时不渲染。 */
	multiAgent?: ChatMultiAgent;
	/** 长列表分窗渲染开关；false 时无论消息数都整体渲染（窄面板嵌入等特殊场景）。 */
	virtualize?: boolean;
	/** 当前 Agent 已绑定技能名；用户气泡正文按协议 token 原位穿插还原技能 chip（ADR-0016）。 */
	skills?: string[];
}) {
	const isEmpty = messages.length === 0;
	const viewportRef = useRef<HTMLElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const followingRef = useRef(true);
	// 回到底部按钮的显示条件；与 followingRef 同一公式，onScroll 内同步更新。
	const [atBottom, setAtBottom] = useState(true);
	const anchorTurns = useMemo(
		() => (anchorRail ? deriveAnchorTurns(messages) : EMPTY_ANCHOR_TURNS),
		[anchorRail, messages],
	);
	const virtual = useVirtualMessages({ messages, viewportRef, contentRef, scrollKey, virtualize });
	const { activeIndex: activeAnchor, jumpTo: jumpToAnchor } = useAnchorRailSync(
		viewportRef,
		contentRef,
		anchorTurns,
		anchorRail,
		virtual.offsetsRef,
	);
	const previousScrollKeyRef = useRef(scrollKey);
	const previousLayoutRef = useRef<{
		firstId: string | undefined;
		height: number;
		historyCursor?: string | null;
	} | null>(null);
	// 每次渲染后处理消息内容变化，不使用 scrollIntoView，避免牵动外层页面。
	useLayoutEffect(() => {
		if (!active) return;
		const scrollKeyChanged = scrollKey !== previousScrollKeyRef.current;
		previousScrollKeyRef.current = scrollKey;
		const viewport = viewportRef.current;
		if (!viewport) return;
		const previous = previousLayoutRef.current;
		if (scrollKeyChanged || (previous?.firstId === undefined) !== isEmpty) followingRef.current = true;
		// 开场内容从顶部阅读；首条消息出现后恢复跟随到底部。
		const historyPrepended =
			historyCursor !== previous?.historyCursor ||
			messages.findIndex((message) => message.id === previous?.firstId) > 0;
		if (autoScroll && followingRef.current) followMessageContent(viewport, isEmpty);
		else if (!isEmpty && previous && historyPrepended) {
			// 向前分页只增加列表上方的内容，补偿新增高度，保留用户当前看到的消息。
			viewport.scrollTop += viewport.scrollHeight - previous.height;
		}
		previousLayoutRef.current = { firstId: messages[0]?.id, height: viewport.scrollHeight, historyCursor };
	});

	useEffect(() => {
		const viewport = viewportRef.current;
		const content = contentRef.current;
		if (!active || !viewport || !content || !autoScroll || typeof ResizeObserver === "undefined") return;
		// 图片加载、内容换行与窗口缩放也可能改变高度，不一定触发 React 渲染。
		const observer = new ResizeObserver(() => {
			if (followingRef.current) followMessageContent(viewport, isEmpty);
		});
		observer.observe(content);
		observer.observe(viewport);
		return () => observer.disconnect();
	}, [active, autoScroll, isEmpty]);

	const scrollToBottom = () => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		// 不置 followingRef：平滑滚动途中的 onScroll 会把它设回 false，到底后自然恢复跟随。
		viewport.scrollTo({ top: viewport.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
	};

	return (
		<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
			<section
				ref={viewportRef}
				aria-label="消息列表"
				className={`min-h-0 min-w-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${variant === "workspace" ? `px-4 md:px-6${anchorRail ? " md:pr-12" : ""}` : "p-4 pb-2"}${className ? ` ${className}` : ""}`}
				onScroll={(event) => {
					if (!active) return;
					virtual.handleScroll();
					const viewport = event.currentTarget;
					// scrollTop 可能有小数；scrollHeight/clientHeight 为整数，按像素取整避免误判。
					const next = isEmpty
						? viewport.scrollTop <= 0
						: Math.ceil(viewport.scrollTop + viewport.clientHeight) >= viewport.scrollHeight;
					followingRef.current = next;
					setAtBottom(next);
				}}
			>
				<div
					ref={contentRef}
					className={`flex min-h-full min-w-0 flex-col ${variant === "workspace" ? "mx-auto w-full max-w-[var(--kit-chat-width)] gap-6 pt-6 pb-5 md:gap-8 md:pt-8" : "gap-1"}`}
				>
					{messages.length === 0 ? (
						empty
					) : (
						<MessageRows
							messages={messages}
							virtual={virtual}
							variant={variant}
							onArtifactDownload={onArtifactDownload}
							onArtifactOpen={onArtifactOpen}
							onCopy={onCopy}
							multiAgent={multiAgent}
							skills={skills}
						/>
					)}
					<MultiAgentTail
						messages={messages}
						multiAgent={multiAgent}
						onArtifactDownload={onArtifactDownload}
						onArtifactOpen={onArtifactOpen}
					/>
					{/* 底部淡出层会压进内容约一行：审批卡与生成指示必须整体清晰，加净空离开渐变区。 */}
					{approvals ? <div className={variant === "workspace" ? "mb-6" : "my-2"}>{approvals}</div> : null}
					{pending ? (
						<ProcessingIndicator className={variant === "workspace" ? "mb-6" : "my-2"} label={pendingLabel} />
					) : null}
				</div>
			</section>
			{variant === "workspace" ? (
				// 消息滚出视口的底边由清晰渐入模糊：mask 让最大模糊只出现在贴边处、向上渐进消失，
				// 叠加向背景色的渐隐；渐变压进内容约一行，最新内容常驻半隐，滚动即完整复现。
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-[var(--kit-bg)] via-[var(--kit-bg)]/60 to-transparent backdrop-blur-[var(--kit-blur-overlay)] [mask-image:linear-gradient(to_top,black,transparent)]"
				/>
			) : null}
			{anchorRail ? <MessageAnchorRail items={anchorTurns} activeIndex={activeAnchor} onSelect={jumpToAnchor} /> : null}
			<BackToBottomButton hidden={isEmpty || atBottom} onClick={scrollToBottom} />
		</div>
	);
}
