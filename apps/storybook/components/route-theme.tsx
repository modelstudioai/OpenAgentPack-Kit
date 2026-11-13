"use client";

import { useTheme } from "next-themes";
import { useEffect, useLayoutEffect, useState } from "react";

/** SSR 时退化为 useEffect（服务端无 layout effect，也不该有 DOM 副作用）。 */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * 路由级固定主题：首页暗色、/docs/** 亮色（产品决策）。
 *
 * 防闪分两层：
 * 1. 首屏（整页加载）：app/layout.tsx 的内联脚本在绘制前按 pathname 写 class + storageKey；
 * 2. SPA 跳转：本组件在 **useLayoutEffect（绘制前）** 直接同步 html class 与 storageKey，
 *    再调 setTheme 让 next-themes 的 state/resolvedTheme 对齐。
 *    用 useEffect 会先画一帧旧主题再翻色——就是用户报的「切换闪烁」。
 *
 * 不提供手动主题开关：任何手动切换都会与路由语义打架（见 AGENTS.md「主题按路由固定」）。
 */
export function RouteTheme({ theme }: { theme: "dark" | "light" }) {
	const { setTheme } = useTheme();
	const [storageOk, setStorageOk] = useState(true);

	useIsomorphicLayoutEffect(() => {
		const dark = theme === "dark";
		const root = document.documentElement;
		root.classList.toggle("dark", dark);
		root.classList.toggle("light", !dark);
		if (storageOk) {
			try {
				localStorage.setItem("theme", theme);
			} catch {
				setStorageOk(false);
			}
		}
	}, [theme, storageOk]);

	useEffect(() => {
		setTheme(theme);
	}, [setTheme, theme]);

	return null;
}
