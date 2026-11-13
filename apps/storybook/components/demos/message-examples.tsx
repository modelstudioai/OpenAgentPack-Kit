"use client";

import { Message } from "@openagentpack/kit-chat-ui";
import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import { type ReactNode, useState } from "react";
import { CONTROL_CLASS, TOOLBAR_CLASS } from "./general-demo.tsx";

const BASIC_MESSAGES: ChatMessage[] = [
	{
		id: "basic-user",
		role: "user",
		status: "done",
		createdAt: "2026-11-09T02:00:00Z",
		parts: [{ id: "basic-user:text", type: "text", text: "请说明 **Message** 的用途。" }],
	},
	{
		id: "basic-assistant",
		role: "assistant",
		status: "done",
		createdAt: "2026-11-09T02:00:02Z",
		parts: [
			{
				id: "basic-assistant:text",
				type: "text",
				text: "**Message** 展示一条消息。\n\n支持 Markdown 和有序的内容分片。",
			},
		],
	},
];

const STATUS_MESSAGE: ChatMessage = {
	id: "status-message",
	role: "assistant",
	status: "streaming",
	parts: [{ id: "status-message:text", type: "text", text: "正在整理消息内容。" }],
};

const RICH_MESSAGE: ChatMessage = {
	id: "rich-message",
	role: "assistant",
	status: "done",
	createdAt: "2026-11-09T02:00:05Z",
	parts: [
		{
			id: "rich-message:reasoning",
			type: "reasoning",
			text: "先读取数据，再汇总关键指标。",
			status: "done",
			startedAt: "2026-11-09T02:00:00Z",
		},
		{
			id: "rich-message:tool",
			type: "tool",
			toolId: "read-data",
			name: "read_file",
			status: "done",
			input: { path: "data.csv" },
			output: { rows: 1024, complete: true },
			startedAt: "2026-11-09T02:00:00Z",
			endedAt: "2026-11-09T02:00:04Z",
		},
		{
			id: "rich-message:text",
			type: "text",
			text: "已读取 **1024 行**数据。\n\n- 会话量环比增长 12%\n- 工具失败率为 0.8%",
		},
		{ id: "rich-message:status", type: "status", text: "数据核对完成" },
		{
			id: "rich-message:unknown",
			type: "unknown",
			label: "扩展数据",
			value: { kind: "custom", text: "保留为可展开文本" },
		},
	],
};

const FILE_MESSAGES: ChatMessage[] = [
	{
		id: "files-user",
		role: "user",
		status: "done",
		createdAt: "2026-11-09T02:00:00Z",
		parts: [
			{ id: "files-user:attachment", type: "attachment", file: { file_id: "file-data", filename: "data.csv" } },
			{ id: "files-user:text", type: "text", text: "请把附件整理成周报。" },
		],
	},
	{
		id: "files-assistant",
		role: "assistant",
		status: "done",
		createdAt: "2026-11-09T02:00:06Z",
		parts: [
			{ id: "files-assistant:text", type: "text", text: "周报已生成。\n\n**要点**：本周会话量增长 12%。" },
			{
				id: "files-assistant:artifact",
				type: "artifact",
				artifact: { file_id: "file-report", filename: "weekly-report.md", content_type: "text/markdown" },
			},
		],
	},
];

const SKILL_MESSAGE: ChatMessage = {
	id: "skills-user",
	role: "user",
	status: "done",
	createdAt: "2026-11-09T02:00:00Z",
	parts: [
		{
			id: "skills-user:text",
			type: "text",
			text: "请[使用 Skill:summarize]整理资料，再[使用 Skill:unknown]补充说明。",
		},
	],
};

function Example({ toolbar, children }: { toolbar?: ReactNode; children: ReactNode }) {
	return (
		<div className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]">
			{toolbar ? <div className={TOOLBAR_CLASS}>{toolbar}</div> : null}
			<div className="min-w-0 space-y-4 p-4">{children}</div>
		</div>
	);
}

export function MessageBasicDemo() {
	return (
		<Example>
			{BASIC_MESSAGES.map((message) => (
				<Message key={message.id} message={message} />
			))}
		</Example>
	);
}

export function MessageWorkspaceDemo() {
	const [variant, setVariant] = useState<"default" | "workspace">("workspace");
	return (
		<Example
			toolbar={
				<label className="flex items-center gap-2">
					消息布局
					<select
						className={CONTROL_CLASS}
						value={variant}
						onChange={(event) => setVariant(event.target.value as typeof variant)}
					>
						<option value="default">default（双气泡）</option>
						<option value="workspace">workspace（工作区）</option>
					</select>
				</label>
			}
		>
			{BASIC_MESSAGES.map((message) => (
				<Message key={message.id} variant={variant} message={message} />
			))}
		</Example>
	);
}

export function MessageStatusDemo() {
	const [role, setRole] = useState<ChatMessage["role"]>("assistant");
	const [status, setStatus] = useState<ChatMessage["status"]>("streaming");
	const [text, setText] = useState("正在整理消息内容。");
	return (
		<Example
			toolbar={
				<>
					<label className="flex items-center gap-2">
						角色
						<select
							className={CONTROL_CLASS}
							value={role}
							onChange={(event) => setRole(event.target.value as typeof role)}
						>
							<option value="user">用户</option>
							<option value="assistant">Agent</option>
						</select>
					</label>
					<label className="flex items-center gap-2">
						消息状态
						<select
							className={CONTROL_CLASS}
							value={status}
							onChange={(event) => setStatus(event.target.value as typeof status)}
						>
							<option value="pending">pending（发送中）</option>
							<option value="streaming">streaming（流式输出）</option>
							<option value="done">done（已完成）</option>
							<option value="failed">failed（失败）</option>
							<option value="interrupted">interrupted（已中断）</option>
						</select>
					</label>
					<button
						type="button"
						className={`${CONTROL_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
						disabled={status !== "streaming" || role !== "assistant"}
						onClick={() => setText((current) => `${current}\n新增一段内容。`)}
					>
						追加内容
					</button>
				</>
			}
		>
			<Message
				variant="workspace"
				message={{ ...STATUS_MESSAGE, role, status, parts: [{ id: "status-message:text", type: "text", text }] }}
			/>
		</Example>
	);
}

export function MessagePartsDemo() {
	return (
		<Example>
			<Message variant="workspace" message={RICH_MESSAGE} />
		</Example>
	);
}

export function MessageFilesDemo() {
	const [note, setNote] = useState("点击文件名称、下载或复制，查看回调参数。");
	return (
		<Example>
			{FILE_MESSAGES.map((message) => (
				<Message
					key={message.id}
					variant="workspace"
					message={message}
					onArtifactOpen={(id, type) => setNote(`打开文件：${id}（${type ?? "未知类型"}）`)}
					onArtifactDownload={(id) => setNote(`下载文件：${id}`)}
					onCopy={(text) => setNote(`复制原文：${text}`)}
				/>
			))}
			<p role="status" className="whitespace-pre-wrap break-words text-sm text-[var(--kit-fg-muted)]">
				{note}
			</p>
		</Example>
	);
}

export function MessageSkillsDemo() {
	const [known, setKnown] = useState(true);
	return (
		<Example
			toolbar={
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={known} onChange={(event) => setKnown(event.target.checked)} />
					提供 summarize 技能名单
				</label>
			}
		>
			<Message variant="workspace" message={SKILL_MESSAGE} skills={known ? ["summarize"] : undefined} />
		</Example>
	);
}

// 示例数据与实际预览共用；源码面板给出可独立运行的接入示例。
function exampleSource(data: string, body: string, stateful = false) {
	return `"use client";

import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import { Message } from "@openagentpack/kit-chat-ui";
${stateful ? 'import { useState } from "react";\n' : ""}
${data}

export function MessageExample() {
${body}
}`;
}

const basicSource = `const messages: ChatMessage[] = ${JSON.stringify(BASIC_MESSAGES, null, 2)};`;

export const MESSAGE_EXAMPLE_CODE = {
	basic: exampleSource(
		basicSource,
		`  return <div className="space-y-4 p-4" data-kit-appearance="workspace">
    {messages.map((message) => <Message key={message.id} message={message} />)}
  </div>;`,
	),
	workspace: exampleSource(
		basicSource,
		`  const [variant, setVariant] = useState<"default" | "workspace">("workspace");
  return <div className="space-y-4 p-4" data-kit-appearance="workspace">
    <label>消息布局 <select value={variant} onChange={(event) => setVariant(event.target.value as typeof variant)}>
      <option value="default">default（双气泡）</option>
      <option value="workspace">workspace（工作区）</option>
    </select></label>
    {messages.map((message) => <Message key={message.id} variant={variant} message={message} />)}
  </div>;`,
		true,
	),
	status: exampleSource(
		`const initial: ChatMessage = ${JSON.stringify(STATUS_MESSAGE, null, 2)};`,
		`  const [role, setRole] = useState<ChatMessage["role"]>("assistant");
  const [status, setStatus] = useState<ChatMessage["status"]>("streaming");
  const [text, setText] = useState("正在整理消息内容。");
  return <div className="space-y-4 p-4" data-kit-appearance="workspace">
    <label>角色 <select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
      <option value="user">用户</option><option value="assistant">Agent</option>
    </select></label>
    <label>消息状态 <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
      <option value="pending">pending</option><option value="streaming">streaming</option>
      <option value="done">done</option><option value="failed">failed</option>
      <option value="interrupted">interrupted</option>
    </select></label>
    <button type="button" disabled={status !== "streaming" || role !== "assistant"}
      onClick={() => setText((current) => current + "\\n新增一段内容。")}>追加内容</button>
    <Message variant="workspace" message={{ ...initial, role, status,
      parts: [{ id: "status-message:text", type: "text", text }] }} />
  </div>;`,
		true,
	),
	parts: exampleSource(
		`const message: ChatMessage = ${JSON.stringify(RICH_MESSAGE, null, 2)};`,
		`  return <div className="p-4" data-kit-appearance="workspace">
    <Message variant="workspace" message={message} />
  </div>;`,
	),
	files: exampleSource(
		`const messages: ChatMessage[] = ${JSON.stringify(FILE_MESSAGES, null, 2)};`,
		`  const [note, setNote] = useState("点击文件名称、下载或复制，查看回调参数。");
  return <div className="space-y-4 p-4" data-kit-appearance="workspace">
    {messages.map((message) => <Message key={message.id} variant="workspace" message={message}
      onArtifactOpen={(id, type) => setNote(\`打开文件：\${id}（\${type ?? "未知类型"}）\`)}
      onArtifactDownload={(id) => setNote(\`下载文件：\${id}\`)}
      onCopy={(text) => setNote(\`复制原文：\${text}\`)}
    />)}
    <p role="status" className="whitespace-pre-wrap">{note}</p>
  </div>;`,
		true,
	),
	skills: exampleSource(
		`const message: ChatMessage = ${JSON.stringify(SKILL_MESSAGE, null, 2)};`,
		`  const [known, setKnown] = useState(true);
  return <div className="space-y-4 p-4" data-kit-appearance="workspace">
    <label><input type="checkbox" checked={known} onChange={(event) => setKnown(event.target.checked)} />
      提供 summarize 技能名单
    </label>
    <Message variant="workspace" message={message} skills={known ? ["summarize"] : undefined} />
  </div>;`,
		true,
	),
};
