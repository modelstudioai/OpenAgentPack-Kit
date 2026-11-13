import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type TooltipSide = "top" | "bottom" | "left" | "right";

/** 气泡与触发器的间隙、气泡距视口边缘的安全边距（px）。 */
const GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 8;

const SIDE_TRANSFORMS: Record<TooltipSide, string> = {
	top: `translate(-50%, calc(-100% - ${GAP_PX}px))`,
	bottom: `translate(-50%, ${GAP_PX}px)`,
	left: `translate(calc(-100% - ${GAP_PX}px), -50%)`,
	right: `translate(${GAP_PX}px, -50%)`,
};

/** 离开触发器后的宽限期：指针跨过触发器与气泡之间的间隙时气泡不闪断，可移入气泡阅读或选中。 */
const HIDE_DELAY_MS = 150;

function anchorPoint(side: TooltipSide, rect: DOMRect): { left: number; top: number } {
	switch (side) {
		case "top":
			return { left: rect.left + rect.width / 2, top: rect.top };
		case "bottom":
			return { left: rect.left + rect.width / 2, top: rect.bottom };
		case "left":
			return { left: rect.left, top: rect.top + rect.height / 2 };
		case "right":
			return { left: rect.right, top: rect.top + rect.height / 2 };
	}
}

/** 按方位解算气泡的最终位移并夹回视口：贴边触发器（如侧栏行、锚点栏）的居中/侧摆位会把
 * 气泡推出屏幕，所以用实测尺寸整体平移进安全区；视口比气泡还窄时保住右/下缘。
 * 返回值是相对锚点（left/top 定位点）的 translate，纯函数便于单测摆位数学。 */
export function resolveTransform(
	side: TooltipSide,
	anchor: { left: number; top: number },
	width: number,
	height: number,
	viewportWidth: number,
	viewportHeight: number,
): string {
	let left: number;
	let top: number;
	switch (side) {
		case "top":
			left = anchor.left - width / 2;
			top = anchor.top - height - GAP_PX;
			break;
		case "bottom":
			left = anchor.left - width / 2;
			top = anchor.top + GAP_PX;
			break;
		case "left":
			left = anchor.left - width - GAP_PX;
			top = anchor.top - height / 2;
			break;
		case "right":
			left = anchor.left + GAP_PX;
			top = anchor.top - height / 2;
			break;
	}
	const clampedLeft = Math.min(Math.max(left, VIEWPORT_MARGIN_PX), viewportWidth - VIEWPORT_MARGIN_PX - width);
	const clampedTop = Math.min(Math.max(top, VIEWPORT_MARGIN_PX), viewportHeight - VIEWPORT_MARGIN_PX - height);
	return `translate(${clampedLeft - anchor.left}px, ${clampedTop - anchor.top}px)`;
}

/** 轻量 tooltip（参照 playground 的同名组件）：触发器内联渲染（className 透传，截断类由调用方
 * 放在这里），气泡 portal 到 body 并用 position:fixed 定位，不受滚动容器 overflow 裁剪。
 * 气泡宽度按内容解算（w-max）：fixed + width:auto 会向 left 到视口右缘的剩余空间收缩，
 * 贴边触发器（如锚点栏）会被压成几十像素窄条，所以再用 max-w 封顶；挂载后实测尺寸把摆位
 * 夹回视口内（resolveTransform），贴边触发器不再把气泡裁出屏幕，保持所选方位不翻转。
 * overflowOnly 时仅当内容真的被截断（scrollWidth/scrollHeight 超出 client 区）才显示，
 * 未溢出的文本不出提示；false 时悬停/聚焦即显示。气泡可悬停进入（离开触发器有短暂宽限），
 * 页面滚动或窗口缩放时收起，避免 fixed 气泡停在过期位置；气泡自身滚动不收起，内容超过
 * 最大高度时在气泡内滚动。 */
export function Tooltip({
	content,
	side = "top",
	overflowOnly = false,
	className,
	children,
}: {
	content?: ReactNode;
	/** 气泡相对触发器的方位；锚点栏这类贴边触发器用 left/right。 */
	side?: TooltipSide;
	/** 只在触发内容溢出被截断时显示（文字省略提示）。 */
	overflowOnly?: boolean;
	className?: string;
	children: ReactNode;
}) {
	const triggerRef = useRef<HTMLSpanElement>(null);
	const bubbleRef = useRef<HTMLSpanElement>(null);
	const hideTimerRef = useRef(0);
	const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
	// 初始 transform 是未修正的方位值；气泡挂载后按实测尺寸改写（layout effect 在绘制前完成，不闪动）。
	const [transform, setTransform] = useState(SIDE_TRANSFORMS.top);

	const show = useCallback(() => {
		window.clearTimeout(hideTimerRef.current);
		const trigger = triggerRef.current;
		if (!trigger || content === null || content === undefined || content === "") return;
		if (overflowOnly && trigger.scrollWidth <= trigger.clientWidth && trigger.scrollHeight <= trigger.clientHeight)
			return;
		setTransform(SIDE_TRANSFORMS[side]);
		setCoords(anchorPoint(side, trigger.getBoundingClientRect()));
	}, [content, overflowOnly, side]);

	const hide = useCallback(() => setCoords(null), []);

	// 离开触发器不立即收起：宽限期内移入气泡则取消收起。
	const scheduleHide = useCallback(() => {
		window.clearTimeout(hideTimerRef.current);
		hideTimerRef.current = window.setTimeout(hide, HIDE_DELAY_MS);
	}, [hide]);

	useEffect(() => {
		if (!coords) return;
		// 捕获所有滚动；气泡内部滚动目标在 bubble 子树里，位置仍然有效，不收起。
		const onScroll = (event: Event) => {
			if (event.target instanceof Node && bubbleRef.current?.contains(event.target)) return;
			hide();
		};
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", hide);
		return () => {
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", hide);
			window.clearTimeout(hideTimerRef.current);
		};
	}, [coords, hide]);

	// 碰撞检测：offsetWidth/offsetHeight 不含 transform，量到的是真实布局尺寸。
	// setTransform 同值时 React 自动 bail，不会循环。
	useLayoutEffect(() => {
		const bubble = bubbleRef.current;
		if (!coords || !bubble) return;
		setTransform(
			resolveTransform(side, coords, bubble.offsetWidth, bubble.offsetHeight, window.innerWidth, window.innerHeight),
		);
	}, [coords, side]);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: 触发器本身不可交互，语义由内层内容（按钮/文本）承载；悬停与聚焦只负责显示气泡。
		<span
			ref={triggerRef}
			className={className}
			onMouseEnter={show}
			onMouseLeave={scheduleHide}
			onFocus={show}
			onBlur={scheduleHide}
		>
			{children}
			{coords
				? createPortal(
						<span
							ref={bubbleRef}
							role="tooltip"
							onMouseEnter={show}
							onMouseLeave={scheduleHide}
							className="pointer-events-auto fixed z-[9999] w-max max-h-80 max-w-100 overflow-y-auto rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] bg-[var(--kit-surface)] px-3 py-2 text-start text-[length:var(--kit-text-caption)] break-words text-[var(--kit-fg)] shadow-[var(--kit-shadow)] [animation:var(--kit-animate-overlay-in)]"
							style={{ left: coords.left, top: coords.top, transform }}
						>
							{content}
						</span>,
						document.body,
					)
				: null}
		</span>
	);
}
