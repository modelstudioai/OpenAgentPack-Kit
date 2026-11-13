import type { SVGProps } from "react";

/**
 * 站点图标集：统一 24 viewBox / stroke=currentColor / strokeWidth 1.75 的内联 SVG。
 *
 * 为什么不用图标库：文档站必须离线可开（apps/storybook/AGENTS.md 不变量 3），不引新依赖；
 * 为什么不用 emoji/字符：字体依赖、跨平台不一致、无法进设计 token（ui-ux-pro-max 图标规则）。
 * 新增图标时保持同一族：线性、圆头、1.75 描边、装饰性图标调用处加 aria-hidden。
 */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.75}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			width="1em"
			height="1em"
			{...props}
		>
			{children}
		</svg>
	);
}

/** 品牌标记：kit 盒子（立方体）+ 一个事件节点，呼应「协议 → 组件 → 端」的套件语义。 */
export function LogoMark(props: IconProps) {
	return (
		<Icon strokeWidth={1.6} {...props}>
			<path d="M12 2.8 20 7v10l-8 4.2L4 17V7l8-4.2Z" />
			<path d="M4 7l8 4.4L20 7" />
			<path d="M12 11.4V21.2" />
			<circle cx="12" cy="11.4" r="1.6" fill="currentColor" stroke="none" />
		</Icon>
	);
}

export function ArrowRight(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M4.5 12h15" />
			<path d="m13.5 6 6 6-6 6" />
		</Icon>
	);
}

export function ArrowUpRight(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M7 17 17 7" />
			<path d="M8.5 7H17v8.5" />
		</Icon>
	);
}

export function Copy(props: IconProps) {
	return (
		<Icon {...props}>
			<rect x="9" y="9" width="11" height="11" rx="2.5" />
			<path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
		</Icon>
	);
}

export function Check(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="m4.5 12.5 5 5 10-11" />
		</Icon>
	);
}

export function Sun(props: IconProps) {
	return (
		<Icon {...props}>
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19" />
		</Icon>
	);
}

export function Moon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2Z" />
		</Icon>
	);
}

export function Github(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M9 19.5c-4 1.2-4-2.2-5.5-2.7m11 4.7v-3.2c0-.9-.1-1.3-.5-1.7 2.3-.3 4.5-1.2 4.5-5a3.9 3.9 0 0 0-1.1-2.7 3.6 3.6 0 0 0-.1-2.7s-.9-.3-2.9 1a10 10 0 0 0-5 0c-2-1.3-2.9-1-2.9-1a3.6 3.6 0 0 0-.1 2.7A3.9 3.9 0 0 0 5.3 11.6c0 3.8 2.2 4.7 4.5 5-.4.4-.5.9-.5 1.7v3.2" />
		</Icon>
	);
}

export function Book(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z" />
			<path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5Z" />
			<path d="M9 7.5h7M9 11h5" />
		</Icon>
	);
}

export function Boxes(props: IconProps) {
	return (
		<Icon {...props}>
			<rect x="3" y="3" width="8" height="8" rx="2" />
			<rect x="13" y="3" width="8" height="8" rx="2" />
			<rect x="3" y="13" width="8" height="8" rx="2" />
			<path d="M17 13v8M13 17h8" />
		</Icon>
	);
}

export function Server(props: IconProps) {
	return (
		<Icon {...props}>
			<rect x="3" y="4" width="18" height="7" rx="2" />
			<rect x="3" y="13" width="18" height="7" rx="2" />
			<path d="M7 7.5h.01M7 16.5h.01M11 7.5h2M11 16.5h2" />
		</Icon>
	);
}

export function ShieldCheck(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M12 2.8 19.5 5.6v6c0 4.6-3.1 8-7.5 9.6-4.4-1.6-7.5-5-7.5-9.6v-6L12 2.8Z" />
			<path d="m8.8 11.8 2.3 2.3 4.2-4.6" />
		</Icon>
	);
}

export function Layers(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="m12 3 9 5-9 5-9-5 9-5Z" />
			<path d="m3.5 12.5 8.5 4.7 8.5-4.7" />
			<path d="m3.5 16.8 8.5 4.7 8.5-4.7" />
		</Icon>
	);
}

export function Terminal(props: IconProps) {
	return (
		<Icon {...props}>
			<rect x="3" y="4" width="18" height="16" rx="2.5" />
			<path d="m7.5 9.5 3 2.8-3 2.8M13 15.5h4" />
		</Icon>
	);
}

export function GitBranch(props: IconProps) {
	return (
		<Icon {...props}>
			<circle cx="6.5" cy="5.5" r="2.5" />
			<circle cx="6.5" cy="18.5" r="2.5" />
			<circle cx="17.5" cy="8" r="2.5" />
			<path d="M6.5 8v8" />
			<path d="M17.5 10.5c0 3-2.5 4-5 4.3-2 .2-3.6.8-4.4 2" />
		</Icon>
	);
}

export function Braces(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M8.5 3.5c-2 0-2.5 1-2.5 2.5v2c0 1.6-.8 2.6-2.5 3 1.7.4 2.5 1.4 2.5 3v2c0 1.5.5 2.5 2.5 2.5" />
			<path d="M15.5 3.5c2 0 2.5 1 2.5 2.5v2c0 1.6.8 2.6 2.5 3-1.7.4-2.5 1.4-2.5 3v2c0 1.5-.5 2.5-2.5 2.5" />
		</Icon>
	);
}

export function Zap(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12l1-8Z" />
		</Icon>
	);
}

export function MessageSquare(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3.5v-14A2.5 2.5 0 0 1 6.5 3.5h11A2.5 2.5 0 0 1 20 6v8.5Z" />
			<path d="M8 8.5h8M8 12h5" />
		</Icon>
	);
}

export function Puzzle(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M10 3.5a2 2 0 0 1 4 0V5h3.5A1.5 1.5 0 0 1 19 6.5V10h1.5a2 2 0 0 1 0 4H19v3.5a1.5 1.5 0 0 1-1.5 1.5H14v-1.5a2 2 0 0 0-4 0V19H6.5A1.5 1.5 0 0 1 5 17.5V14H3.5a2 2 0 0 1 0-4H5V6.5A1.5 1.5 0 0 1 6.5 5H10V3.5Z" />
		</Icon>
	);
}

export function Globe(props: IconProps) {
	return (
		<Icon {...props}>
			<circle cx="12" cy="12" r="9" />
			<path d="M3 12h18" />
			<path d="M12 3c2.6 2.5 3.9 5.5 3.9 9S14.6 18.5 12 21c-2.6-2.5-3.9-5.5-3.9-9S9.4 5.5 12 3Z" />
		</Icon>
	);
}

export function Smartphone(props: IconProps) {
	return (
		<Icon {...props}>
			<rect x="7" y="2.5" width="10" height="19" rx="2.5" />
			<path d="M11 18.5h2" />
		</Icon>
	);
}

export function Laptop(props: IconProps) {
	return (
		<Icon {...props}>
			<rect x="4" y="4.5" width="16" height="10.5" rx="2" />
			<path d="M2.5 18.5h19" />
			<path d="M10 18.5h4" />
		</Icon>
	);
}

export function MonitorSmartphone(props: IconProps) {
	return (
		<Icon {...props}>
			<rect x="2.5" y="4" width="13" height="9.5" rx="2" />
			<path d="M7 17.5h4M9 13.5v4" />
			<rect x="16.5" y="9.5" width="5" height="10" rx="1.8" />
		</Icon>
	);
}

export function Sparkles(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M12 4.5 13.8 9l4.5 1.8-4.5 1.8L12 17l-1.8-4.4L5.7 10.8 10.2 9 12 4.5Z" />
			<path d="M18.5 3.5v3M20 5h-3M5.5 17.5v3M7 19H4" />
		</Icon>
	);
}

export function Database(props: IconProps) {
	return (
		<Icon {...props}>
			<ellipse cx="12" cy="5.5" rx="8" ry="3" />
			<path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13" />
			<path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
		</Icon>
	);
}

export function FileCode(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5L13.5 3Z" />
			<path d="M13.5 3v5.5H19" />
			<path d="m10 12.5-2 2 2 2M14 12.5l2 2-2 2" />
		</Icon>
	);
}

export function Desktop(props: IconProps) {
	return (
		<Icon {...props}>
			<rect x="2.5" y="4" width="19" height="12.5" rx="2" />
			<path d="M9 20.5h6M12 16.5v4" />
		</Icon>
	);
}

/** 状态栏图标（手机壳仿真用）：实心族，与线性图标分层使用是刻意的——状态栏在真机上就是实心glyph */
export function SignalBars(props: IconProps) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 18 12"
			width="1em"
			height="0.7em"
			fill="currentColor"
			aria-hidden="true"
			{...props}
		>
			<rect x="0" y="8" width="3" height="4" rx="1" />
			<rect x="5" y="5.5" width="3" height="6.5" rx="1" />
			<rect x="10" y="3" width="3" height="9" rx="1" />
			<rect x="15" y="0.5" width="3" height="11.5" rx="1" opacity="0.45" />
		</svg>
	);
}

export function Wifi(props: IconProps) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 16 12"
			width="1em"
			height="0.75em"
			fill="currentColor"
			aria-hidden="true"
			{...props}
		>
			<path d="M8 9.6a1.9 1.9 0 0 1 1.9 1.9L8 12l-1.9-.5A1.9 1.9 0 0 1 8 9.6Z" />
			<path d="M8 6.2c1.9 0 3.6.7 4.9 1.9l-1.5 1.5A4.8 4.8 0 0 0 8 8.3c-1.3 0-2.5.5-3.4 1.3L3.1 8.1A6.9 6.9 0 0 1 8 6.2Z" />
			<path d="M8 2.8c2.8 0 5.4 1.1 7.3 2.9l-1.5 1.5A8.2 8.2 0 0 0 8 4.9c-2.3 0-4.4.9-5.8 2.3L.7 5.7A10.3 10.3 0 0 1 8 2.8Z" />
		</svg>
	);
}

export function Battery(props: IconProps) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 25 12"
			width="1.6em"
			height="0.8em"
			aria-hidden="true"
			{...props}
		>
			<rect x="0.5" y="0.5" width="21" height="11" rx="3" fill="none" stroke="currentColor" opacity="0.5" />
			<rect x="2" y="2" width="15" height="8" rx="1.6" fill="currentColor" />
			<path d="M23 4v4a2.2 2.2 0 0 0 0-4Z" fill="currentColor" opacity="0.5" />
		</svg>
	);
}
