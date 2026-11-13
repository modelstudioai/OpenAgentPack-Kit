"use client";

import { useEffect, useRef, useState } from "react";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/<>[]{}#*+";

/**
 * Scramble-decode 标题（reactbits 的招牌动效之一）：字符从乱码逐位收敛到目标文本。
 * - 仅在客户端挂载后跑一次；SSG 首屏渲染的是最终文本（无 JS 也可读、不闪）；
 * - prefers-reduced-motion 或无 rAF 环境直接显示终态；
 * - 中文按码位收敛（每个汉字也是一位），视觉上是「逐字点亮」。
 */
export function ScrambleText({ text, className }: { text: string; className?: string }) {
	const [display, setDisplay] = useState(text);
	const started = useRef(false);

	useEffect(() => {
		if (started.current) return;
		started.current = true;
		const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
		if (reduced) {
			setDisplay(text);
			return;
		}
		const chars = [...text];
		const total = chars.length;
		const framePerChar = 2.2;
		let frame = 0;
		let raf = 0;
		const tick = () => {
			frame += 1;
			const settled = Math.floor(frame / framePerChar);
			const next = chars
				.map((ch, i) => {
					if (i < settled || ch === " ") return ch;
					return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
				})
				.join("");
			setDisplay(next);
			if (settled <= total) raf = requestAnimationFrame(tick);
			else setDisplay(text);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [text]);

	return (
		<span className={className}>
			<span className="sr-only">{text}</span>
			<span aria-hidden="true">{display}</span>
		</span>
	);
}
