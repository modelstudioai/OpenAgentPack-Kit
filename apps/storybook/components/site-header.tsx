"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Github, LogoMark } from "./icons.tsx";

const NAV = [{ href: "/docs/components/", label: "组件总览" }];

/**
 * 落地页顶栏：吸顶 + 滚动后加描边/阴影/模糊（状态用 data-scrolled，避免布局跳动）。
 * 移动端收进一个可展开菜单（aria-expanded + 点击外部不关也没关系：是显式开关）。
 */
export function SiteHeader() {
	const [scrolled, setScrolled] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);

	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 8);
		onScroll();
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	return (
		<header className="kit-site-header" data-scrolled={scrolled || undefined}>
			<div className="kit-site-header-inner">
				<Link href="/" className="kit-brand">
					<span className="kit-brand-mark">
						<LogoMark />
					</span>
					<span className="kit-brand-name">OpenAgentPack Kit</span>
					<span className="kit-brand-pill">v1.0.0</span>
				</Link>
				<nav className="kit-site-nav" aria-label="站点导航">
					{NAV.map((item) => (
						<Link key={item.href} href={item.href} className="kit-site-nav-link">
							{item.label}
						</Link>
					))}
				</nav>
				<div className="kit-site-header-actions">
					<a
						className="kit-btn"
						data-icon="true"
						href="https://github.com/modelstudioai/OpenAgentPack-Kit"
						aria-label="仓库"
						title="仓库"
					>
						<Github />
					</a>
					<button
						type="button"
						className="kit-btn kit-menu-btn"
						data-icon="true"
						aria-expanded={menuOpen}
						aria-label={menuOpen ? "关闭菜单" : "打开菜单"}
						onClick={() => setMenuOpen((v) => !v)}
					>
						<svg
							viewBox="0 0 24 24"
							width="1em"
							height="1em"
							fill="none"
							stroke="currentColor"
							strokeWidth={1.75}
							strokeLinecap="round"
							aria-hidden="true"
						>
							{menuOpen ? <path d="m6 6 12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
						</svg>
					</button>
				</div>
			</div>
			{menuOpen ? (
				<nav className="kit-site-menu" aria-label="站点导航（移动）">
					{NAV.map((item) => (
						<Link key={item.href} href={item.href} className="kit-site-menu-link" onClick={() => setMenuOpen(false)}>
							{item.label}
							<ArrowUpRight />
						</Link>
					))}
				</nav>
			) : null}
		</header>
	);
}
