import { type ComponentPropsWithoutRef, createContext, useContext } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { CodeHighlighter } from "../code-highlighter/index.tsx";
import { Mermaid } from "../mermaid/index.tsx";

function hasClosingFence(source: string, quoted: boolean) {
	const lines = source.split(/\r?\n/);
	const opening = lines[0]?.match(/^\s*(`{3,}|~{3,})/);
	const lastLine = quoted ? lines.at(-1)?.replace(/^(?:\s*>\s*)+/, "") : lines.at(-1);
	const closing = lastLine?.match(/^\s*(`{3,}|~{3,})\s*$/);
	return Boolean(
		lines.length > 1 &&
			opening &&
			closing &&
			opening[1]?.[0] === closing[1]?.[0] &&
			closing[1]!.length >= opening[1]!.length,
	);
}

// 原文随每个 Markdown 实例更新；renderer 本身保持稳定，避免重挂载图表并丢失用户选择。
const MarkdownSource = createContext("");

function MarkdownPre({ node, children }: ComponentPropsWithoutRef<"pre"> & ExtraProps) {
	const markdown = useContext(MarkdownSource);
	const code = node?.children.find((child) => child.type === "element" && child.tagName === "code");
	if (code?.type !== "element") return <pre>{children}</pre>;
	const classes = code.properties.className;
	const lang = Array.isArray(classes)
		? classes
				.map(String)
				.find((name) => name.startsWith("language-"))
				?.slice(9)
		: undefined;
	const value = code.children
		.map((child) => (child.type === "text" ? child.value : ""))
		.join("")
		.replace(/\n$/, "");
	if (lang?.toLowerCase() !== "mermaid") return <CodeHighlighter lang={lang}>{value}</CodeHighlighter>;
	const start = node?.position?.start.offset ?? 0;
	const source = markdown.slice(start, node?.position?.end.offset);
	const linePrefix = markdown.slice(markdown.lastIndexOf("\n", start - 1) + 1, start);
	return <Mermaid streaming={!hasClosingFence(source, linePrefix.includes(">"))}>{value}</Mermaid>;
}

const components: Components = {
	pre: MarkdownPre,
	code: ({ node, ...props }) => (
		<code
			{...props}
			className="rounded-[var(--kit-radius-xs)] bg-[var(--kit-bg-subtle)] px-1 py-0.5 font-mono text-[length:var(--kit-text-base)] [overflow-wrap:anywhere]"
		/>
	),
	h1: ({ node, ...props }) => (
		<h1 {...props} className="mt-8 mb-4 text-[length:var(--kit-text-prose-title)] font-semibold leading-snug" />
	),
	h2: ({ node, ...props }) => (
		<h2 {...props} className="mt-6 mb-3 text-[length:var(--kit-text-prose-heading)] font-semibold leading-snug" />
	),
	h3: ({ node, ...props }) => (
		<h3 {...props} className="mt-5 mb-2 text-[length:var(--kit-text-prose-subheading)] font-semibold leading-snug" />
	),
	h4: ({ node, ...props }) => (
		<h4 {...props} className="mt-4 mb-2 text-[length:var(--kit-text-heading)] font-semibold leading-snug" />
	),
	h5: ({ node, ...props }) => <h5 {...props} className="mt-4 mb-2 font-semibold" />,
	h6: ({ node, ...props }) => <h6 {...props} className="mt-4 mb-2 font-semibold text-[var(--kit-fg-muted)]" />,
	strong: ({ node, ...props }) => <strong {...props} className="font-semibold" />,
	a: ({ node, ...props }) => (
		<a
			{...props}
			className="rounded-[var(--kit-radius-xs)] text-[var(--kit-accent)] underline decoration-[var(--kit-border)] underline-offset-4 [overflow-wrap:anywhere] hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]"
			target="_blank"
			rel="noreferrer noopener"
		/>
	),
	blockquote: ({ node, ...props }) => (
		<blockquote
			{...props}
			className="my-4 border-l-2 border-[var(--kit-border)] pl-4 text-[var(--kit-fg-muted)] [&>:first-child]:mt-0 [&>:last-child]:mb-0"
		/>
	),
	hr: ({ node, ...props }) => <hr {...props} className="my-6 border-0 border-t border-[var(--kit-border-subtle)]" />,
	table: ({ node, ...props }) => (
		<section
			aria-label="表格"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: 横向滚动区域需要接收键盘焦点，让方向键可访问屏幕外的列。
			tabIndex={0}
			className="my-4 max-w-full overflow-x-auto rounded-[var(--kit-radius-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]"
		>
			<table {...props} className="w-max min-w-full border-collapse text-[length:var(--kit-text-label)]" />
		</section>
	),
	th: ({ node, ...props }) => (
		<th
			{...props}
			className="border border-[var(--kit-border)] bg-[var(--kit-bg-subtle)] px-3 py-2 text-left font-semibold"
		/>
	),
	td: ({ node, ...props }) => <td {...props} className="border border-[var(--kit-border)] px-3 py-2 align-top" />,
	p: ({ node, ...props }) => <p {...props} className="my-3 leading-[var(--kit-leading-body)]" />,
	ul: ({ node, className, ...props }) => (
		<ul {...props} className={`my-3 list-disc space-y-1 pl-6 marker:text-[var(--kit-fg-muted)] ${className ?? ""}`} />
	),
	ol: ({ node, className, ...props }) => (
		<ol
			{...props}
			className={`my-3 list-decimal space-y-1 pl-6 marker:text-[var(--kit-fg-muted)] ${className ?? ""}`}
		/>
	),
	li: ({ node, className, ...props }) => (
		<li
			{...props}
			className={`pl-1 [&>ol]:my-2 [&>ul]:my-2 [&>p]:my-2 [&.task-list-item]:list-none [&>input[type=checkbox]]:mr-2 [&>input[type=checkbox]]:accent-[var(--kit-accent)] ${className ?? ""}`}
		/>
	),
};

/** Markdown 渲染：gfm + sanitize；代码和完整 Mermaid 围栏复用反馈组件。 */
export function Markdown({ children }: { children: string }) {
	return (
		<MarkdownSource.Provider value={children}>
			<div className="min-w-0 text-[length:var(--kit-text-body)] leading-[var(--kit-leading-body)] [overflow-wrap:anywhere] [&>:first-child]:mt-0 [&>:last-child]:mb-0">
				<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
					{children}
				</ReactMarkdown>
			</div>
		</MarkdownSource.Provider>
	);
}
