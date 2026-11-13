import { useIsMobile } from "@openagentpack/kit-sdk/hooks";
import * as Dialog from "@radix-ui/react-dialog";
import { type HTMLAttributes, type ReactNode, useEffect, useState } from "react";

export interface LayoutSidebarControls {
	/** 业务导航或会话选择完成后关闭移动抽屉。 */
	closeSidebar: () => void;
	/** 放入侧栏页头的关闭按钮；桌面端为 null。 */
	closeButton: ReactNode;
}

export interface LayoutAsideControls {
	/** 面板头关闭按钮：仅移动端覆盖层注入（Dialog.Close）；桌面端为 null，开合只经页头的面板开关。 */
	closeButton: ReactNode;
}

export interface LayoutProps extends HTMLAttributes<HTMLDivElement> {
	/** 桌面常驻、移动端放入抽屉；同一时刻只挂载一份。缺省或 null 表示无侧栏的纯内容布局。 */
	sidebar?: ReactNode | ((controls: LayoutSidebarControls) => ReactNode) | null;
	/** 自定义页头，把 menuToggle 放入页头的操作插槽；页头通栏盖住内容区（含资源面板上方）。 */
	header?: (menuToggle: ReactNode) => ReactNode;
	/** 未提供 header 时移动端页头显示的标题。 */
	mobileTitle?: ReactNode;
	/** 移动抽屉的无障碍名称，同时用于打开与关闭按钮。 */
	sidebarLabel?: string;
	/** 受控确认弹窗；抽屉打开时进入其焦点范围，跨断点保持可见。 */
	dialogs?: ReactNode;
	/** 右侧资源面板：桌面为页头之下的停靠右列（与正文同面白色），移动端为右滑入的全屏覆盖层。 */
	aside?: ReactNode | ((controls: LayoutAsideControls) => ReactNode);
	/** 面板受控开合，缺省打开；桌面收起时列宽过渡到 0、内容保持挂载不丢状态。 */
	asideOpen?: boolean;
	/** 面板的无障碍名称，同时用于移动覆盖层标题与关闭按钮。 */
	asideLabel?: string;
	/** 面板关闭（Esc / 移动端关闭按钮 / 跨到移动断点）时回传；打开由调用方自行置位。 */
	onAsideOpenChange?: (open: boolean) => void;
	/** 默认适配移动可视视口；嵌入或原生宿主管理高度时可关闭。 */
	fitViewport?: boolean;
	children: ReactNode;
}

function useVisualViewport(container: HTMLElement | null, enabled: boolean) {
	useEffect(() => {
		if (!container || !enabled) return;
		const viewport = window.visualViewport;
		const resize = () => {
			// 不随双指缩放缩小布局，保留浏览器原有放大和拖动行为。
			if (viewport && viewport.scale !== 1) return;
			const height = viewport?.height ?? window.innerHeight;
			if (height > 0) container.style.setProperty("--kit-viewport-height", `${height}px`);
		};
		resize();
		viewport?.addEventListener("resize", resize);
		window.addEventListener("resize", resize);
		return () => {
			viewport?.removeEventListener("resize", resize);
			window.removeEventListener("resize", resize);
			container.style.removeProperty("--kit-viewport-height");
		};
	}, [container, enabled]);
}

function MenuIcon({ close = false }: { close?: boolean }) {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			className="h-4 w-4 shrink-0"
		>
			<path d={close ? "m6 6 12 12M6 18 18 6" : "M4 6h16M4 12h16M4 18h16"} />
		</svg>
	);
}

const ASIDE_CLOSE_CLASSES =
	"grid size-8 shrink-0 place-items-center rounded-[var(--kit-radius-sm)] text-[var(--kit-fg-muted)] transition-colors hover:bg-[var(--kit-bg-subtle)] hover:text-[var(--kit-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]";

/** 断点感知的抽屉关闭按钮；桌面端不渲染。必须挂在 Dialog.Root 内。 */
function SidebarCloseToggle({ isMobile, label }: { isMobile: boolean; label: string }) {
	if (!isMobile) return null;
	return (
		<Dialog.Close asChild>
			<button
				type="button"
				aria-label={`关闭${label}`}
				className="rounded-[var(--kit-radius-sm)] p-1 text-[var(--kit-fg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]"
			>
				<MenuIcon close />
			</button>
		</Dialog.Close>
	);
}

/** 移动覆盖层的关闭按钮：经 Dialog.Close 触发 onAsideOpenChange(false)。 */
function AsideCloseButton({ label }: { label: string }) {
	return (
		<Dialog.Close asChild>
			<button type="button" aria-label={`关闭${label}`} className={ASIDE_CLOSE_CLASSES}>
				<MenuIcon close />
			</button>
		</Dialog.Close>
	);
}

/** 断点感知的抽屉触发按钮；桌面端或无侧栏时都不渲染。必须挂在 Dialog.Root 内。 */
function SidebarMenuToggle({ isMobile, hasSidebar, label }: { isMobile: boolean; hasSidebar: boolean; label: string }) {
	if (!isMobile || !hasSidebar) return null;
	return (
		<Dialog.Trigger asChild>
			<button
				type="button"
				aria-label={`打开${label}`}
				title={`打开${label}`}
				className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--kit-radius-sm)] text-[var(--kit-fg-muted)] transition-colors hover:bg-[var(--kit-bg-subtle)] hover:text-[var(--kit-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]"
			>
				<MenuIcon />
			</button>
		</Dialog.Trigger>
	);
}

/** 未提供 header 时移动端的默认标题栏。 */
function MobileFallbackHeader({ title, menuToggle }: { title: ReactNode; menuToggle: ReactNode }) {
	return (
		<header className="flex min-h-16 shrink-0 items-center gap-2 border-b border-[var(--kit-border)] px-3">
			{menuToggle}
			<span className="text-[length:var(--kit-text-base)] font-medium">{title}</span>
		</header>
	);
}

/** 页头：自定义 header 优先；缺省时仅移动端给标题栏，桌面端不渲染。 */
function LayoutHeader({
	header,
	menuToggle,
	isMobile,
	mobileTitle,
}: {
	header?: (menuToggle: ReactNode) => ReactNode;
	menuToggle: ReactNode;
	isMobile: boolean;
	mobileTitle: ReactNode;
}) {
	if (header) return header(menuToggle);
	if (!isMobile) return null;
	return <MobileFallbackHeader title={mobileTitle} menuToggle={menuToggle} />;
}

/** 移动抽屉浮层；左侧滑出，内容由调用方组装。 */
function SidebarDrawer({ container, label, children }: { container: HTMLElement; label: string; children: ReactNode }) {
	return (
		<Dialog.Portal container={container}>
			<Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--kit-overlay)]" />
			<Dialog.Content
				aria-describedby={undefined}
				className="fixed inset-y-0 left-0 z-40 flex w-64 max-w-full flex-col bg-[var(--kit-bg-subtle)] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-[var(--kit-shadow)] [&>aside]:min-h-0 [&>aside]:flex-1"
			>
				<Dialog.Title className="sr-only">{label}</Dialog.Title>
				{children}
			</Dialog.Content>
		</Dialog.Portal>
	);
}

function renderAside(aside: LayoutProps["aside"], controls: LayoutAsideControls): ReactNode {
	if (!aside) return null;
	return typeof aside === "function" ? aside(controls) : aside;
}

/** 桌面停靠右列：页头之下、与正文同面（白色，不用灰面——灰色只留给左栏），开合走宽度过渡，内容保持挂载；收起后列宽 0 且不可聚焦。 */
function DesktopAside({ open, children }: { open: boolean; children: ReactNode }) {
	return (
		<div
			className="h-full min-h-0 shrink-0 overflow-hidden transition-[width] duration-[var(--kit-duration-base)] ease-[var(--kit-ease-out)] motion-reduce:transition-none"
			style={{ width: open ? "var(--kit-aside-width)" : "0px" }}
		>
			<div
				inert={!open || undefined}
				className="flex h-full w-[var(--kit-aside-width)] min-h-0 flex-col bg-[var(--kit-bg)] transition-[opacity,transform] duration-[var(--kit-duration-base)] ease-[var(--kit-ease-out)] motion-reduce:transition-none"
				style={open ? undefined : { opacity: 0, transform: "translateX(12px)" }}
			>
				{children}
			</div>
		</div>
	);
}

/** 面板区域：桌面为 main 内通高右列，移动端为右滑入的全屏覆盖层（Portal）。 */
function AsideRegion({
	isMobile,
	container,
	open,
	label,
	onOpenChange,
	children,
}: {
	isMobile: boolean;
	container: HTMLDivElement | null;
	open: boolean;
	label: string;
	onOpenChange?: (open: boolean) => void;
	children: ReactNode;
}) {
	if (!children) return null;
	if (!isMobile) return <DesktopAside open={open}>{children}</DesktopAside>;
	if (!container) return null;
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal container={container}>
				<Dialog.Content
					aria-describedby={undefined}
					className="fixed inset-0 z-40 flex flex-col bg-[var(--kit-bg)] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-[var(--kit-shadow)] [animation:var(--kit-animate-panel-in)]"
				>
					<Dialog.Title className="sr-only">{label}</Dialog.Title>
					{children}
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

/**
 * 侧栏与确认弹窗的挂载层：桌面侧栏常驻；移动端弹窗留在背景、抽屉打开时才进其焦点范围。
 * 无侧栏（纯内容布局）时移动端不出抽屉，也不留背景挂载点之外的多余节点。
 */
function SidebarLayers({
	isMobile,
	hasSidebar,
	container,
	sidebarLabel,
	open,
	sidebarContent,
	dialogs,
}: {
	isMobile: boolean;
	hasSidebar: boolean;
	container: HTMLElement | null;
	sidebarLabel: string;
	open: boolean;
	sidebarContent: ReactNode;
	dialogs: ReactNode;
}) {
	return (
		<>
			{!isMobile ? sidebarContent : null}
			{/* 抽屉打开时确认弹窗位于其焦点范围；关闭或跨断点时仍由调用方持有 pending。 */}
			{isMobile && !open ? dialogs : null}
			{isMobile && container && hasSidebar ? (
				<SidebarDrawer container={container} label={sidebarLabel}>
					{sidebarContent}
				</SidebarDrawer>
			) : null}
		</>
	);
}

/** 组装外壳根容器类名：默认适配移动可视视口，允许调用方追加。 */
function shellClassName(fitViewport: boolean, className: string | undefined): string {
	return `flex h-full min-h-0 overflow-hidden bg-[var(--kit-bg)]${fitViewport ? " max-md:max-h-[var(--kit-viewport-height,100dvh)]" : ""}${className ? ` ${className}` : ""}`;
}

/** 通用整页外壳：仅管理布局、抽屉、资源面板与视口，不持有路由、认证或会话数据。 */
export function Layout({
	sidebar,
	header,
	mobileTitle,
	sidebarLabel = "导航菜单",
	dialogs,
	aside,
	asideOpen = true,
	asideLabel = "资源面板",
	onAsideOpenChange,
	fitViewport = true,
	children,
	className,
	...props
}: LayoutProps) {
	const isMobile = useIsMobile();
	const hasSidebar = sidebar !== null && sidebar !== undefined;
	const [open, setOpen] = useState(false);
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	useVisualViewport(container, isMobile && fitViewport);
	useEffect(() => {
		// 抽屉与覆盖层状态不跨断点泄漏：回桌面收抽屉，进移动端收资源面板覆盖层。
		if (!isMobile) setOpen(false);
		else onAsideOpenChange?.(false);
	}, [isMobile, onAsideOpenChange]);
	const closeButton = <SidebarCloseToggle isMobile={isMobile} label={sidebarLabel} />;
	const menuToggle = <SidebarMenuToggle isMobile={isMobile} hasSidebar={hasSidebar} label={sidebarLabel} />;
	const sidebarContent = (
		<>
			{typeof sidebar === "function" ? sidebar({ closeSidebar: () => setOpen(false), closeButton }) : sidebar}
			{dialogs}
		</>
	);
	const asideContent = renderAside(aside, {
		closeButton: isMobile ? <AsideCloseButton label={asideLabel} /> : null,
	});
	return (
		<Dialog.Root open={open && isMobile} onOpenChange={setOpen}>
			<div {...props} ref={setContainer} className={shellClassName(fitViewport, className)}>
				<SidebarLayers
					isMobile={isMobile}
					hasSidebar={hasSidebar}
					container={container}
					sidebarLabel={sidebarLabel}
					open={open}
					sidebarContent={sidebarContent}
					dialogs={dialogs}
				/>
				<main className="flex min-h-0 min-w-0 flex-1 flex-col">
					<LayoutHeader header={header} menuToggle={menuToggle} isMobile={isMobile} mobileTitle={mobileTitle} />
					<div className="flex min-h-0 min-w-0 flex-1">
						<div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
						<AsideRegion
							isMobile={isMobile}
							container={container}
							open={asideOpen}
							label={asideLabel}
							onOpenChange={onAsideOpenChange}
						>
							{asideContent}
						</AsideRegion>
					</div>
				</main>
			</div>
		</Dialog.Root>
	);
}
