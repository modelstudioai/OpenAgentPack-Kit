"use client";

import { EmptyState, MessageList, MessageListSkeleton, ToolApprovalCard } from "@openagentpack/kit-chat-ui";
import type { ChatToolApproval } from "@openagentpack/kit-sdk/chat";
import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import { useMemo, useState } from "react";
import { CONTROL_CLASS, TOOLBAR_CLASS } from "./general-demo.tsx";
import { MESSAGES } from "./message-demo.tsx";

const FLOW_USER: ChatMessage = {
	id: "flow-user",
	role: "user",
	status: "done",
	createdAt: "2026-10-30T03:05:00Z",
	parts: [{ id: "flow-user:text", type: "text", text: "把上一轮的周报再整理一次。" }],
};

const FLOW_APPROVAL: ChatToolApproval = {
	batch_id: "list-demo-batch",
	call_id: "list-demo-call",
	request_event_id: "list-demo-request",
	name: "write_file",
	tool_type: "builtin",
	arguments: { path: "/mnt/session/report.md", content: "# 调研结果\n请核对文件写入范围。" },
	actionable: true,
	status: "pending",
};

type FlowMode = "idle" | "sending" | "generating" | "approval";

const FLOW_MODES = [
	["idle", "空闲"],
	["sending", "发送中"],
	["generating", "生成中"],
	["approval", "待审批"],
] as const;

/** 等待指示与审批卡互斥：requires_action 阶段由调用方不再传 pending。 */
export function MessageListFlowDemo() {
	const [mode, setMode] = useState<FlowMode>("generating");
	const [approval, setApproval] = useState(FLOW_APPROVAL);
	const messages = useMemo(() => (mode === "idle" ? MESSAGES : [...MESSAGES, FLOW_USER]), [mode]);
	return (
		<div
			data-kit-appearance="workspace"
			className="relative min-h-[inherit] min-w-0 flex-1 bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className="absolute inset-0 flex min-h-0 flex-col">
				<div className={TOOLBAR_CLASS}>
					<fieldset className="flex flex-wrap gap-2">
						<legend className="sr-only">回合阶段演示</legend>
						{FLOW_MODES.map(([value, label]) => (
							<button
								key={value}
								type="button"
								aria-pressed={mode === value}
								className={`${CONTROL_CLASS} ${mode === value ? "bg-[var(--kit-nav-active)] font-medium" : ""}`}
								onClick={() => {
									setMode(value);
									if (value === "approval") setApproval(FLOW_APPROVAL);
								}}
							>
								{label}
							</button>
						))}
					</fieldset>
				</div>
				<MessageList
					variant="workspace"
					messages={messages}
					scrollKey="flow-demo"
					pending={mode === "sending" || mode === "generating"}
					pendingLabel={mode === "sending" ? "发送中…" : undefined}
					approvals={
						mode === "approval" ? (
							<ToolApprovalCard
								approval={approval}
								onDecision={async ({ result }) =>
									setApproval((current) => ({ ...current, status: "submitted", result }))
								}
								onRefresh={async () => setApproval(FLOW_APPROVAL)}
							/>
						) : null
					}
				/>
			</div>
		</div>
	);
}

// 6 个回合的长对话：预览视口装不下，点击锚点能看见滚动跳转。
const ANCHOR_TOPICS = [
	[
		"先梳理这份调研的核心结论。",
		"核心结论有三点：\n\n1. 会话量环比增长 12%\n2. 工具失败率 0.8%\n3. 两个待跟进项需要业务方确认排期。\n\n执行层面的风险集中在工具调用链路，建议先补齐重试与超时策略，再推进后续联调。",
	],
	[
		"把结论翻译成英文。",
		"Key findings: session volume grew 12% month over month, the tool failure rate stayed at 0.8%, and two follow-ups are pending business confirmation.\n\nA short risk note on tool-calling reliability can be appended after the numbered list.",
	],
	[
		"按结论起草一封跟进邮件。",
		"邮件草稿如下，收件人与抄送留空待填：\n\n开头概述三点结论，正文列出跟进项、责任人与期望完成时间，结尾附上数据来源与统计口径说明，便于对方核对。",
	],
	[
		"再压缩成三条要点。",
		"三条要点已生成：增长数据、稳定性表现、待跟进事项。\n\n每条都控制在 30 字以内，可直接复制进周报正文或口头汇报稿。",
	],
	[
		"为周报补充图表建议。",
		"建议用柱状图对比近四周会话量，用折线图展示工具失败率走势。\n\n两张图都标注数据口径与统计区间，避免读者把周环比误读成月环比。",
	],
	[
		"起草汇报用的开场白。",
		"开场白先给结论再给数据：本周会话量增长 12%，稳定性保持良好，有两项事务需要协调排期。\n\n后续段落按「数据—风险—请求支持」展开，控制在两分钟内讲完。",
	],
] as const;

const ANCHOR_MESSAGES: ChatMessage[] = ANCHOR_TOPICS.flatMap(([question, answer], index) => [
	{
		id: `anchor-user-${index}`,
		role: "user",
		status: "done",
		createdAt: `2026-11-09T02:${String(index * 3).padStart(2, "0")}:00Z`,
		parts: [{ id: `anchor-user-${index}:text`, type: "text", text: question }],
	},
	{
		id: `anchor-assistant-${index}`,
		role: "assistant",
		status: "done",
		createdAt: `2026-11-09T02:${String(index * 3 + 2).padStart(2, "0")}:00Z`,
		parts: [{ id: `anchor-assistant-${index}:text`, type: "text", text: answer }],
	},
]);

/** 锚点栏在小于 768px 的断点隐藏，桌面预览可见；跳转只滚动本列表容器。 */
export function MessageListAnchorDemo() {
	const [anchorRail, setAnchorRail] = useState(true);
	return (
		<div
			data-kit-appearance="workspace"
			className="relative min-h-[inherit] min-w-0 flex-1 bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className="absolute inset-0 flex min-h-0 flex-col">
				<div className={TOOLBAR_CLASS}>
					<label className="flex items-center gap-2">
						<input type="checkbox" checked={anchorRail} onChange={(event) => setAnchorRail(event.target.checked)} />
						回合锚点栏
					</label>
				</div>
				<MessageList variant="workspace" messages={ANCHOR_MESSAGES} scrollKey="anchor-demo" anchorRail={anchorRail} />
			</div>
		</div>
	);
}

/** 演示固定展示骨架屏；真实接入在消息为空且未 connected 时渲染。 */
export function MessageListSkeletonDemo() {
	return (
		<div data-kit-appearance="workspace" className="flex min-w-0 flex-1 flex-col">
			<MessageList variant="workspace" messages={[]} scrollKey="skeleton-demo" empty={<MessageListSkeleton />} />
		</div>
	);
}

function buildVirtualMessages(count: number): ChatMessage[] {
	const messages: ChatMessage[] = [];
	for (let index = 0; index < count / 2; index += 1) {
		const createdAt = new Date(Date.UTC(2026, 10, 9, 2, index)).toISOString();
		messages.push(
			{
				id: `virtual-user-${index}`,
				role: "user",
				status: "done",
				createdAt,
				parts: [{ id: `virtual-user-${index}:text`, type: "text", text: `第 ${index + 1} 问：长会话的滚动还流畅吗？` }],
			},
			{
				id: `virtual-assistant-${index}`,
				role: "assistant",
				status: "done",
				createdAt,
				parts: [
					{
						id: `virtual-assistant-${index}:text`,
						type: "text",
						text: `第 ${index + 1} 条回答：DOM 只保留视口附近窗口，窗口外按估算高度占位，进入视口后回写真实行高。`,
					},
				],
			},
		);
	}
	return messages;
}

/** 数据层始终传全量 messages；虚拟滚动只影响 DOM，宿主不需要分页。 */
export function MessageListVirtualDemo() {
	const [count, setCount] = useState(1000);
	const [virtualize, setVirtualize] = useState(true);
	const messages = useMemo(() => buildVirtualMessages(count), [count]);
	return (
		<div
			data-kit-appearance="workspace"
			className="relative min-h-[inherit] min-w-0 flex-1 bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className="absolute inset-0 flex min-h-0 flex-col">
				<div className={TOOLBAR_CLASS}>
					<button type="button" className={CONTROL_CLASS} onClick={() => setCount(1000)}>
						生成 1000 条消息
					</button>
					<button type="button" className={CONTROL_CLASS} onClick={() => setCount(0)}>
						清空
					</button>
					<label className="flex items-center gap-2">
						<input type="checkbox" checked={virtualize} onChange={(event) => setVirtualize(event.target.checked)} />
						虚拟滚动
					</label>
					<span role="status" className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
						消息数：{count}
					</span>
				</div>
				<MessageList
					variant="workspace"
					messages={messages}
					scrollKey="virtual-demo"
					virtualize={virtualize}
					empty={<EmptyState title="消息列表为空" hint="点击生成 1000 条消息观察虚拟滚动" />}
				/>
			</div>
		</div>
	);
}

/** 源码面板展示的示例：与文档「代码演示」各小节一一对应。 */
export const MESSAGE_LIST_EXAMPLE_CODE = {
	flow: `import { MessageList, ToolApprovalCard } from "@openagentpack/kit-chat-ui";

<div className="flex h-full min-h-0 flex-col" data-kit-appearance="workspace">
  <MessageList
    variant="workspace"
    messages={chat.messages}
    scrollKey={sessionId}
    pending={turnInFlight}
    pendingLabel="发送中…"
    approvals={
      chat.approvals.length > 0 ? (
        chat.approvals.map((approval) => (
          <ToolApprovalCard
            key={[approval.batch_id, approval.call_id].join(":")}
            approval={approval}
            onDecision={chat.submitApproval}
            onRefresh={chat.refreshApprovals}
          />
        ))
      ) : null
    }
  />
</div>`,
	anchor: `import { MessageList } from "@openagentpack/kit-chat-ui";

<div className="flex h-full min-h-0 flex-col" data-kit-appearance="workspace">
  <MessageList
    variant="workspace"
    messages={chat.messages}
    scrollKey={sessionId}
    anchorRail
  />
</div>`,
	skeleton: `import { MessageList, MessageListSkeleton } from "@openagentpack/kit-chat-ui";

// 历史回放尚未就绪（消息为空且未 connected）时展示骨架。
<MessageList
  variant="workspace"
  messages={chat.messages}
  scrollKey={sessionId}
  empty={!chat.connected && chat.messages.length === 0 ? <MessageListSkeleton /> : <EmptyState title="开始对话" />}
/>`,
	virtual: `import { MessageList } from "@openagentpack/kit-chat-ui";

// 数据层传全量 messages，DOM 只保留视口附近窗口；宿主不需要分页。
<div className="flex h-full min-h-0 flex-col" data-kit-appearance="workspace">
  <MessageList
    variant="workspace"
    messages={chat.messages}
    scrollKey={sessionId}
    virtualize
  />
</div>`,
};
