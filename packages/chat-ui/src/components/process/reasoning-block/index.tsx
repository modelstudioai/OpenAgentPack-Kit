import { ProcessStep } from "../step/index.tsx";

export function ReasoningBlock({
	text,
	status,
	className,
	contentMaxHeight,
}: {
	text: string;
	status?: "streaming" | "done" | "failed" | "interrupted";
	/** 追加到卡片根节点（details）的工具类。 */
	className?: string;
	/** 展开内容区限高，透传 ProcessStep；不传用默认 max-h-80。 */
	contentMaxHeight?: string;
}) {
	const labels = { streaming: "思考中", done: "已思考", failed: "思考失败", interrupted: "已中断" };
	// 预览取首个非空行；流式期间随正文增长，始终默认收起。
	const preview = text
		.split("\n")
		.map((line) => line.trim())
		.find(Boolean);
	return (
		<ProcessStep
			ariaLabel="思考过程"
			verb={status ? labels[status] : "思考过程"}
			preview={preview}
			state={status === "streaming" ? "running" : status === "failed" ? "failed" : status ? "done" : "idle"}
			className={className}
			contentMaxHeight={contentMaxHeight}
		>
			<div className="text-[var(--kit-fg-muted)] leading-[var(--kit-leading-body)] [overflow-wrap:anywhere] whitespace-pre-wrap">
				{text}
			</div>
		</ProcessStep>
	);
}
