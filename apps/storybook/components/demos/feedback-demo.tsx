"use client";

import {
	Actions,
	type ActionsFeedbackValue,
	type ActionsVariant,
	CodeHighlighter,
	FileCard,
	Mermaid,
} from "@openagentpack/kit-chat-ui";
import { useState } from "react";
import { CONTROL_CLASS, TOOLBAR_CLASS } from "./general-demo.tsx";

/** 基本用法：items 配置按钮与二级子菜单；点击叶子项回传 key 并自动收起弹层。 */
export function ActionsDemo() {
	const [variant, setVariant] = useState<ActionsVariant>("borderless");
	const [disabled, setDisabled] = useState(false);
	const [note, setNote] = useState("尚未触发操作");
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					外观
					<select
						aria-label="外观"
						className={CONTROL_CLASS}
						value={variant}
						onChange={(event) => setVariant(event.target.value as ActionsVariant)}
					>
						<option value="borderless">无边框</option>
						<option value="outlined">描边</option>
						<option value="filled">填充</option>
					</select>
				</label>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={disabled} onChange={(event) => setDisabled(event.target.checked)} />
					禁用
				</label>
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
				<p className="text-sm">已生成周报：会话量环比 +12%，工具失败率 0.8%。</p>
				<Actions
					variant={variant}
					items={[
						{ key: "retry", label: "重新生成", disabled },
						{
							key: "more",
							label: "更多",
							disabled,
							subItems: [
								{ key: "save", label: "保存为草稿", disabled },
								{ key: "share", label: "分享", disabled: true },
							],
						},
					]}
					onClick={({ key }) => setNote(`onClick → ${key}`)}
				/>
				<p role="status" className="text-sm text-[var(--kit-fg-muted)]">
					{note}
				</p>
			</div>
		</div>
	);
}

/** Actions.Copy：默认浏览器剪贴板，onCopy 注入宿主实现；成功/失败由真实异步结果决定。 */
export function ActionsCopyDemo() {
	const [injectFailure, setInjectFailure] = useState(false);
	const [iconOnly, setIconOnly] = useState(false);
	const answer = "已生成周报：会话量环比 +12%，工具失败率 0.8%。";
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={injectFailure} onChange={(event) => setInjectFailure(event.target.checked)} />
					注入宿主失败（onCopy 抛错）
				</label>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={iconOnly} onChange={(event) => setIconOnly(event.target.checked)} />
					仅图标
				</label>
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
				<p className="text-sm">{answer}</p>
				<Actions>
					<Actions.Copy
						text={answer}
						label="复制回答"
						iconOnly={iconOnly}
						onCopy={injectFailure ? () => Promise.reject(new Error("宿主剪贴板不可用")) : undefined}
					/>
				</Actions>
				<p className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
					省略 onCopy 时用浏览器剪贴板；提供后由调用方执行复制（可接宿主 bridge），抛错即显示失败状态。
				</p>
			</div>
		</div>
	);
}

/** Actions.Feedback：受控赞踩，赞与踩互斥，重复点击当前选项回到 default。 */
export function ActionsFeedbackDemo() {
	const [value, setValue] = useState<ActionsFeedbackValue>("default");
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
				<p className="text-sm">已生成周报：会话量环比 +12%，工具失败率 0.8%。</p>
				<Actions>
					<Actions.Feedback value={value} onChange={setValue} />
				</Actions>
				<p role="status" className="text-sm text-[var(--kit-fg-muted)]">
					当前反馈：{value}；保存评价与上报埋点由调用方完成。
				</p>
			</div>
		</div>
	);
}

/** 基本 case：onClick 开预览为主入口，与 onDownload 同传时右侧出现独立下载图标（消息流交付文件形态）。 */
export function FileCardDemo() {
	const [note, setNote] = useState("点文件名或右侧下载图标，观察回调");
	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<div className="flex min-w-0 flex-1 flex-col items-start gap-4 p-4">
				<FileCard
					name="weekly-report.md"
					type="text/markdown"
					onClick={() => setNote("onClick → 打开 weekly-report.md 预览")}
					onDownload={() => setNote("onDownload → 经 server 代理下载 weekly-report.md")}
				/>
				<p role="status" className="text-sm text-[var(--kit-fg-muted)]">
					{note}
				</p>
			</div>
		</div>
	);
}

/** 缩略图演示用内联 SVG（离线可开，不引外部图源）。 */
const THUMBNAIL =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%237c8aa5'/%3E%3Cstop offset='1' stop-color='%233d4a5c'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='72' height='72' fill='url(%23g)'/%3E%3Ccircle cx='26' cy='26' r='8' fill='%23ffffff' opacity='.85'/%3E%3Cpath d='M8 60l16-18 12 12 10-12 18 18z' fill='%23ffffff' opacity='.7'/%3E%3C/svg%3E";

/** 入口组合：仅 onDownload 时文件名即下载入口；src 缩略图替代字符徽标；无回调纯展示，description 占第二行。 */
export function FileCardEntriesDemo() {
	const [note, setNote] = useState("点上方卡片的下载入口，观察回调");
	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<div className="flex min-w-0 flex-1 flex-col items-start gap-4 p-4">
				<FileCard name="source-data.csv" type="text/csv" onDownload={() => setNote("onDownload → source-data.csv")} />
				<FileCard
					name="cover.png"
					type="image/png"
					src={THUMBNAIL}
					onDownload={() => setNote("onDownload → cover.png")}
				/>
				<FileCard name="outline.txt" type="text/plain" description="生成周报时引用的数据文件" />
				<p role="status" className="text-sm text-[var(--kit-fg-muted)]">
					{note}
				</p>
			</div>
		</div>
	);
}

/** 加载与禁用：loading 阻止操作且第二行固定「加载中…」；disabled 整卡变暗并禁用。 */
export function FileCardStatesDemo() {
	const [loading, setLoading] = useState(false);
	const [disabled, setDisabled] = useState(false);
	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={loading} onChange={(event) => setLoading(event.target.checked)} />
					加载中
				</label>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={disabled} onChange={(event) => setDisabled(event.target.checked)} />
					禁用
				</label>
			</div>
			<div className="flex min-w-0 flex-1 flex-col items-start gap-4 p-4">
				<FileCard
					name="weekly-report.md"
					type="text/markdown"
					loading={loading}
					disabled={disabled}
					onClick={() => undefined}
					onDownload={() => undefined}
				/>
			</div>
		</div>
	);
}

const CODE_SAMPLES: Record<string, string> = {
	typescript:
		"type Feedback = 'like' | 'dislike';\n\nfunction describe(value: Feedback) {\n  return '反馈：' + value;\n}",
	json: '{\n  "message": "你好",\n  "completed": true\n}',
	unknown: "No registered language.\n  Keep original spacing.\nKeep every line.",
};

const CODE_LONG_SAMPLE =
	"const config = { endpoint: 'https://example.com/api/v2/agents/sessions/messages/stream', retries: 3, timeoutMs: 60_000, headers: { 'content-type': 'text/event-stream' } };";

/** 基本用法：lang 切换 token 高亮，行号只作展示；复制始终是传入的原始代码。 */
export function CodeHighlighterDemo() {
	const [lang, setLang] = useState("typescript");
	const [showLineNumbers, setShowLineNumbers] = useState(true);
	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					语言
					<select
						aria-label="语言"
						className={CONTROL_CLASS}
						value={lang}
						onChange={(event) => setLang(event.target.value)}
					>
						<option value="typescript">TypeScript</option>
						<option value="json">JSON</option>
					</select>
				</label>
				<label className="flex items-center gap-2">
					<input
						type="checkbox"
						checked={showLineNumbers}
						onChange={(event) => setShowLineNumbers(event.target.checked)}
					/>
					行号
				</label>
			</div>
			<div className="min-w-0 flex-1 p-4">
				<CodeHighlighter lang={lang} showLineNumbers={showLineNumbers}>
					{CODE_SAMPLES[lang]}
				</CodeHighlighter>
			</div>
		</div>
	);
}

/** 自定义标题与工具栏：header 传 ReactNode 显示文件名，false 隐藏整个工具栏（复制按钮一并隐藏）。 */
export function CodeHighlighterHeaderDemo() {
	const [headerMode, setHeaderMode] = useState<"lang" | "custom" | "hidden">("lang");
	const [copyable, setCopyable] = useState(true);
	const header =
		headerMode === "custom" ? (
			<span className="font-mono">scripts/deploy.ts</span>
		) : headerMode === "hidden" ? (
			false
		) : undefined;
	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					标题
					<select
						aria-label="标题"
						className={CONTROL_CLASS}
						value={headerMode}
						onChange={(event) => setHeaderMode(event.target.value as "lang" | "custom" | "hidden")}
					>
						<option value="lang">语言名</option>
						<option value="custom">文件名</option>
						<option value="hidden">隐藏工具栏</option>
					</select>
				</label>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={copyable} onChange={(event) => setCopyable(event.target.checked)} />
					复制按钮
				</label>
			</div>
			<div className="min-w-0 flex-1 p-4">
				<CodeHighlighter lang="typescript" header={header} copyable={copyable}>
					{CODE_SAMPLES.typescript}
				</CodeHighlighter>
			</div>
		</div>
	);
}

/** 纯文本降级与长行：未注册语言保留原文；长行不折行，Tab 聚焦滚动区后方向键可读行尾。 */
export function CodeHighlighterFallbackDemo() {
	const [mode, setMode] = useState<"unknown" | "long">("unknown");
	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					内容
					<select
						aria-label="内容"
						className={CONTROL_CLASS}
						value={mode}
						onChange={(event) => setMode(event.target.value as "unknown" | "long")}
					>
						<option value="unknown">未知语言</option>
						<option value="long">超长单行</option>
					</select>
				</label>
			</div>
			<div className="min-w-0 flex-1 p-4">
				<CodeHighlighter lang={mode === "unknown" ? "unknown" : "javascript"} showLineNumbers={mode === "unknown"}>
					{mode === "unknown" ? CODE_SAMPLES.unknown : CODE_LONG_SAMPLE}
				</CodeHighlighter>
			</div>
		</div>
	);
}

const DIAGRAMS: Record<string, string> = {
	flowchart: "flowchart LR\n  A[提交问题] --> B[生成回答]\n  B --> C[用户反馈]",
	sequence:
		"sequenceDiagram\n  participant U as 用户\n  participant A as Agent\n  U->>A: 提交问题\n  A-->>U: 返回回答\n  U->>A: 评价回答",
	invalid: "flowchart LR\n  A[尚未闭合的节点",
	resources: 'flowchart LR\n  A[品牌] --> B@{ icon: "https://cdn.example.com/logo.svg", label: "Logo" }',
};

/** 基本 case：Agent 返回的流程图 / 时序图；卡头切换图表与源码视图，复制按钮回传原文。 */
export function MermaidDemo() {
	const [diagram, setDiagram] = useState("flowchart");
	const [view, setView] = useState<"image" | "code">("image");
	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					图表内容
					<select
						aria-label="图表内容"
						className={CONTROL_CLASS}
						value={diagram}
						onChange={(event) => setDiagram(event.target.value)}
					>
						<option value="flowchart">流程图</option>
						<option value="sequence">时序图</option>
					</select>
				</label>
			</div>
			<div className="min-w-0 flex-1 space-y-3 overflow-auto p-4">
				<Mermaid onRenderTypeChange={setView}>{DIAGRAMS[diagram]}</Mermaid>
				<p role="status" className="text-sm text-[var(--kit-fg-muted)]">
					已选择视图：{view === "image" ? "图表" : "源码"}
				</p>
			</div>
		</div>
	);
}

/** 流式生成中：streaming 为 true 只展示源码；取消勾选模拟完整源码到达，自动渲染成图。 */
export function MermaidStreamingDemo() {
	const [streaming, setStreaming] = useState(true);
	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={streaming} onChange={(event) => setStreaming(event.target.checked)} />
					流式生成中
				</label>
			</div>
			<div className="min-w-0 flex-1 overflow-auto p-4">
				<Mermaid streaming={streaming}>{DIAGRAMS.flowchart}</Mermaid>
			</div>
		</div>
	);
}

/** 失败与资源降级：语法错误给错误提示与「重新渲染」；图片 / 扩展节点等资源语法只展示源码。 */
export function MermaidFallbackDemo() {
	const [mode, setMode] = useState("invalid");
	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					源码
					<select
						aria-label="源码"
						className={CONTROL_CLASS}
						value={mode}
						onChange={(event) => setMode(event.target.value)}
					>
						<option value="invalid">语法错误</option>
						<option value="resources">图片节点语法</option>
					</select>
				</label>
			</div>
			<div className="min-w-0 flex-1 overflow-auto p-4">
				<Mermaid>{DIAGRAMS[mode]}</Mermaid>
			</div>
		</div>
	);
}
