import { CodeHighlighter } from "../../code-highlighter/index.tsx";
import { ProcessStep, ProcessValue, ProcessValueCode } from "../step/index.tsx";
import { toolSummary } from "../tool-summary/index.ts";

export type ToolPart = Extract<import("@openagentpack/kit-sdk/messages").MessagePart, { type: "tool" }>;

function displayValue(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return "内容无法序列化";
	}
}

/** JSON 对象/数组判定：仅接受可完整解析的结构化输出，其余按原文文本展示。 */
function isJsonPayload(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
	try {
		void JSON.parse(trimmed);
		return true;
	} catch {
		return false;
	}
}

/** 工具输出的内容感知渲染：结构化 JSON 用语法高亮代码块，其余保留原文文本。 */
function ToolOutput({ value }: { value: unknown }) {
	const text = displayValue(value);
	if (isJsonPayload(text))
		return (
			<CodeHighlighter lang="json" copyable className="rounded-[var(--kit-radius-sm)] bg-[var(--kit-bg-subtle)]">
				{text}
			</CodeHighlighter>
		);
	return <ProcessValueCode text={text} />;
}

/** 工具调用时间线步骤：动词 + 操作对象预览；输入保持代码块；输出按内容类型渲染。 */
export function ToolCallCard({
	part,
	className,
	contentMaxHeight,
}: {
	part: ToolPart;
	/** 追加到卡片根节点（details）的工具类。 */
	className?: string;
	/** 展开内容区限高，透传 ProcessStep；不传用默认 max-h-80。 */
	contentMaxHeight?: string;
}) {
	const labels = { running: "执行中", done: "已完成", error: "执行失败" };
	const { verb, badge } = toolSummary({ name: part.name, input: part.input });
	return (
		<ProcessStep
			ariaLabel={`工具调用 ${part.name}`}
			verb={verb}
			preview={badge}
			status={labels[part.status]}
			state={part.status === "running" ? "running" : part.status === "error" ? "failed" : "done"}
			className={className}
			contentMaxHeight={contentMaxHeight}
		>
			<dl className="space-y-3">
				{part.input !== undefined ? (
					<ProcessValue label="输入参数">
						<ProcessValueCode text={displayValue(part.input)} />
					</ProcessValue>
				) : null}
				{part.output !== undefined ? (
					<ProcessValue label="执行结果">
						<div className="animate-[var(--kit-animate-expand)] rounded-[var(--kit-radius-sm)] bg-[var(--kit-bg-subtle)] px-3 py-2">
							<ToolOutput value={part.output} />
						</div>
					</ProcessValue>
				) : null}
			</dl>
			{part.input === undefined && part.output === undefined ? (
				<p className="text-[var(--kit-fg-muted)]">暂无调用详情</p>
			) : null}
		</ProcessStep>
	);
}
