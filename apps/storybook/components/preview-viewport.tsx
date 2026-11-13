"use client";

import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef } from "react";
import type { ShowcaseName } from "../lib/showcase-names.ts";

/** 桌面使用固定逻辑宽度并缩放展示；手机使用容器的真实视口，切换时不重建文档。 */
export function PreviewViewport({
	name,
	title,
	device,
}: {
	name: ShowcaseName;
	title: string;
	device: "desktop" | "mobile";
}) {
	const host = useRef<HTMLDivElement>(null);
	const frame = useRef<HTMLIFrameElement>(null);
	const { resolvedTheme } = useTheme();
	const syncTheme = useCallback(() => {
		const root = frame.current?.contentDocument?.documentElement;
		if (root) root.dataset.kitTheme = resolvedTheme === "dark" ? "dark" : "light";
	}, [resolvedTheme]);
	useEffect(syncTheme, [syncTheme]);
	useEffect(() => {
		const element = host.current;
		if (!element) return;
		const resize = () => {
			const logicalWidth = Number.parseFloat(getComputedStyle(element).getPropertyValue("--kd-preview-desktop-width"));
			if (!logicalWidth || !element.clientWidth || !element.clientHeight) return;
			const scale = device === "desktop" ? Math.min(1, element.clientWidth / logicalWidth) : 1;
			element.style.setProperty("--kd-preview-scale", String(scale));
			element.style.setProperty("--kd-preview-viewport-height", `${element.clientHeight / scale}px`);
		};
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(element);
		return () => observer.disconnect();
	}, [device]);
	return (
		<div ref={host} className="kit-preview-viewport-host" data-device={device}>
			<iframe
				ref={frame}
				className="kit-preview-viewport"
				src={`/previews/${name}/`}
				title={title}
				onLoad={syncTheme}
			/>
		</div>
	);
}
