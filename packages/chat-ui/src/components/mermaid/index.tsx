import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { Actions } from "../actions/index.tsx";
import { CodeHighlighter } from "../code-highlighter/index.tsx";

export interface MermaidProps {
	children: string;
	header?: ReactNode;
	className?: string;
	defaultRenderType?: "image" | "code";
	copyable?: boolean;
	streaming?: boolean;
	onRenderTypeChange?: (value: "image" | "code") => void;
}

// Mermaid 的配置是模块级状态；串行初始化与渲染，避免多个图表互相覆盖主题。
let renderQueue: Promise<void> = Promise.resolve();
let renderSequence = 0;

function hasResourceSyntax(source: string) {
	// strict 仍会加载新式节点的 img；这些扩展、图片与 CSS 资源只展示源码。
	// 先还原 CSS 转义与 HTML 字符引用，避免资源语法通过编码绕过检查。
	const decoded = source
		.replace(/\\([\da-f]{1,6})\s?/gi, (_, code: string) =>
			String.fromCodePoint(Math.min(Number.parseInt(code, 16), 0x10ffff)),
		)
		.replace(/\\([^\r\n])/g, "$1")
		.replace(/&#(x[\da-f]+|\d+);?/gi, (_, code: string) => {
			const value = code[0]?.toLowerCase() === "x" ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10);
			return String.fromCodePoint(Math.min(value, 0x10ffff));
		})
		.replace(/&lt;/gi, "<");
	return /@\s*\{|!\[|<\s*(?:img|image|svg|iframe|object|embed|link|style)\b|\b(?:url|image|image-set|cross-fade)\s*\(|@(?:import|font-face)\b/i.test(
		decoded,
	);
}

function themeVariables(element: HTMLElement) {
	const style = getComputedStyle(element);
	const token = (name: string) => style.getPropertyValue(`--kit-${name}`).trim();
	return Object.fromEntries(
		Object.entries({
			background: token("bg"),
			primaryColor: token("bg-subtle"),
			primaryTextColor: token("fg"),
			primaryBorderColor: token("border"),
			lineColor: token("fg-muted"),
			secondaryColor: token("user-bubble"),
			tertiaryColor: token("bg"),
			edgeLabelBackground: token("bg"),
			fontFamily: style.fontFamily,
		}).filter(([, value]) => value),
	);
}

async function renderDiagram(source: string, element: HTMLElement, active: () => boolean) {
	const { default: mermaid } = await import("mermaid");
	if (!active()) return undefined;
	mermaid.initialize({
		startOnLoad: false,
		securityLevel: "strict",
		suppressErrorRendering: true,
		htmlLabels: false,
		theme: "base",
		themeVariables: themeVariables(element),
		// 源码中的 init/frontmatter 不能覆写任何渲染器配置。
		secure: Object.keys(mermaid.mermaidAPI.getConfig()),
		flowchart: { htmlLabels: false },
	});
	const container = document.createElement("div");
	container.className = "pointer-events-none fixed left-0 top-0 -z-10 opacity-0";
	container.setAttribute("aria-hidden", "true");
	document.body.append(container);
	try {
		const { svg } = await mermaid.render(`kit-mermaid-${++renderSequence}`, source, container);
		// SVG 只作为图片使用，不插入应用 DOM，也不调用 bindFunctions。
		return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	} finally {
		container.remove();
	}
}

/** 严格模式的图表/源码双视图。流式未完成时展示源码，更新后自动恢复渲染。 */
export function Mermaid({
	children,
	header = "Mermaid 图表",
	className,
	defaultRenderType = "image",
	copyable = true,
	streaming = false,
	onRenderTypeChange,
}: MermaidProps) {
	const root = useRef<HTMLElement>(null);
	const panelId = useId();
	const [renderType, setRenderType] = useState(defaultRenderType);
	const [revision, setRevision] = useState(0);
	const [result, setResult] = useState<{ source: string; revision: number; image?: string; error?: boolean }>();
	const hasResources = useMemo(() => hasResourceSyntax(children), [children]);

	useEffect(() => {
		const observer = new MutationObserver(() => setRevision((value) => value + 1));
		for (let parent = root.current?.parentElement; parent; parent = parent.parentElement) {
			observer.observe(parent, { attributes: true, attributeFilter: ["data-kit-theme", "class", "style"] });
		}
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const element = root.current;
		if (!element || streaming || hasResources || renderType === "code") return;
		let cancelled = false;
		setResult(undefined);
		const render = async () => {
			if (cancelled) return;
			try {
				const image = await renderDiagram(children, element, () => !cancelled);
				if (!cancelled && image) setResult({ source: children, revision, image });
			} catch {
				if (!cancelled) setResult({ source: children, revision, error: true });
			}
		};
		renderQueue = renderQueue.then(render, render);
		return () => {
			cancelled = true;
		};
	}, [children, streaming, hasResources, renderType, revision]);

	const current = result?.source === children && result.revision === revision ? result : undefined;
	const showSource = renderType === "code" || streaming || hasResources || current?.error;
	return (
		<section
			ref={root}
			data-mermaid
			aria-label="Mermaid 图表"
			className={`my-2 min-w-0 overflow-hidden rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] bg-[var(--kit-bg)] text-[var(--kit-fg)] ${className ?? ""}`}
		>
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--kit-border)] bg-[var(--kit-bg-subtle)] px-3 py-1.5 text-xs">
				{header != null && <div className="min-w-0 truncate text-[var(--kit-fg-muted)]">{header}</div>}
				<div className="flex items-center gap-1">
					{(["image", "code"] as const).map((type) => (
						<button
							key={type}
							type="button"
							aria-pressed={renderType === type}
							aria-controls={panelId}
							onClick={() => {
								setRenderType(type);
								onRenderTypeChange?.(type);
							}}
							className="rounded-[var(--kit-radius-sm)] px-2 py-1 text-[var(--kit-fg-muted)] hover:bg-[var(--kit-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-accent)] aria-pressed:bg-[var(--kit-bg)] aria-pressed:text-[var(--kit-accent)]"
						>
							{type === "image" ? "图表" : "源码"}
						</button>
					))}
					{copyable && <Actions.Copy text={children} label="复制图表源码" />}
				</div>
			</div>
			<div id={panelId} className="p-3">
				{hasResources && (
					<p role="status" className="mb-2 text-sm text-[var(--kit-fg-muted)]">
						图片节点、嵌入资源及扩展节点语法仅显示源码。
					</p>
				)}
				{streaming && (
					<p role="status" className="mb-2 text-sm text-[var(--kit-fg-muted)]">
						图表生成中，先显示源码。
					</p>
				)}
				{current?.error && renderType === "image" && !streaming && (
					<div role="alert" className="mb-2 flex flex-wrap items-center gap-2 text-sm text-[var(--kit-fg-muted)]">
						<span>图表暂时无法渲染，请检查源码。</span>
						<button
							type="button"
							onClick={() => setRevision((value) => value + 1)}
							className="text-[var(--kit-accent)] underline underline-offset-2"
						>
							重新渲染
						</button>
					</div>
				)}
				{showSource ? (
					<CodeHighlighter lang="mermaid" header={false}>
						{children}
					</CodeHighlighter>
				) : current?.image ? (
					<div className="overflow-x-auto">
						<img src={current.image} alt="Mermaid 图表" className="mx-auto block max-w-full" />
					</div>
				) : (
					<p role="status" className="text-sm text-[var(--kit-fg-muted)]">
						正在渲染图表…
					</p>
				)}
			</div>
		</section>
	);
}
