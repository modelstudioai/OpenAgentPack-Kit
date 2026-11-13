import { ProcessSpinner } from "../process/step/index.tsx";

/** 流式/等待期的指示行：正文末尾与列表尾部（首帧前）共用；文案与 StatusIndicator 对齐。 */
export function ProcessingIndicator({ className = "", label = "生成中…" }: { className?: string; label?: string }) {
	return (
		<p
			className={`flex items-center gap-1.5 text-[length:var(--kit-text-label)] text-[var(--kit-fg-muted)] ${className}`}
		>
			<ProcessSpinner className="size-3.5 text-[var(--kit-accent)]" />
			{label}
		</p>
	);
}

/** 可复制的消息原文：拼接全部 text 分片；用户消息含技能 token，与发送内容一致。 */
