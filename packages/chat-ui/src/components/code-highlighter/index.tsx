import { common, createLowlight } from "lowlight";
import { type ReactNode, useMemo } from "react";
import { Actions } from "../actions/index.tsx";

export interface CodeHighlighterProps {
	children: string;
	lang?: string;
	header?: ReactNode | (() => ReactNode);
	copyable?: boolean;
	showLineNumbers?: boolean;
	className?: string;
}

const highlighter = createLowlight(common);
// 长输出保留全文与复制，避免在流式更新时同步创建大量语法节点。
const maxHighlightLength = 50_000;
type HighlightNode = ReturnType<typeof highlighter.highlight>["children"][number];

function tokenClass(names: unknown): string | undefined {
	if (!Array.isArray(names)) return undefined;
	if (names.some((name) => /comment|quote/.test(String(name)))) return "text-[var(--kit-fg-muted)] italic";
	if (names.some((name) => /string|regexp|addition/.test(String(name)))) return "text-[var(--kit-code-string)]";
	if (names.some((name) => /deletion/.test(String(name)))) return "text-[var(--kit-danger)]";
	if (names.some((name) => /keyword|selector|title|name|built_in/.test(String(name)))) {
		return "text-[var(--kit-code-keyword)]";
	}
	if (names.some((name) => /number|literal|attr|symbol|meta/.test(String(name)))) {
		return "text-[var(--kit-code-number)]";
	}
	return undefined;
}

function renderTokens(nodes: HighlightNode[]): ReactNode {
	return nodes.map((node, index) => {
		if (node.type === "text") return node.value;
		if (node.type !== "element") return null;
		return (
			<span key={index} className={tokenClass(node.properties.className)}>
				{renderTokens(node.children)}
			</span>
		);
	});
}

/** 只渲染语法树与原文；未知语言保留为纯文本，不执行代码或插入 HTML。 */
export function CodeHighlighter({
	children,
	lang,
	header,
	copyable = true,
	showLineNumbers = false,
	className,
}: CodeHighlighterProps) {
	const language = lang?.trim().toLowerCase() || "text";
	const highlighted = useMemo(() => {
		if (children.length > maxHighlightLength || !highlighter.registered(language)) return children;
		try {
			return renderTokens(highlighter.highlight(language, children).children);
		} catch {
			return children;
		}
	}, [children, language]);
	const title = typeof header === "function" ? header() : header;
	const label = title ?? language;
	const lineCount = children.split("\n").length;

	return (
		<section
			data-code-highlighter
			aria-label="代码块"
			className={`my-2 min-w-0 overflow-hidden rounded-[var(--kit-radius)] border border-[var(--kit-border-subtle)] bg-[var(--kit-bg-subtle)] text-[var(--kit-fg)] ${className ?? ""}`}
		>
			{title !== false && (
				<div className="flex items-center justify-between gap-2 border-b border-[var(--kit-border-subtle)] bg-[var(--kit-surface)] px-3 py-2 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
					<div className="min-w-0 truncate" title={typeof label === "string" ? label : undefined}>
						{label}
					</div>
					{copyable && (
						<div className="shrink-0">
							<Actions.Copy text={children} label="复制代码" />
						</div>
					)}
				</div>
			)}
			{/* biome-ignore lint/a11y/useSemanticElements: 保留预格式文本容器，同时将实际滚动区命名为代码内容。 */}
			<pre
				role="region"
				aria-label="代码内容"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: 代码的横向滚动区需要接收键盘焦点，让方向键可访问长行末尾。
				tabIndex={0}
				className="m-0 flex overflow-x-auto rounded-none border-0 bg-[var(--kit-bg-subtle)] p-3 font-mono text-[length:var(--kit-text-base)] leading-6 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--kit-focus)]"
			>
				{showLineNumbers && (
					<span
						aria-hidden="true"
						className="mr-3 shrink-0 select-none border-r border-[var(--kit-border-subtle)] pr-3 text-right text-[var(--kit-fg-muted)]"
					>
						{Array.from({ length: lineCount }, (_, index) => index + 1).join("\n")}
					</span>
				)}
				<code
					className="block min-w-0 flex-1 whitespace-pre rounded-none border-0 bg-transparent p-0 text-inherit"
					data-language={language}
				>
					{highlighted}
				</code>
			</pre>
		</section>
	);
}
