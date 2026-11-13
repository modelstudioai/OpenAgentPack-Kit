"use client";

import { type ReactNode, useRef } from "react";

/**
 * Spotlight 卡：指针位置写入 --mx/--my，CSS 用 radial-gradient 做跟随光斑 + 1px 描边高亮
 * （reactbits 卡片的手感）。纯 CSS 变量驱动、无重排；无指针设备不触发即无光斑。
 * 传 href 时渲染成 <a>（整卡可点），否则 <div>。
 */
export function GlowCard({
	href,
	children,
	className = "",
}: {
	href?: string;
	children: ReactNode;
	className?: string;
}) {
	const ref = useRef<HTMLElement | null>(null);
	const setRef = (el: HTMLElement | null) => {
		ref.current = el;
	};
	const onMove = (event: React.PointerEvent<HTMLElement>) => {
		const el = ref.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		el.style.setProperty("--mx", `${event.clientX - rect.left}px`);
		el.style.setProperty("--my", `${event.clientY - rect.top}px`);
	};
	const props = {
		ref: setRef,
		className: `kit-glow ${className}`,
		onPointerMove: onMove,
	};
	if (href) {
		return (
			<a {...props} href={href}>
				{children}
			</a>
		);
	}
	return <div {...props}>{children}</div>;
}
