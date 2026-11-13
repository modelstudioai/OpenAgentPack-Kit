"use client";

import { useEffect, useRef, useState } from "react";

/** 统计数字滚动到目标值（进入视口触发一次）；reduced-motion 直接终态。 */
export function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	const [shown, setShown] = useState(0);
	const done = useRef(false);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
		const finish = () => {
			if (done.current) return;
			done.current = true;
			setShown(value);
		};
		if (reduced || typeof IntersectionObserver === "undefined") {
			finish();
			return;
		}
		const io = new IntersectionObserver(
			(entries) => {
				if (!entries.some((e) => e.isIntersecting)) return;
				io.disconnect();
				const start = performance.now();
				const dur = 900;
				const step = (now: number) => {
					const t = Math.min(1, (now - start) / dur);
					setShown(Math.round(value * (1 - (1 - t) ** 3)));
					if (t < 1) requestAnimationFrame(step);
				};
				requestAnimationFrame(step);
			},
			{ threshold: 0.4 },
		);
		io.observe(el);
		return () => io.disconnect();
	}, [value]);

	return (
		<span ref={ref}>
			{shown}
			{suffix}
		</span>
	);
}
