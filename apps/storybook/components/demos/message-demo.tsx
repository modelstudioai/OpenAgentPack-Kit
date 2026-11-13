"use client";

import { ArtifactCard, Markdown, Message, MessageList, ReasoningBlock, ToolCallCard } from "@openagentpack/kit-chat-ui";
import type { ChatMessage, MessagePart } from "@openagentpack/kit-sdk/messages";
import { useState } from "react";

const SAMPLE_MARKDOWN = [
	"## 交付说明",
	"",
	"- 支持 **GFM**：表格、任务列表、删除线",
	"- 代码块高亮与 Mermaid 图表",
	"",
	"| 指标 | 值 |",
	"| --- | --- |",
	"| 会话 | 128 |",
	"| 完成率 | 92% |",
	"",
	"```ts",
	'const kit = createKitClient({ baseUrl: "/api" });',
	"```",
	"",
	"```mermaid",
	"flowchart LR",
	"  A[读取数据] --> B[提取指标]",
	"  B --> C[生成周报]",
	"```",
].join("\n");

/** 消息与富内容分片的静态预览：气泡、思考过程、工具三态、artifact、Markdown。 */
export const MESSAGES: ChatMessage[] = [
	{
		id: "u1",
		role: "user",
		status: "done",
		createdAt: "2026-10-30T03:00:00Z",
		parts: [{ id: "u1:text", type: "text", text: "把这份数据整理成周报" }],
	},
	{
		id: "a1",
		role: "assistant",
		status: "done",
		createdAt: "2026-10-30T03:00:05Z",
		parts: [
			{
				id: "a1:reasoning",
				type: "reasoning",
				text: "用户要的是结构化摘要：先抽取指标，再按周对比，最后给结论。",
				status: "done",
				startedAt: "2026-10-30T03:00:00Z",
			},
			{
				id: "a1:text",
				type: "text",
				text: "已读取数据并生成周报，要点如下：\n\n- 会话量环比 **+12%**\n- 工具失败率 0.8%\n- 两个待跟进项",
			},
			{
				id: "a1:tool",
				type: "tool",
				toolId: "t1",
				name: "read_file",
				status: "done",
				input: '{"path":"data.csv"}',
				output: "1024 行",
				startedAt: "2026-10-30T03:00:00Z",
				endedAt: "2026-10-30T03:00:04Z",
			},
			{
				id: "a1:artifact",
				type: "artifact",
				artifact: { file_id: "file_weekly", filename: "weekly-report.md", content_type: "text/markdown", size: 4096 },
			},
		],
	},
	{
		id: "a2",
		role: "assistant",
		status: "failed",
		parts: [{ id: "a2:text", type: "text", text: "调用 provider 超时" }],
	},
];

export function MessageDemo() {
	const [note, setNote] = useState<string | null>(null);
	return (
		<div data-kit-appearance="workspace" className="flex min-h-0 min-w-0 flex-1 flex-col">
			{note ? (
				<p role="status" className="px-4 pt-2 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
					{note}
				</p>
			) : null}
			<MessageList variant="workspace" messages={MESSAGES} onArtifactDownload={(id) => setNote(`触发下载：${id}`)} />
		</div>
	);
}

export function ToolStatesDemo() {
	const [status, setStatus] = useState<NonNullable<Extract<MessagePart, { type: "reasoning" }>["status"]>>("streaming");
	const [updates, setUpdates] = useState(0);
	const controlClass =
		"rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] px-3 py-2 text-[length:var(--kit-text-label)] hover:bg-[var(--kit-bg-subtle)] focus-visible:outline-2 focus-visible:outline-[var(--kit-focus)]";
	return (
		<div data-kit-appearance="workspace" className="min-w-0 flex-1 space-y-3 overflow-auto p-4">
			<fieldset className="flex flex-wrap gap-2">
				<legend className="sr-only">思考状态演示</legend>
				{(
					[
						["streaming", "思考中"],
						["done", "完成"],
						["failed", "失败"],
						["interrupted", "中断"],
					] as const
				).map(([value, label]) => (
					<button
						key={value}
						type="button"
						aria-pressed={status === value}
						className={`${controlClass} ${status === value ? "bg-[var(--kit-nav-active)] font-medium" : ""}`}
						onClick={() => setStatus(value)}
					>
						{label}
					</button>
				))}
				<button type="button" className={controlClass} onClick={() => setUpdates((value) => value + 1)}>
					追加思考内容
				</button>
			</fieldset>
			<p className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
				思考默认收起，同一行展示内容预览；手动展开后追加内容，保留展开状态。
			</p>
			{/* 不以 status 或正文作为 key；同阶段更新必须保留用户手动展开/收起。 */}
			<ReasoningBlock
				status={status}
				text={`先确认用户要的是对比，再整理需要核实的资料。${updates ? `\n已补充 ${updates} 条核对说明。` : ""}`}
			/>
			<ToolCallCard
				part={{ type: "tool", toolId: "r", name: "bash", status: "running", input: '{"command":"ls -la"}' }}
			/>
			<ToolCallCard
				part={{
					type: "tool",
					toolId: "d",
					name: "web_search",
					status: "done",
					input: '{"query":"kit"}',
					output: "命中 3 条结果",
				}}
			/>
			<ToolCallCard
				part={{ type: "tool", toolId: "e", name: "mcp_call", status: "error", input: "{}", output: "upstream 502" }}
			/>
			<ArtifactCard
				filename="quarterly.pptx"
				contentType="application/vnd.openxmlformats-officedocument.presentationml.presentation"
				onDownload={() => undefined}
			/>
		</div>
	);
}

export function MarkdownDemo() {
	return (
		<div className="flex-1 overflow-auto p-4">
			<Markdown>{SAMPLE_MARKDOWN}</Markdown>
		</div>
	);
}

export function SingleMessageDemo({ role = "assistant" }: { role?: "user" | "assistant" }) {
	const message = MESSAGES.find((m) => m.role === role) ?? MESSAGES[0]!;
	return (
		<div className="flex-1 p-4">
			<Message message={message} />
		</div>
	);
}
