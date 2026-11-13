"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { isShowcaseName, type ShowcaseName } from "../lib/showcase-names.ts";
import { MenuAlignDemo, MenuDemo } from "./demos/basic-demo.tsx";
import { ChatDemo } from "./demos/chat-demo.tsx";
import { StatesDemo, StatusDemo, ThreadDemo } from "./demos/chrome-demo.tsx";
import {
	AttachmentFileCardDemo,
	AttachmentsDemo,
	AttachmentsOverflowDemo,
	AttachmentsStatusDemo,
	SenderAttachmentsDemo,
	SenderDemo,
	SenderSkillsDemo,
	SenderSlotsDemo,
	SuggestionDemo,
} from "./demos/express-demo.tsx";
import {
	ActionsCopyDemo,
	ActionsDemo,
	ActionsFeedbackDemo,
	CodeHighlighterDemo,
	CodeHighlighterFallbackDemo,
	CodeHighlighterHeaderDemo,
	FileCardDemo,
	FileCardEntriesDemo,
	FileCardStatesDemo,
	MermaidDemo,
	MermaidFallbackDemo,
	MermaidStreamingDemo,
} from "./demos/feedback-demo.tsx";
import {
	AgentHeaderActionsDemo,
	AgentHeaderDemo,
	MessageListDemo,
	SessionListDemo,
	SessionListStatusDemo,
	SessionSidebarBasicDemo,
	SessionSidebarWorkspaceDemo,
	SubAgentPanelDemo,
	SubAgentPanelHistoryDemo,
} from "./demos/general-demo.tsx";
import { MarkdownDemo, MessageDemo, ToolStatesDemo } from "./demos/message-demo.tsx";
import {
	MESSAGE_EXAMPLE_CODE,
	MessageBasicDemo,
	MessageFilesDemo,
	MessagePartsDemo,
	MessageSkillsDemo,
	MessageStatusDemo,
	MessageWorkspaceDemo,
} from "./demos/message-examples.tsx";
import {
	MESSAGE_LIST_EXAMPLE_CODE,
	MessageListAnchorDemo,
	MessageListFlowDemo,
	MessageListSkeletonDemo,
	MessageListVirtualDemo,
} from "./demos/message-list-examples.tsx";
import { MultiAgentDemo } from "./demos/multi-agent-demo.tsx";
import { BailianProviderDemo, TransformedProviderDemo, TransformMessageDemo } from "./demos/provider-demo.tsx";
import {
	ApprovalDemo,
	ControllerDemo,
	KitStreamDemo,
	RequestBasicDemo,
	RequestCustomDemo,
	RequestErrorDemo,
	RequestStreamDemo,
	SessionsDemo,
	SseParserDemo,
	SseStreamDemo,
	UseChatDemo,
} from "./demos/sdk-demo.tsx";
import { ToolApprovalDemo, ToolApprovalGroupDemo, ToolApprovalRecoveryDemo } from "./demos/tool-approval-demo.tsx";
import { TooltipDemo, TooltipOverflowDemo, TooltipRichDemo } from "./demos/tooltip-demo.tsx";
import { PromptsDemo, PromptsLayoutDemo, PromptsNestDemo } from "./demos/wake-demo.tsx";
import { Preview } from "./preview.tsx";

// Layout 首次渲染依赖浏览器视口。预览在客户端初始化，避免静态 HTML 的桌面结构与窄屏不一致。
const LayoutDemo = dynamic(() => import("./demos/layout-demo.tsx").then((module) => module.LayoutDemo), {
	ssr: false,
	loading: () => <p role="status">正在加载布局预览…</p>,
});

interface ShowcaseEntry {
	title: string;
	/** copy-in 命令：必须是 packages/chat-ui/registry.json 里真实存在的组件名；SDK API 演示可省略 */
	command?: string;
	code: string;
	Demo: ComponentType;
}

const CHAT_CODE = `import { Chat, Prompts } from "@openagentpack/kit-chat-ui";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";

const chat = useChat(sessionId);
// 演示候选；真实应用改为当前 Agent 详情中的 resources.skills。
const skills = [
  { name: "summarize", description: "归纳资料中的重点与下一步行动" },
  { name: "writing", description: "整理文案、改写与写作提纲" },
];

<div className="flex h-dvh flex-col" data-kit-appearance="workspace">
<Chat
  variant="workspace"
  messages={chat.messages}
  scrollKey={sessionId}
  canSend={chat.canSend}
  turnRunning={chat.turnRunning}
  onSend={(text, skills) => chat.send(text, { skills })}
  skills={skills}
  onStop={chat.stop}
  onArtifactDownload={(fileId) => download(fileId)}
  empty={
    <Prompts
      wrap
      items={agent.suggested_prompts.map((prompt) => ({ key: prompt, label: prompt }))}
      onItemClick={({ data }) => chat.send(data.key)}
    />
  }
/>
</div>`;

const MESSAGE_CODE = `import { MessageList } from "@openagentpack/kit-chat-ui";

// messages 由 kit-sdk 的 session store 归并而来：
// 按原始顺序渲染 text / reasoning / tool / artifact / status / unknown 分片
<div className="flex h-dvh flex-col" data-kit-appearance="workspace">
  <MessageList variant="workspace" messages={chat.messages} scrollKey={sessionId} onArtifactDownload={download} />
</div>`;

const MESSAGE_LIST_CODE = `import { EmptyState, MessageList } from "@openagentpack/kit-chat-ui";

// 父容器提供有界高度，MessageList 负责内部滚动。
<div className="flex h-full min-h-0 flex-col" data-kit-appearance="workspace">
  <MessageList
    variant="workspace"
    messages={chat.messages}
    scrollKey={sessionId}
    autoScroll
    empty={<EmptyState title="开始对话" />}
    onArtifactDownload={download}
  />
</div>`;

const SESSION_LIST_CODE = `import { SessionList } from "@openagentpack/kit-chat-ui";

<div data-kit-appearance="workspace">
<SessionList
  variant="workspace"
  sessions={sessions}
  activeId={sessionId}
  onSelect={setSessionId}
/>
</div>
// 行尾「更多操作」菜单经 menu={(session) => …} 传入业务元素（含 ⋯ 触发按钮），见「行内状态与更多操作」示例。`;

const SESSION_LIST_STATUS_CODE = `import { Menu, MenuContent, MenuItem, MenuTrigger, SessionList } from "@openagentpack/kit-chat-ui";
import { useState } from "react";

// 行尾「更多操作」菜单经 render prop 传入：每行渲染时调用 menu(session)，session 在闭包里；
// 重命名项改 editingId 进受控行内编辑，归档/删除先经确认弹窗。
function RowMenu({ onClick }: { onClick: (action: "rename" | "archive" | "delete") => void }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" aria-label="更多操作" title="更多操作" className="grid size-full cursor-pointer place-items-center rounded-[var(--kit-radius-sm)] outline-none">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
            <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
          </svg>
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem onSelect={() => onClick("rename")}>重命名</MenuItem>
        <MenuItem onSelect={() => onClick("archive")}>归档</MenuItem>
        <MenuItem className="text-[var(--kit-danger)]" onSelect={() => onClick("delete")}>删除</MenuItem>
      </MenuContent>
    </Menu>
  );
}

const [editingId, setEditingId] = useState<string | null>(null);

<div data-kit-appearance="workspace">
<SessionList
  variant="workspace"
  sessions={sessions}
  activeId={sessionId}
  activeStatus="running"
  menu={(session) => (
    <RowMenu onClick={(action) => {
      if (action === "rename") setEditingId(session.session_id);
      if (action === "archive") openSessionAction(session.session_id, "archive");
      if (action === "delete") openSessionAction(session.session_id, "delete");
    }} />
  )}
  editingId={editingId}
  onEdited={(id, title) => renameSession(id, title)}
  onEditEnd={(id) => setEditingId((current) => (current === id ? null : current))}
  onSelect={setSessionId}
/>
</div>
// 状态标记次序：activeStatus > session.status；menu 函数身份无需稳定。`;

const AGENT_HEADER_CODE = `import { AgentHeader } from "@openagentpack/kit-chat-ui";

<div data-kit-appearance="workspace">
<AgentHeader
  compact
  agent={agent}
  agents={agents}
  onPickAgent={setAgentSlug}
  leading={menuToggle}
  onNewSession={startNewChat}
/>
</div>
// agents + onPickAgent 同时传入时标题变成切换器；compact 固定 h-16 并省略描述。`;

const AGENT_HEADER_ACTIONS_CODE = `import { AgentHeader, StatusIndicator } from "@openagentpack/kit-chat-ui";

<div data-kit-appearance="workspace">
<AgentHeader
  compact
  agent={agent}
  actions={
    <>
      <button type="button" onClick={openDetails}>查看详情</button>
      <StatusIndicator variant="badge" connected turnRunning phase={chat.phase} />
    </>
  }
/>
</div>
// 显式传 actions（含 null）时替代默认新会话按钮；省略 actions 保留 onNewSession 的兼容按钮。`;

const SUB_AGENT_PANEL_CODE = `import { SubAgentPanel } from "@openagentpack/kit-chat-ui";

// 资源面板（右栏）分区：multiAgent 直接来自 useChat() 快照
<SubAgentPanel multiAgent={chat.multiAgent} />
// 子 Agent 按展示名去重分组；会话内尚无线程时分区不渲染`;

const SUB_AGENT_PANEL_HISTORY_CODE = `import { SubAgentPanel } from "@openagentpack/kit-chat-ui";

// 点任务行打开该次派发的执行记录弹窗：主 Agent 指令 + 子线程自身事件时间线
<SubAgentPanel multiAgent={chat.multiAgent} />
// 时间线读子线程事件（loadThreadEvents），不依赖主消息流加载；
// nextPageToken 非空时展示「加载更早消息」（more: true）翻页，historyAvailable 为 false 时提示仅显示本次连接收到的消息`;

const SESSION_SIDEBAR_CODE = `import { SessionSidebar } from "@openagentpack/kit-chat-ui";

// 目录区只负责展示与行内交互；rail 框架（宽度、边框、品牌/新建/导航/账号）由调用方组装
<aside className="flex min-h-0 w-72 flex-col border-r border-[var(--kit-border-subtle)] bg-[var(--kit-bg-subtle)]">
  <SessionSidebar
    groups={[
      { id: "support-agent", name: "客服助手", sessions: supportSessions,
        initialized: true, hasMore, onLoad: loadGroup },
    ]}
    recent={{ sessions: recentSessions, initialized: true }}
    activeId={sessionId}
    activeSection={selection} // 高亮归属分区：点击来源是分组还是最近
    onSelect={(id, section) => selectSession(id, section)}
    menu={(session, section) => <RowMenu onRename={() => setEditing({ id: session.session_id, section })} />}
    editing={editing}
    onEdited={renameSession}
    onEditEnd={endEditing}
  />
</aside>
// 分组展开触发 onLoad 懒加载；计数 = sessions.length，hasMore 时显示 N+
// loading / error / onRetry 接目录级状态，onLoadMore 接触底翻页，归档/删除先经 ConfirmDialog`;

const SESSION_SIDEBAR_WORKSPACE_CODE = `import { SessionSidebar } from "@openagentpack/kit-chat-ui";

// 员工端外壳：品牌 → 新聊天 → 会话目录 → 业务导航 → 账号，全在调用方的 aside 里
<aside className="flex min-h-0 w-64 flex-col border-r border-[var(--kit-border-subtle)] bg-[var(--kit-bg-subtle)]">
  <div className="flex min-h-14 items-center gap-3 px-4 py-3">{brand}{closeButton}</div>
  <div className="shrink-0 px-3 pb-1">{newChatButton}</div>
  <SessionSidebar
    groups={groups}
    recent={recent}
    activeId={sessionId}
    activeGroupId={sessionId && selection === "groups" ? agentSlug : null} // 深链自动展开所在组（只开不关）
    onSelect={(id) => { selectSession(id); closeSidebar(); }}
    onNewChat={(slug) => createSession(slug)}
  />
  {navigation}
  {account}
</aside>
// 移动端整条 rail 放进 Layout 的 sidebar 插槽（抽屉），无需 hideOnMobile`;

const PROMPTS_CODE = `import { EmptyState, Prompts } from "@openagentpack/kit-chat-ui";

// Chat 空态插槽组合：EmptyState 开场白 + suggested_prompts 去重后直接作条目（key = label）
<EmptyState title="你好，我是数据助手" hint="选择下面任一示例，或直接输入你的问题" />
<Prompts
  className="w-full"
  wrap
  items={[...new Set(prompts)].map((prompt) => ({ key: prompt, label: prompt }))}
  onItemClick={({ data }) => send(data.key)}
  classNames={{ list: "justify-center" }}
/>
// items 为空（如服务端未配推荐问题）时组件不渲染`;

const PROMPTS_LAYOUT_CODE = `import { Prompts } from "@openagentpack/kit-chat-ui";

// 默认单行横向滚动；wrap 换行（窄屏逐行排列）；vertical 纵向，与 wrap 同传时优先
<Prompts items={items} wrap />
// 两列：wrap + classNames 拉伸条目（条目默认 flex-none，grow/basis-* 覆盖 flex 简写）
<Prompts items={items} wrap classNames={{ item: "basis-[calc(50%-4px)]" }} />
// 渐入：fadeIn 淡入、fadeInLeft 从左淡入；CSS @starting-style 逐项错峰，最多 8 档延迟
<Prompts items={items} fadeIn />`;

const PROMPTS_NEST_CODE = `import { Prompts } from "@openagentpack/kit-chat-ui";

<Prompts
  title="你想了解什么？"
  wrap
  classNames={{ item: "grow basis-56" }}
  items={[
    {
      key: "hot",
      icon: "🔥",
      label: "热门话题",
      description: "大家都在问",
      children: [
        { key: "hot-1", description: "托管 Agent 能做什么？" },
        { key: "hot-2", description: "怎样给 Agent 配置工具？" },
      ],
    },
  ]}
  // 只有子项会触发；data 是被点击的子项
  onItemClick={({ data }) => handlePick(data.key)}
/>`;

const MENU_CODE = `import { Menu, MenuContent, MenuItem, MenuTrigger } from "@openagentpack/kit-chat-ui";

<Menu>
  <MenuTrigger asChild>
    <button type="button">附件</button>
  </MenuTrigger>
  <MenuContent>
    <MenuItem onSelect={() => pick({ accept: "image/*" })}>上传图片</MenuItem>
    <MenuItem onSelect={() => pick({ accept: "video/*" })}>上传视频</MenuItem>
    <MenuItem onSelect={() => pick()}>上传文件</MenuItem>
  </MenuContent>
</Menu>;
// Menu/MenuTrigger 原样透传 Radix（方向键、Escape、受控 open/onOpenChange、asChild）。
// onSelect 同时响应点击与键盘 Enter；文件类型由调用方交给宿主选择器。`;

const MENU_ALIGN_CODE = `import { Menu, MenuContent, MenuItem, MenuTrigger } from "@openagentpack/kit-chat-ui";

// 行尾菜单：align="end" 向左展开贴齐右缘；删除用 --kit-danger 色，不可逆操作先走确认弹窗。
<Menu>
  <MenuTrigger asChild>
    <button type="button" aria-label="更多操作">…</button>
  </MenuTrigger>
  <MenuContent align="end">
    <MenuItem onSelect={() => onEdit(session)}>重命名</MenuItem>
    <MenuItem onSelect={() => onArchive(session)}>归档</MenuItem>
    <MenuItem className="text-[var(--kit-danger)]" onSelect={() => onDelete(session)}>
      删除
    </MenuItem>
  </MenuContent>
</Menu>;`;

const SENDER_CODE = `import { Sender } from "@openagentpack/kit-chat-ui";

const [value, setValue] = useState("");
// 受控草稿：onSubmit 不会自动清空，提交成功且草稿未被改写时才重置，失败保留文本
<Sender
  variant="workspace"
  value={value}
  onChange={setValue}
  loading={chat.turnRunning}     // 生成中：发送按钮变停止按钮
  submitDisabled={!chat.canSend} // 仅禁发（按钮和回车），草稿仍可编辑
  onCancel={chat.stop}
  onSubmit={async (message) => {
    await send(message);
    setValue((current) => (current === message ? "" : current));
  }}
/>`;

const SENDER_SLOTS_CODE = `import { Sender } from "@openagentpack/kit-chat-ui";

// workspace：上方编辑区 + 下方工具栏（prefix 左、suffix 右、footer 在工具栏下方）；
// default：prefix、编辑区、suffix 同行排列。header 都在边框内、编辑区上方。
<Sender
  variant="workspace"
  value={value}
  onChange={setValue}
  onSubmit={send}
  prefix={<button type="button" onClick={pickFiles}>附件</button>}
  header={<Sender.Header open={headerOpen} title="附件">…</Sender.Header>}
  suffix={(origin, { components }) => (
    <>
      <components.ClearButton />
      {origin}
    </>
  )}
  footer={({ components }) => <components.ClearButton>清空输入</components.ClearButton>}
/>`;

const SENDER_SKILLS_CODE = `import { Sender, Suggestion, type SenderRef, type SenderSelection } from "@openagentpack/kit-chat-ui";
import { skillInputTokens } from "@openagentpack/kit-sdk/protocol";
import { useRef, useState } from "react";

const [value, setValue] = useState("");
const [selection, setSelection] = useState<SenderSelection>({ start: 0, end: 0 });
const sender = useRef<SenderRef>(null);
const skills = agent.resources.skills;
const skillNames = skills.map(({ name }) => name);

// Suggestion 负责 / 查询与候选；Sender.skills 只把已有 /name 标记投影为原子 chip。
<Suggestion
  block
  items={skills.map(({ name, description }) => ({ value: name, label: name, description }))}
  value={value}
  caret={selection.end}
  trigger="/"
  filter={(item, query) => item.value.toLowerCase().startsWith(query.toLowerCase()) &&
    !skillInputTokens(value, skillNames).includes(item.value)}
  onSelect={(_, item, context) => {
    if (!context) return;
    const end = value[context.end] === " " ? context.end + 1 : context.end;
    sender.current?.replaceRange(context.start, end, \`/\${item.value} \`);
  }}
>
  {({ onKeyDown, inputProps }) => <Sender
    ref={sender}
    skills={skills}
    value={value}
    onChange={setValue}
    onSelectionChange={setSelection}
    onKeyDown={onKeyDown}
    inputProps={inputProps}
    onSubmit={async (text, selectedSkills) => {
      await chat.send(text, { skills: selectedSkills });
      setValue((current) => (current === text ? "" : current));
    }}
  />}
</Suggestion>
// 消息回显 chip 需把同一批技能名传给 MessageList.skills；Chat 已自动透传。`;

const SENDER_ATTACHMENTS_CODE = `import {
	type AttachmentItem,
	Attachments,
	type AttachmentsRef,
	Sender,
	type SenderRef,
	type SenderSelection,
	type SenderSkill,
	SkillGlyph,
	Suggestion,
} from "@openagentpack/kit-chat-ui";
import { skillInputTokens } from "@openagentpack/kit-sdk/protocol";
import { useEffect, useRef, useState } from "react";

interface UploadedAttachment extends AttachmentItem {
	fileId?: string;
}

export interface AttachmentSenderProps {
	uploadFile: (file: File) => Promise<{ file_id: string }>;
	// Application callback: upload does not itself mount files into a session.
	onSubmit: (text: string, fileIds: string[], skills?: string[]) => Promise<void>;
	skills?: SenderSkill[];
	onStop: () => void;
	canSend: boolean;
	turnRunning: boolean;
}

const maxCount = 8;

export function AttachmentSender({
	uploadFile,
	onSubmit,
	onStop,
	canSend,
	turnRunning,
	skills,
}: AttachmentSenderProps) {
	const [draft, setDraft] = useState("");
	const [selection, setSelection] = useState<SenderSelection>({ start: 0, end: 0 });
	const sender = useRef<SenderRef>(null);
	const [files, setFiles] = useState<UploadedAttachment[]>([]);
	const [open, setOpen] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const attachments = useRef<AttachmentsRef>(null);
	const currentFiles = useRef(files);
	const mounted = useRef(false);
	const sending = useRef(false);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const updateFiles = (update: (previous: UploadedAttachment[]) => UploadedAttachment[]) => {
		if (!mounted.current) return;
		currentFiles.current = update(currentFiles.current);
		setFiles(currentFiles.current);
	};

	const selectFiles = (selected: File[]) => {
		if (turnRunning || sending.current) return;
		const accepted = selected.slice(0, Math.max(0, maxCount - currentFiles.current.length));
		const uploads = accepted.map((file) => ({
			file,
			item: {
				uid: crypto.randomUUID(),
				name: file.name,
				size: file.size,
				type: file.type,
				status: "uploading" as const,
			},
		}));
		updateFiles((previous) => [...previous, ...uploads.map(({ item }) => item)]);
		setOpen(true);
		setError(null);
		for (const { file, item } of uploads) {
			// Wrapping also handles a synchronous exception in a supplied uploader.
			void Promise.resolve()
				.then(() => uploadFile(file))
				.then(
					(result) =>
						updateFiles((previous) =>
							previous.map((entry) =>
								entry.uid === item.uid
									? { ...entry, fileId: result.file_id, status: "done", description: "Ready" }
									: entry,
							),
						),
					() =>
						updateFiles((previous) =>
							previous.map((entry) =>
								entry.uid === item.uid
									? { ...entry, status: "error", description: "Upload failed. Remove and select again." }
									: entry,
							),
						),
				);
		}
	};

	const submit = async (text: string, selectedSkills?: string[]) => {
		const selected = currentFiles.current;
		if (
			!canSend ||
			turnRunning ||
			sending.current ||
			!text.trim() ||
			selected.some((file) => file.status !== "done" || !file.fileId)
		) {
			return;
		}
		sending.current = true;
		setSubmitting(true);
		setError(null);
		try {
			await onSubmit(
				text.trim(),
				selected.flatMap((file) => (file.fileId ? [file.fileId] : [])),
				selectedSkills,
			);
			if (!mounted.current) return;
			setDraft((current) => (current === text ? "" : current));
			const submitted = new Set(selected.map((file) => file.uid));
			updateFiles((previous) => previous.filter((file) => !submitted.has(file.uid)));
		} catch {
			if (mounted.current) setError("Send failed. Your draft and files are preserved.");
		} finally {
			sending.current = false;
			if (mounted.current) setSubmitting(false);
		}
	};

	const filesBlocked = files.some((file) => file.status !== "done" || !file.fileId);
	const skillNames = skills?.map((skill) => skill.name) ?? [];

	return (
		<div className="flex flex-col gap-2" data-kit-appearance="workspace">
			<Suggestion
				block
				items={(skills ?? []).map((skill) => ({
					value: skill.name,
					label: skill.name,
					description: skill.description,
					icon: <SkillGlyph className="size-4" />,
				}))}
				value={draft}
				caret={selection.end}
				trigger="/"
				filter={(item, query) =>
					item.value.toLowerCase().startsWith(query.toLowerCase()) &&
					!skillInputTokens(draft, skillNames).includes(item.value)
				}
				onSelect={(_, item, context) => {
					if (!context) return;
					const end = draft[context.end] === " " ? context.end + 1 : context.end;
					sender.current?.replaceRange(context.start, end, \`/\${item.value} \`);
				}}
			>
				{({ onKeyDown, inputProps }) => (
					<Sender
						ref={sender}
						onSelectionChange={setSelection}
						onKeyDown={onKeyDown}
						inputProps={inputProps}
						variant="workspace"
						value={draft}
						skills={skills}
						onChange={setDraft}
						placeholder="Write a message or paste files"
						loading={turnRunning}
						submitDisabled={!canSend || submitting || filesBlocked}
						onSubmit={(text, selectedSkills) => void submit(text, selectedSkills)}
						onCancel={onStop}
						onPasteFile={selectFiles}
						header={
							<Sender.Header title="Attachments" open={open} onOpenChange={setOpen}>
								<Attachments
									ref={attachments}
									items={files}
									maxCount={maxCount}
									disabled={turnRunning || submitting}
									onSelectFiles={selectFiles}
									onRemove={(item) => updateFiles((previous) => previous.filter((file) => file.uid !== item.uid))}
									placeholder={(type) => ({
										title: type === "drop" ? "Drop files to add them" : "Choose files",
										description: type === "inline" ? "Select, paste, or drag files here" : undefined,
									})}
								/>
							</Sender.Header>
						}
						prefix={
							<button
								type="button"
								disabled={turnRunning || submitting}
								onClick={() => {
									if (open) attachments.current?.select();
									else setOpen(true);
								}}
							>
								Attach files
							</button>
						}
						suffix={(_origin, { components }) =>
							turnRunning ? (
								<components.LoadingButton>Stop</components.LoadingButton>
							) : (
								<components.SendButton>{submitting ? "Sending" : "Send"}</components.SendButton>
							)
						}
						footer={({ components }) => <components.ClearButton>Clear text</components.ClearButton>}
					/>
				)}
			</Suggestion>
			{error ? <p role="alert">{error}</p> : null}
		</div>
	);
}`;

/** 文档调用方提供的离线模拟；实际接入时替换为业务上传接口。 */
async function simulateSenderUpload(_file: File): Promise<{ file_id: string }> {
	await new Promise((resolve) => setTimeout(resolve, 800));
	return { file_id: `demo-${crypto.randomUUID()}` };
}

const ATTACHMENTS_CODE = `import { Attachments } from "@openagentpack/kit-chat-ui";

// 输入框上方暂存待发送附件：onSelectFiles 收到原生 File[]，上传由调用方完成后写回 items
<Attachments
  items={files}
  maxCount={8}
  overflow="scrollX"
  accept="image/*,.pdf,.txt"
  onSelectFiles={uploadFiles}
  onRemove={(item) => remove(item.uid)}
/>`;

const ATTACHMENTS_STATUS_CODE = `import { Attachments, type AttachmentItem } from "@openagentpack/kit-chat-ui";

// 业务把上传中 / 扫描中 / 失败三类来源统一成 AttachmentItem（体验页输入框附件行同款）
const items: AttachmentItem[] = [
  { uid: "f1", name: "会议录音.wav", status: "uploading", percent: 64 },
  { uid: "f2", name: "需求说明.pdf", status: "done", description: "安全扫描中…" },
  { uid: "f3", name: "脚本.exe", status: "error", description: "文件类型不被允许" },
];

// 上传中显示进度且无移除入口；失败卡经 description 展示原因，由调用方写回
<Attachments items={items} onRemove={(item) => remove(item.uid)} />`;

const ATTACHMENTS_OVERFLOW_CODE = `import { Attachments } from "@openagentpack/kit-chat-ui";

// 多文件布局：wrap 换行 / scrollX 横向滚动（体验页同款）/ scrollY 纵向滚动（max-h-40）
// disabled 同时冻结选择、拖放与移除
<Attachments items={files} overflow="scrollX" disabled={false} onRemove={(item) => remove(item.uid)} />`;

const FILE_CARD_CODE = `import { Attachments, type AttachmentItem } from "@openagentpack/kit-chat-ui";
import { useState } from "react";

const attachment: AttachmentItem = {
  uid: "report",
  name: "需求说明.pdf",
  type: "application/pdf",
  size: 24800,
  status: "done",
};

export function FileCardExample() {
  const [file, setFile] = useState<AttachmentItem | null>(attachment);
  return file ? (
    <Attachments.FileCard
      item={file}
      onRemove={() => setFile(null)} // 仅更新本次附件列表
    />
  ) : (
    <button type="button" onClick={() => setFile(attachment)}>重置</button>
  );
}`;

const SUGGESTION_CODE = `import { Sender, Suggestion } from "@openagentpack/kit-chat-ui";

<Suggestion
  block
  items={commands}
  onSelect={setValue}
>
  {({ onTrigger, onKeyDown, inputProps }) => (
    <Sender
      variant="workspace"
      value={value}
      onChange={(next) => {
        setValue(next);
        onTrigger(next === "/" ? undefined : false);
      }}
      onKeyDown={onKeyDown}
      inputProps={inputProps}
      onSubmit={send}
    />
  )}
</Suggestion>`;

const ACTIONS_CODE = `import { Actions } from "@openagentpack/kit-chat-ui";

// items 配置按钮与二级子菜单；点击叶子项回传 key，弹层自动收起
<Actions
  variant="outlined"
  items={[
    { key: "retry", label: "重新生成" },
    { key: "more", label: "更多", subItems: [{ key: "save", label: "保存为草稿" }] },
  ]}
  onClick={({ key }) => handle(key)}
/>
// danger 只是视觉提示，不可逆操作仍须先走 AlertDialog 确认`;

const ACTIONS_COPY_CODE = `import { Actions } from "@openagentpack/kit-chat-ui";

// 默认用浏览器剪贴板；onCopy 注入宿主实现（成功 resolve / 失败抛错）
<Actions>
  <Actions.Copy text={answer} label="复制回答" onCopy={copyViaBridge} />
  <Actions.Copy text={answer} iconOnly /> {/* 仅图标形态，无障碍名称仍读 label */}
</Actions>
// Message 已为完成的回答内置复制入口（用户消息悬停显示 iconOnly 形态）`;

const ACTIONS_FEEDBACK_CODE = `import { Actions } from "@openagentpack/kit-chat-ui";

// 受控赞踩：赞与踩互斥，重复点击当前选项回到 default；保存与埋点由调用方完成
<Actions>
  <Actions.Feedback value={value} onChange={(next) => {
    setValue(next);
    reportFeedback(next);
  }} />
</Actions>`;

const FEEDBACK_FILE_CARD_CODE = `import { FileCard } from "@openagentpack/kit-chat-ui";

// 消息流交付文件：onClick 开预览为主入口，onDownload 渲染独立下载图标
<FileCard
  name="weekly-report.md"
  type="text/markdown"
  onClick={openPreview}
  onDownload={() => downloadArtifact(fileId)} // 调用方接 kit-sdk client，经 server 代理下载
/>;`;

const FEEDBACK_FILE_CARD_ENTRIES_CODE = `import { FileCard } from "@openagentpack/kit-chat-ui";

// 仅 onDownload：文件名即下载入口；传 src 时缩略图替代字符徽标
<FileCard name="source-data.csv" type="text/csv" onDownload={download} />
<FileCard name="cover.png" type="image/png" src={thumbUrl} onDownload={download} />
// 无回调纯展示：description 占第二行，不展示类型词
<FileCard name="outline.txt" type="text/plain" description="生成周报时引用的数据文件" />`;

const FEEDBACK_FILE_CARD_STATES_CODE = `import { FileCard } from "@openagentpack/kit-chat-ui";

// loading 阻止操作且第二行固定「加载中…」；disabled 整卡变暗并禁用
<FileCard
  name="weekly-report.md"
  type="text/markdown"
  loading={uploading}
  disabled={!canOperate}
  onClick={openPreview}
  onDownload={download}
/>;`;

const CODE_HIGHLIGHTER_CODE = `import { CodeHighlighter } from "@openagentpack/kit-chat-ui";

const code = "const message: string = '你好';\\nconsole.log(message);";

<CodeHighlighter lang="typescript" showLineNumbers>
  {code}
</CodeHighlighter>;
// 未知语言按纯文本展示；复制始终是传入的原始代码（含换行与缩进）。`;

const CODE_HIGHLIGHTER_HEADER_CODE = `import { CodeHighlighter } from "@openagentpack/kit-chat-ui";

<CodeHighlighter
  lang="typescript"
  header={<span className="font-mono">scripts/deploy.ts</span>}
>
  {code}
</CodeHighlighter>;
// header={false} 隐藏整个工具栏（复制按钮一并隐藏）；copyable={false} 只隐藏复制按钮。
// header 传函数时以返回节点作为标题。`;

const CODE_HIGHLIGHTER_FALLBACK_CODE = `import { CodeHighlighter } from "@openagentpack/kit-chat-ui";

// 未注册语言按纯文本展示；长行不折行，只在代码区内横向滚动。
// 超过 50,000 字符跳过高亮保持纯文本（流式更新不卡顿），复制不受影响。
<CodeHighlighter lang="unknown">{rawText}</CodeHighlighter>;
<CodeHighlighter lang="javascript" showLineNumbers>{longLine}</CodeHighlighter>;`;

const MERMAID_CODE = `import { Mermaid } from "@openagentpack/kit-chat-ui";

// 消息流内由 Markdown 的 mermaid 围栏自动使用；独立使用直接传源码
<Mermaid
  streaming={turnRunning} // 生成中只展示源码，完整内容到达后自动渲染
  onRenderTypeChange={setView}
>
  {diagramSource}
</Mermaid>;`;

const MERMAID_STREAMING_CODE = `import { Mermaid } from "@openagentpack/kit-chat-ui";

// streaming 期间保留源码并提示「图表生成中」；置回 false 后渲染成图
<Mermaid streaming={turnRunning}>{diagramSource}</Mermaid>;`;

const MERMAID_FALLBACK_CODE = `import { Mermaid } from "@openagentpack/kit-chat-ui";

// 语法错误：错误提示 + 「重新渲染」按钮，修正源码后自动恢复
// 图片节点 / 扩展节点 / url() / @import 等资源语法：仅展示源码，不请求外部地址
<Mermaid>{diagramSource}</Mermaid>;`;

const TOOL_CODE = `import { ArtifactCard, ReasoningBlock, ToolCallCard } from "@openagentpack/kit-chat-ui";

<div data-kit-appearance="workspace">
{/* Message 会把连续的思考/工具分片折成 ExecutionGroup 回合容器（含耗时与步数）。 */}
<ToolCallCard part={{ type: "tool", toolId: "t1", name: "web_search", status: "done", input, output }} />
{/* 步骤默认收起；稳定 id 使正文和状态更新保留用户手动开合。 */}
<ReasoningBlock text={reasoning.text} status={reasoning.status} />
<ArtifactCard filename={a.filename} contentType={a.content_type} onDownload={download} />
</div>`;

const MARKDOWN_CODE = `import { Markdown } from "@openagentpack/kit-chat-ui";

// GFM + sanitize；代码与图表使用 CodeHighlighter / Mermaid
<Markdown>{event.text}</Markdown>`;

const LAYOUT_CODE = `import { AgentHeader, Chat, ConfirmDialog, Layout, Menu, MenuContent, MenuItem, MenuTrigger, SessionSidebar } from "@openagentpack/kit-chat-ui";

// 行尾「更多操作」菜单经 render prop 由调用方构造：归档/删除先经确认弹窗（plan diff + 一次性令牌）。
function RowMenu({ onClick }: { onClick: (action: "archive" | "delete") => void }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" aria-label="更多操作" className="grid size-full cursor-pointer place-items-center rounded-[var(--kit-radius-sm)] outline-none">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
            <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
          </svg>
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem onSelect={() => onClick("archive")}>归档</MenuItem>
        <MenuItem className="text-[var(--kit-danger)]" onSelect={() => onClick("delete")}>删除</MenuItem>
      </MenuContent>
    </Menu>
  );
}

// 父容器提供有界高度；rail 框架、导航、路由和待确认操作由调用方管理。
<div className="h-dvh" data-kit-appearance="workspace">
  <Layout
    header={(menuToggle) => <AgentHeader compact agent={agent} leading={menuToggle} actions={status} />}
    sidebar={({ closeSidebar, closeButton }) => (
      <aside className="flex min-h-0 w-64 flex-col border-r border-[var(--kit-border-subtle)] bg-[var(--kit-bg-subtle)]">
        <div className="flex min-h-16 items-center gap-3 px-4 py-3">{brand}{closeButton}</div>
        <SessionSidebar
          groups={[{ id: agent.slug, name: agent.display_name, sessions, initialized: true }]}
          recent={{ sessions, initialized: true }}
          activeId={sessionId}
          onSelect={(id) => { setSessionId(id); closeSidebar(); }}
          menu={(session) => <RowMenu onClick={(action) => askConfirm(session.session_id, action)} />}
        />
        {navigation}
        {account}
      </aside>
    )}
    dialogs={pending ? (
      <ConfirmDialog title="确认会话操作" body={planDiff} onCancel={close} onConfirm={run} />
    ) : null}
  >
    <Chat variant="workspace" messages={chat.messages} multiAgent={chat.multiAgent}
      scrollKey={sessionId} canSend={chat.canSend} turnRunning={chat.turnRunning}
      onSend={(text, skills) => chat.send(text, { skills })} onStop={chat.stop} />
  </Layout>
</div>
// navigation 中的链接也应在选中后调用 closeSidebar。
// dialogs 的 pending 状态放在 Layout 外部，跨桌面/手机切换仍保留。`;

const MULTI_AGENT_CODE = `import { Chat } from "@openagentpack/kit-chat-ui";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";

const chat = useChat(sessionId);

<div className="flex h-dvh flex-col" data-kit-appearance="workspace">
<Chat
  variant="workspace"
  messages={chat.messages}
  multiAgent={chat.multiAgent}
  scrollKey={sessionId}
  canSend={chat.canSend}
  turnRunning={chat.turnRunning}
  onSend={(text, skills) => chat.send(text, { skills })}
  onStop={chat.stop}
/>
</div>
// 主 Agent 可发送；子 Agent 只读，支持历史分页与失败重试。
// 子 Agent 在主消息流中展开只读历史，主输入草稿保持；不再另接 ThreadPanel。
// 在线预览使用本地 ChatMultiAgent 数据；真实应用由 useChat / Provider 查询。`;

const APPROVAL_CODE = `import { ToolApprovalGroup } from "@openagentpack/kit-chat-ui";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";

const chat = useChat(sessionId);

{chat.approvals.length > 0 ? (
  <ToolApprovalGroup
    approvals={chat.approvals}
    onDecision={chat.submitApproval}
    onRefresh={chat.refreshApprovals}
    onStop={chat.stop}
  />
) : null}`;

const APPROVAL_RECOVERY_CODE = `import { ToolApprovalCard } from "@openagentpack/kit-chat-ui";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";

const chat = useChat(sessionId);

// onDecision 失败显示错误行并保持可重试；uncertain / stale 提供刷新入口，
// 连接恢复不会自动重发允许或拒绝。
<ToolApprovalCard
  approval={chat.approvals[0]!}
  onDecision={chat.submitApproval}
  onRefresh={chat.refreshApprovals}
  onStop={chat.stop}
/>`;

const APPROVAL_GROUP_CODE = `import { ToolApprovalGroup } from "@openagentpack/kit-chat-ui";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";

const chat = useChat(sessionId);

// 多项待审批一次只显示一张卡，用 ‹ 1/2 › 翻页；
// 处理完当前项自动切到剩余的待审批，手动翻页的选择保留。
<ToolApprovalGroup
  approvals={chat.approvals}
  onDecision={chat.submitApproval}
  onRefresh={chat.refreshApprovals}
  onStop={chat.stop}
/>`;

const TOOLTIP_CODE = `import { Tooltip } from "@openagentpack/kit-chat-ui";

<div className="flex items-center gap-3">
  <Tooltip content="出现在触发器上方" side="top">
    <button type="button">上方</button>
  </Tooltip>
  <Tooltip content="出现在触发器左侧" side="left">
    <button type="button">左侧</button>
  </Tooltip>
</div>`;

const TOOLTIP_OVERFLOW_CODE = `import { Tooltip } from "@openagentpack/kit-chat-ui";

// truncate 收敛到 Tooltip 触发器上，溢出检测才有正确的 scrollWidth/clientWidth；
// 未溢出的文本不出提示。
<button type="button" className="w-56">
  <Tooltip className="block truncate" content={title} overflowOnly>
    {title}
  </Tooltip>
</button>`;

const TOOLTIP_RICH_CODE = `import { Tooltip } from "@openagentpack/kit-chat-ui";

// 气泡内容是 ReactNode：锚点栏同款「标题 + 摘要」；side="left" 适配贴边触发器，
// 指针可移入气泡，内容超过最大高度时在气泡内滚动。
<Tooltip
  side="left"
  className="block w-full cursor-pointer"
  content={
    <span className="block">
      <span className="block font-medium">{item.label}</span>
      <span className="mt-1 block text-[var(--kit-fg-muted)]">{item.summary}</span>
    </span>
  }
>
  {item.label}
</Tooltip>`;

const STATUS_CODE = `import { StatusIndicator } from "@openagentpack/kit-chat-ui";

<div data-kit-appearance="workspace">
  <StatusIndicator variant="badge" connected={chat.connected} turnRunning={chat.turnRunning} phase={chat.phase} connection={chat.connection} error={chat.streamError} />
</div>`;

const THREAD_CODE = `import { ThreadPanel } from "@openagentpack/kit-chat-ui";

// 仅用于兼容旧版分组视图；新接入使用 Chat multiAgent={chat.multiAgent}。
{Object.keys(chat.threads).length > 0 ? <ThreadPanel threads={chat.threads} /> : null}`;

const STATES_CODE = `import { EmptyState, ErrorState } from "@openagentpack/kit-chat-ui";

{loading ? null : error ? <ErrorState message={error} onRetry={reload} /> : null}
{agents.length === 0 ? <EmptyState title="还没有上架的 Agent" hint="到管理端完成 publish 与上架" /> : null}`;

const SSE_STREAM_CODE = `import { createSseStream, type RawSseMessage } from "@openagentpack/kit-sdk/stream";

// mock 字节流：按所选分隔符编码，每 21 字节、140ms 分块入队
const bytes = new TextEncoder().encode(payload);
let offset = 0;
let timer: ReturnType<typeof setTimeout>;
const body = new ReadableStream<Uint8Array>({
  start(controller) {
    const push = () => {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + 21));
      offset += 21;
      timer = setTimeout(push, 140);
    };
    timer = setTimeout(push, 140);
  },
  cancel() {
    clearTimeout(timer);
  },
});

const frames: RawSseMessage[] = [];
for await (const frame of createSseStream(body, {
  signal: abortController.signal,
  onComment: () => addLog(": 心跳注释 → onComment 通知，不生成业务帧"),
})) {
  // data 保持字符串；业务 JSON 由 Provider 解析
  addLog("event=" + frame.event + " id=" + frame.id + " data=" + frame.data);
  frames.push(frame);
}
// 自然 EOF 只表示字节流读完，不代表 Agent 执行完成`;

const SSE_PARSER_CODE = `import { createSseParser, decodeFrame, type SseFrame } from "@openagentpack/kit-sdk/protocol";

// 可编辑的 SSE 文本：注释心跳、协议帧与未知 event
const parser = createSseParser((raw) => {
  const frame: SseFrame | null = decodeFrame(raw);
  if (!frame) {
    addLog("未知 event「" + raw.event + "」→ decodeFrame 返回 null，由调用方决定丢弃");
    return;
  }
  const cursor = frame.type === "event" ? " · cursor=" + frame.cursor : "";
  addLog("type=" + frame.type + cursor, "data=" + JSON.stringify(frame.data));
}, {
  onComment: () => addLog("注释心跳 → onComment，不生成业务帧"),
});

// 文本分片按 70ms 间隔推入，模拟网络分片到达
for await (const chunk of pacedStream(textChunks, 70)) {
  parser.push(chunk);
}
parser.end();`;

const KIT_STREAM_CODE = `import { createKitClient } from "@openagentpack/kit-sdk/providers/kit";

// mock fetchImpl 返回 Kit 协议流：reset → event* → ready → ping → event → done
const client = createKitClient({
  baseUrl: "/mock-kit",
  fetchImpl: () =>
    Promise.resolve(
      new Response(pacedStream(frames.map((frame) => new TextEncoder().encode(frame)), 450), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    ),
});

await client.stream("sess_demo", {
  after, // "1:8" 续传；游标失效时服务端下发 reset 重建
  signal,
  onReset: () => addLog("onReset() —— 游标不可续传，开始重建"),
  onEvent: (event, cursor) =>
    addLog("onEvent cursor=" + cursor + " event_id=" + event.event_id + " type=" + event.type, JSON.stringify(event)),
  onReady: ({ replayed, cursor }) => addLog("onReady replayed=" + replayed + " cursor=" + cursor),
  onPing: (t) => addLog("onPing t=" + t + " —— 每 15s 保活"),
  onDone: ({ status, lastEventId }) => addLog("onDone status=" + status + " lastEventId=" + lastEventId),
});`;

const CONTROLLER_CODE = `import { createChatController } from "@openagentpack/kit-sdk/chat";
import { type ChatProvider } from "@openagentpack/kit-sdk/providers";

// mock 五方法 ChatProvider：stream 保持连接，sendMessage 之后由泵推实时事件
const provider: ChatProvider = {
  stream: (sessionId, options) => {
    void (async () => {
      await wait(200);
      options?.onReset?.();
      options?.onReady?.({ sessionId, replayed: 0, cursor: "1:0" });
    })();
    return new Promise((resolve) =>
      options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
    );
  },
  sendMessage: async (sessionId, body) => {
    await wait(300);
    emit({ event_id: "evt_u1", type: "message", role: "user", content: [{ type: "text", text: body.text }] });
    schedule(500, () => emit({ event_id: "evt_a1", type: "message", role: "assistant",
      metadata: { event_status: "in_progress" }, content: [{ type: "text", text: "已读取周报，正在整理要点…" }] }));
    schedule(1100, () => emit({ event_id: "evt_a1", type: "message", role: "assistant",
      metadata: { event_status: "completed" }, content: [{ type: "text", text: "已读取周报，整理出三个要点。" }] }));
    schedule(1500, () => emit({ event_id: "evt_s1", type: "session_status",
      content: [{ type: "data", data: { session_status: "idle" } }] }));
    return { session_id: sessionId, accepted: true, event_ids: ["evt_u1"] };
  },
  interrupt: async () => ({ interrupted: true }),
  toolApprovals: async () => ({ requires_action: false, batch_id: null, pending_call_ids: [], requests: [] }),
  submitToolApproval: async () => ({ session_id: sessionId, accepted: true, event_ids: [] }),
};

const controller = createChatController(provider, "sess_demo");
const unsubscribe = controller.subscribe(() => logSnapshot(controller.getSnapshot()));

// connect() 只等待订阅就绪；send() 只等待消息提交；回答进度观察 getSnapshot().phase
await controller.connect();
await controller.send(text);
controller.dispose();
unsubscribe();`;

const REQUEST_BASIC_CODE = `import { createRequest } from "@openagentpack/kit-sdk/request";

// 动态身份头：每次请求重新执行，可异步取令牌
const request = createRequest({
  baseUrl: "/mock-api",
  headers: async () => ({ Authorization: "Bearer " + token }),
  fetchImpl: mockFetch, // mock：记录解析后的头，按路径返回响应
});

// json()：检查 HTTP 状态后解析 JSON；204 返回 undefined
const data = await request.json("/status", { signal });`;

const REQUEST_CUSTOM_CODE = `const request = createRequest({
  baseUrl: "/mock-api",
  headers: async () => ({ Authorization: "Bearer tok-dynamic" }),
  fetchImpl: mockFetch,
});

// 单次 RequestInit.headers 覆盖同名动态头，其余合并；方法与 body 由调用方显式配置
const data = await request.json("/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer tok-call" },
  body: JSON.stringify({ text: "帮我总结周报" }),
});`;

const REQUEST_STREAM_CODE = `const request = createRequest({ baseUrl: "/mock-api", headers, fetchImpl: mockFetch });
const controller = new AbortController();

// stream()：请求后委托 Stream 解码分帧，逐帧交付 RawSseMessage
for await (const frame of request.stream("/updates", {
  signal: controller.signal,
  headers: { Accept: "text/event-stream" },
})) {
  addLog("帧 event=" + frame.event + " id=" + frame.id + " data=" + frame.data);
}
// 退出循环时关闭 reader；abort() 取消贯穿 fetch 与读取`;

const REQUEST_ERROR_CODE = `import { KitError } from "@openagentpack/kit-sdk/protocol";

// 默认映射：429 → code=rate_limited、retryable=true，消息只保留 "HTTP 429"
try {
  await request.json("/limited");
} catch (error) {
  if (error instanceof KitError) addLog(error.code + " retryable=" + error.retryable);
}

// mapHttpError：替换为带业务语义的安全错误，不能透传原始正文
const request = createRequest({
  baseUrl: "/mock-api",
  mapHttpError: (response) =>
    new KitError("quota_exceeded", "月度配额已用尽", { status: response.status, retryable: false }),
  fetchImpl: mockFetch,
});`;

const PROVIDER_CODE = `import { createBailianChatProvider } from "@openagentpack/kit-sdk/providers/bailian";
import { createRequest } from "@openagentpack/kit-sdk/request";

// 六项操作各含 buildRequest / mapResponse；HTTP 统一经注入的 Request 执行
const provider = createBailianChatProvider({
  request: createRequest({ baseUrl, headers: getAppHeaders }),
  openStream: {
    buildRequest: ({ sessionId }) => ({
      path: \`/sessions/\${sessionId}/stream\`,
      init: { headers: { Accept: "text/event-stream" } },
    }),
    // 不读 body、不等待 ready；ready 必须绑定真实上游订阅
    mapResponse: (response) => ({ response, ready: waitForUpstream() }),
  },
  listEvents: { /* 历史分页 → { events, nextPageToken } */ },
  sendMessage: { /* 示例合同：body 映射为 { input, request_id } */ },
  // interrupt / toolApprovals / submitToolApproval 同构
});

// 连接时序：订阅 → 就绪 → 历史 → 合并缓冲 → onReady
await provider.stream("sess-1", {
  signal,
  onReset: beginReplay,
  onEvent: applyEvent,
  onReady: (info) => setConnected(info.replayed),
});`;

const EVENTS_CODE = `import { type ChatProvider } from "@openagentpack/kit-sdk/providers";

// 已转换事件的五方法 Provider：stream 按 onReset → 完整事件 → onReady 交付
const provider: ChatProvider = {
  stream: (sessionId, options) => {
    void (async () => {
      await ready();
      options?.onReset?.();
      emit({ event_id: "evt-h1", type: "message", role: "user",
        content: [{ type: "text", text: "帮我看看今天的日程" }] });
      emit({ event_id: "evt-h2", type: "message", role: "assistant",
        content: [{ type: "text", text: "今天 15:00 有一个 1:1 同步。" }] });
      options?.onReady?.({ sessionId, replayed: 2, cursor: "1:2" });
    })();
    return new Promise((resolve) =>
      options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
    );
  },
  sendMessage: async (sessionId, body) => {
    emit({ event_id: "evt-u1", type: "message", role: "user",
      content: [{ type: "text", text: body.text }] });
    schedule(500, () => emit({ event_id: "evt-a1", type: "message", role: "assistant",
      content: [{ type: "text", text: "今天 15:00 的 1:1 已确认，已写入日历。" }] }));
    schedule(900, () => emit({ event_id: "evt-s1", type: "session_status",
      content: [{ type: "data", data: { session_status: "idle" } }] }));
    return { session_id: sessionId, accepted: true, event_ids: ["evt-u1"] };
  },
  interrupt: async () => ({ interrupted: true }),
  toolApprovals: async () => ({ requires_action: false, batch_id: null, pending_call_ids: [], requests: [] }),
  submitToolApproval: async (sessionId) => ({ session_id: sessionId, accepted: true, event_ids: [] }),
};

// onEvent 每次交付累计快照与不透明游标；取消后不再回调
await provider.stream("sess-1", {
  signal,
  onReset: beginReplay,
  onEvent: (event, cursor) => apply(event, cursor),
  onReady: ({ replayed, cursor }) => setConnected(replayed),
});`;

const TRANSFORM_CODE = `import { type MessageTransformer, transformSessionEvent } from "@openagentpack/kit-sdk/messages";

const event = { event_id: "evt-1", type: "message", role: "assistant",
  content: [{ type: "text", text: "[[agent-name]] 已收到你的请求。" }] };

// 默认转换：SDK 事件 → ChatMessage
transformSessionEvent({ messages: [], event, identity: "evt-1" });
// → 「[[agent-name]] 已收到你的请求。」

// 只换展示：默认转换后再替换文本里的展示标签；重放幂等，生命周期不动
const replaceDisplayLabel: MessageTransformer = (input) => {
  const result = transformSessionEvent(input);
  return {
    ...result,
    messages: result.messages.map((message) => ({
      ...message,
      parts: message.parts.map((part) =>
        part.type === "text"
          ? { ...part, text: part.text.replaceAll("[[agent-name]]", "Support assistant") }
          : part),
    })),
  };
};
replaceDisplayLabel({ messages: [], event, identity: "evt-1" });
// → 「Support assistant 已收到你的请求。」`;

const SESSIONS_CODE = `import { createKitClient } from "@openagentpack/kit-sdk/providers/kit";
import { KitProvider, useKitClient } from "@openagentpack/kit-sdk/providers/kit/react";
import { useSessions } from "@openagentpack/kit-sdk/sessions/hooks";
import { useState } from "react";

// mock KitClient：GET /api/kit/sessions 返回 { data, next_page_token }，POST 创建会话
const client = createKitClient({ baseUrl: "/mock-kit", fetchImpl: mockFetch });

function SessionPicker({ onSelect }) {
  const client = useKitClient();
  // hook 只负责列表；传入 agentSlug 时只查询该上架条目的会话
  const { sessions, loading, reload } = useSessions({ agentSlug: "report-helper" });
  const [activeId, setActiveId] = useState(null);
  const [creating, setCreating] = useState(false);

  async function create() {
    setCreating(true);
    try {
      // 创建操作走 useKitClient；成功后选中并 reload() 刷新列表
      const session = await client.createSession({ agentSlug: "report-helper", title: "线上问题排查" });
      onSelect(session.session_id);
      reload();
    } finally {
      setCreating(false);
    }
  }

  return (
    <nav aria-label="会话列表">
      <button type="button" disabled={creating} onClick={() => void create()}>
        {creating ? "正在创建…" : "新建会话"}
      </button>
      <ul>
        {sessions.map((session) => (
          <li key={session.session_id}>
            <button
              type="button"
              aria-current={session.session_id === activeId ? "true" : undefined}
              onClick={() => onSelect(session.session_id)}
            >
              {session.title || "未命名会话"}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

<KitProvider client={client}>
  <SessionPicker onSelect={setSessionId} />
</KitProvider>`;

const USE_CHAT_CODE = `import { EmptyState, MessageList, Sender } from "@openagentpack/kit-chat-ui";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";
import { useState } from "react";

const SESSION_ID = "sess_demo";

function ChatPanel() {
  // Provider 在 useState 初始化器里创建一次，保持实例稳定。
  const [scripted] = useState(() => createScriptedProvider());
  const chat = useChat({ sessionId: SESSION_ID, provider: scripted.provider });
  const [draft, setDraft] = useState("");

  return (
    <div data-kit-appearance="workspace" className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span>connection={chat.connection}</span>
        <span>phase={chat.phase}</span>
        <span>canSend={String(chat.canSend)}</span>
        <span>turnRunning={String(chat.turnRunning)}</span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          <MessageList
            variant="workspace"
            messages={chat.messages}
            scrollKey={SESSION_ID}
            autoScroll
            empty={<EmptyState title="useChat 就绪" hint="发送一条消息，观察状态行与消息流" />}
          />
        </div>
      </div>
      <Sender
        value={draft}
        onChange={setDraft}
        loading={chat.turnRunning}
        submitDisabled={!chat.canSend}
        onSubmit={async (message) => {
          await chat.send(message);
          setDraft((current) => (current === message ? "" : current));
        }}
        onCancel={() => void chat.stop()}
      />
    </div>
  );
}`;

const TOOL_APPROVALS_CODE = `import { MessageList, Sender, ToolApprovalCard } from "@openagentpack/kit-chat-ui";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";
import { useEffect, useState } from "react";

const SESSION_ID = "sess_demo";

function ApprovalChatPanel() {
  // mock Provider：发送后进入 requires_action，提交审批后继续执行
  const [scripted] = useState(() => createApprovalProvider());
  useEffect(() => () => scripted.dispose(), [scripted]);
  const chat = useChat({ sessionId: SESSION_ID, provider: scripted.provider });
  const [draft, setDraft] = useState("帮我删除周报草稿.md");

  return (
    <div data-kit-appearance="workspace" className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span>phase={chat.phase}</span>
        <span>canSend={String(chat.canSend)}</span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          <MessageList
            variant="workspace"
            messages={chat.messages}
            scrollKey={SESSION_ID}
            autoScroll
            approvals={chat.approvals.map((approval) => (
              <ToolApprovalCard
                key={approval.call_id}
                approval={approval}
                onDecision={chat.submitApproval}
                onRefresh={chat.refreshApprovals}
              />
            ))}
          />
        </div>
      </div>
      <Sender
        value={draft}
        onChange={setDraft}
        loading={chat.turnRunning}
        submitDisabled={!chat.canSend}
        onSubmit={async (message) => {
          await chat.send(message);
          setDraft((current) => (current === message ? "" : current));
        }}
        onCancel={() => void chat.stop()}
      />
    </div>
  );
}`;

const SHOWCASES: Record<ShowcaseName, ShowcaseEntry> = {
	"message-bubble": {
		title: "Message（基本用法）",
		command: "pnpm kit:add message",
		code: MESSAGE_EXAMPLE_CODE.basic,
		Demo: MessageBasicDemo,
	},
	"message-workspace": {
		title: "Message（工作区样式）",
		command: "pnpm kit:add message",
		code: MESSAGE_EXAMPLE_CODE.workspace,
		Demo: MessageWorkspaceDemo,
	},
	"message-status": {
		title: "Message（消息状态与流式更新）",
		command: "pnpm kit:add message",
		code: MESSAGE_EXAMPLE_CODE.status,
		Demo: MessageStatusDemo,
	},
	"message-parts": {
		title: "Message（富内容与执行过程）",
		command: "pnpm kit:add message",
		code: MESSAGE_EXAMPLE_CODE.parts,
		Demo: MessagePartsDemo,
	},
	"message-files": {
		title: "Message（文件与操作回调）",
		command: "pnpm kit:add message",
		code: MESSAGE_EXAMPLE_CODE.files,
		Demo: MessageFilesDemo,
	},
	"message-skills": {
		title: "Message（技能标签）",
		command: "pnpm kit:add message",
		code: MESSAGE_EXAMPLE_CODE.skills,
		Demo: MessageSkillsDemo,
	},
	"message-list": {
		title: "MessageList（消息排列与滚动）",
		command: "pnpm kit:add message",
		code: MESSAGE_LIST_CODE,
		Demo: MessageListDemo,
	},
	"message-list-flow": {
		title: "MessageList（回合等待与审批卡）",
		command: "pnpm kit:add message",
		code: MESSAGE_LIST_EXAMPLE_CODE.flow,
		Demo: MessageListFlowDemo,
	},
	"message-list-anchor": {
		title: "MessageList（回合锚点栏）",
		command: "pnpm kit:add message",
		code: MESSAGE_LIST_EXAMPLE_CODE.anchor,
		Demo: MessageListAnchorDemo,
	},
	"message-list-skeleton": {
		title: "MessageList（会话加载骨架屏）",
		command: "pnpm kit:add message && pnpm kit:add message-skeleton",
		code: MESSAGE_LIST_EXAMPLE_CODE.skeleton,
		Demo: MessageListSkeletonDemo,
	},
	"message-list-virtual": {
		title: "MessageList（虚拟滚动）",
		command: "pnpm kit:add message",
		code: MESSAGE_LIST_EXAMPLE_CODE.virtual,
		Demo: MessageListVirtualDemo,
	},
	"session-list": {
		title: "SessionList（选择与空列表）",
		command: "pnpm kit:add session-list",
		code: SESSION_LIST_CODE,
		Demo: SessionListDemo,
	},
	"session-list-status": {
		title: "SessionList（行内状态与更多操作）",
		command: "pnpm kit:add session-list",
		code: SESSION_LIST_STATUS_CODE,
		Demo: SessionListStatusDemo,
	},
	"session-sidebar": {
		title: "SessionSidebar（分组会话目录）",
		command: "pnpm kit:add session-sidebar",
		code: SESSION_SIDEBAR_CODE,
		Demo: SessionSidebarBasicDemo,
	},
	"session-sidebar-workspace": {
		title: "SessionSidebar（员工端外壳组合）",
		command: "pnpm kit:add session-sidebar",
		code: SESSION_SIDEBAR_WORKSPACE_CODE,
		Demo: SessionSidebarWorkspaceDemo,
	},
	"agent-header": {
		title: "AgentHeader（标题切换与紧凑页头）",
		command: "pnpm kit:add agent-header",
		code: AGENT_HEADER_CODE,
		Demo: AgentHeaderDemo,
	},
	"agent-header-actions": {
		title: "AgentHeader（操作区与状态徽标）",
		command: "pnpm kit:add agent-header",
		code: AGENT_HEADER_ACTIONS_CODE,
		Demo: AgentHeaderActionsDemo,
	},
	"sub-agent-panel": {
		title: "SubAgentPanel（分区概览与空态）",
		command: "pnpm kit:add sub-agent-panel",
		code: SUB_AGENT_PANEL_CODE,
		Demo: SubAgentPanelDemo,
	},
	"sub-agent-panel-history": {
		title: "SubAgentPanel（执行记录弹窗与历史加载）",
		command: "pnpm kit:add sub-agent-panel",
		code: SUB_AGENT_PANEL_HISTORY_CODE,
		Demo: SubAgentPanelHistoryDemo,
	},
	menu: {
		title: "Menu（附件菜单）",
		command: "pnpm kit:add menu",
		code: MENU_CODE,
		Demo: MenuDemo,
	},
	"menu-align": {
		title: "Menu（行尾对齐与危险项）",
		command: "pnpm kit:add menu",
		code: MENU_ALIGN_CODE,
		Demo: MenuAlignDemo,
	},
	prompts: {
		title: "Prompts（开场引导）",
		command: "pnpm kit:add prompts",
		code: PROMPTS_CODE,
		Demo: PromptsDemo,
	},
	"prompts-layout": {
		title: "Prompts（布局与渐入）",
		command: "pnpm kit:add prompts",
		code: PROMPTS_LAYOUT_CODE,
		Demo: PromptsLayoutDemo,
	},
	"prompts-nest": {
		title: "Prompts（分组入口）",
		command: "pnpm kit:add prompts",
		code: PROMPTS_NEST_CODE,
		Demo: PromptsNestDemo,
	},
	sender: {
		title: "Sender（受控输入与停止生成）",
		command: "pnpm kit:add sender",
		code: SENDER_CODE,
		Demo: SenderDemo,
	},
	"sender-slots": {
		title: "Sender（工作区布局与插槽）",
		command: "pnpm kit:add sender",
		code: SENDER_SLOTS_CODE,
		Demo: SenderSlotsDemo,
	},
	"sender-skills": {
		title: "Sender（技能选择 chip）",
		command: "pnpm kit:add sender",
		code: SENDER_SKILLS_CODE,
		Demo: SenderSkillsDemo,
	},
	"sender-attachments": {
		title: "Sender（组合附件与上传）",
		command: "pnpm kit:add sender",
		code: SENDER_ATTACHMENTS_CODE,
		Demo: () => <SenderAttachmentsDemo uploadFile={simulateSenderUpload} />,
	},
	attachments: {
		title: "Attachments（选择与拖放）",
		command: "pnpm kit:add attachments",
		code: ATTACHMENTS_CODE,
		Demo: AttachmentsDemo,
	},
	"attachments-status": {
		title: "Attachments（上传状态与失败卡）",
		command: "pnpm kit:add attachments",
		code: ATTACHMENTS_STATUS_CODE,
		Demo: AttachmentsStatusDemo,
	},
	"attachments-overflow": {
		title: "Attachments（溢出与禁用）",
		command: "pnpm kit:add attachments",
		code: ATTACHMENTS_OVERFLOW_CODE,
		Demo: AttachmentsOverflowDemo,
	},
	"attachments-file-card": {
		title: "Attachments.FileCard（单文件卡片）",
		command: "pnpm kit:add attachments",
		code: FILE_CARD_CODE,
		Demo: AttachmentFileCardDemo,
	},
	suggestion: {
		title: "Suggestion（斜杠快捷指令）",
		command: "pnpm kit:add suggestion",
		code: SUGGESTION_CODE,
		Demo: SuggestionDemo,
	},
	actions: {
		title: "Actions（操作项与子菜单）",
		command: "pnpm kit:add actions",
		code: ACTIONS_CODE,
		Demo: ActionsDemo,
	},
	"actions-copy": {
		title: "Actions.Copy（复制与宿主注入）",
		command: "pnpm kit:add actions",
		code: ACTIONS_COPY_CODE,
		Demo: ActionsCopyDemo,
	},
	"actions-feedback": {
		title: "Actions.Feedback（受控赞踩）",
		command: "pnpm kit:add actions",
		code: ACTIONS_FEEDBACK_CODE,
		Demo: ActionsFeedbackDemo,
	},
	"file-card": {
		title: "FileCard（预览与下载）",
		command: "pnpm kit:add file-card",
		code: FEEDBACK_FILE_CARD_CODE,
		Demo: FileCardDemo,
	},
	"file-card-entries": {
		title: "FileCard（入口组合与缩略图）",
		command: "pnpm kit:add file-card",
		code: FEEDBACK_FILE_CARD_ENTRIES_CODE,
		Demo: FileCardEntriesDemo,
	},
	"file-card-states": {
		title: "FileCard（加载与禁用）",
		command: "pnpm kit:add file-card",
		code: FEEDBACK_FILE_CARD_STATES_CODE,
		Demo: FileCardStatesDemo,
	},
	"code-highlighter": {
		title: "CodeHighlighter（语言高亮与行号）",
		command: "pnpm kit:add code-highlighter",
		code: CODE_HIGHLIGHTER_CODE,
		Demo: CodeHighlighterDemo,
	},
	"code-highlighter-header": {
		title: "CodeHighlighter（自定义标题与工具栏）",
		command: "pnpm kit:add code-highlighter",
		code: CODE_HIGHLIGHTER_HEADER_CODE,
		Demo: CodeHighlighterHeaderDemo,
	},
	"code-highlighter-fallback": {
		title: "CodeHighlighter（纯文本降级与长行）",
		command: "pnpm kit:add code-highlighter",
		code: CODE_HIGHLIGHTER_FALLBACK_CODE,
		Demo: CodeHighlighterFallbackDemo,
	},
	mermaid: {
		title: "Mermaid（图表与源码）",
		command: "pnpm kit:add mermaid",
		code: MERMAID_CODE,
		Demo: MermaidDemo,
	},
	"mermaid-streaming": {
		title: "Mermaid（流式生成中）",
		command: "pnpm kit:add mermaid",
		code: MERMAID_STREAMING_CODE,
		Demo: MermaidStreamingDemo,
	},
	"mermaid-fallback": {
		title: "Mermaid（失败与资源降级）",
		command: "pnpm kit:add mermaid",
		code: MERMAID_FALLBACK_CODE,
		Demo: MermaidFallbackDemo,
	},
	chat: {
		title: "Chat（消息列表 + Sender + 流式）",
		command: "pnpm kit:add chat",
		code: CHAT_CODE,
		Demo: ChatDemo,
	},
	"multi-agent": {
		title: "Chat（主子 Agent、历史分页与重试）",
		command: "pnpm kit:add chat",
		code: MULTI_AGENT_CODE,
		Demo: MultiAgentDemo,
	},
	message: {
		title: "MessageList / Message（气泡与分片）",
		command: "pnpm kit:add message",
		code: MESSAGE_CODE,
		Demo: MessageDemo,
	},
	"tool-approval": {
		title: "ToolApprovalCard（允许与拒绝）",
		command: "pnpm kit:add tool-approval",
		code: APPROVAL_CODE,
		Demo: ToolApprovalDemo,
	},
	"tool-approval-recovery": {
		title: "ToolApprovalCard（异常与恢复）",
		command: "pnpm kit:add tool-approval",
		code: APPROVAL_RECOVERY_CODE,
		Demo: ToolApprovalRecoveryDemo,
	},
	"tool-approval-group": {
		title: "ToolApprovalGroup（多项审批翻页）",
		command: "pnpm kit:add tool-approval",
		code: APPROVAL_GROUP_CODE,
		Demo: ToolApprovalGroupDemo,
	},
	tooltip: {
		title: "Tooltip（方位与显隐）",
		command: "pnpm kit:add tooltip",
		code: TOOLTIP_CODE,
		Demo: TooltipDemo,
	},
	"tooltip-overflow": {
		title: "Tooltip（溢出提示）",
		command: "pnpm kit:add tooltip",
		code: TOOLTIP_OVERFLOW_CODE,
		Demo: TooltipOverflowDemo,
	},
	"tooltip-rich": {
		title: "Tooltip（富内容气泡）",
		command: "pnpm kit:add tooltip",
		code: TOOLTIP_RICH_CODE,
		Demo: TooltipRichDemo,
	},
	tools: {
		title: "ToolCallCard / ReasoningBlock / ArtifactCard",
		command: "pnpm kit:add message",
		code: TOOL_CODE,
		Demo: ToolStatesDemo,
	},
	markdown: {
		title: "Markdown（GFM + sanitize + 高亮）",
		command: "pnpm kit:add markdown",
		code: MARKDOWN_CODE,
		Demo: MarkdownDemo,
	},
	layout: {
		title: "Layout（导航、移动抽屉与确认操作）",
		command: "pnpm kit:add layout && pnpm kit:add chrome && pnpm kit:add chat",
		code: LAYOUT_CODE,
		Demo: LayoutDemo,
	},
	chrome: {
		title: "Layout / AgentHeader / ConfirmDialog",
		command: "pnpm kit:add layout && pnpm kit:add chrome && pnpm kit:add chat",
		code: LAYOUT_CODE,
		Demo: LayoutDemo,
	},
	status: {
		title: "StatusIndicator（连接 / 流式 / 错误）",
		command: "pnpm kit:add chrome",
		code: STATUS_CODE,
		Demo: StatusDemo,
	},
	threads: {
		title: "ThreadPanel（旧版分组兼容）",
		command: "pnpm kit:add chrome",
		code: THREAD_CODE,
		Demo: ThreadDemo,
	},
	states: { title: "EmptyState / ErrorState", command: "pnpm kit:add chrome", code: STATES_CODE, Demo: StatesDemo },
	"sse-stream": {
		title: "createSseStream（解码、分帧与取消）",
		code: SSE_STREAM_CODE,
		Demo: SseStreamDemo,
	},
	"sse-parser": {
		title: "createSseParser / decodeFrame（切帧与协议帧解码）",
		code: SSE_PARSER_CODE,
		Demo: SseParserDemo,
	},
	"kit-stream": {
		title: "client.stream（订阅与游标续传）",
		code: KIT_STREAM_CODE,
		Demo: KitStreamDemo,
	},
	controller: {
		title: "createChatController（无 React 编排）",
		code: CONTROLLER_CODE,
		Demo: ControllerDemo,
	},
	"request-basic": {
		title: "createRequest 基础请求",
		code: REQUEST_BASIC_CODE,
		Demo: RequestBasicDemo,
	},
	"request-custom": {
		title: "createRequest 请求定制",
		code: REQUEST_CUSTOM_CODE,
		Demo: RequestCustomDemo,
	},
	"request-stream": {
		title: "createRequest 读取 SSE 流",
		code: REQUEST_STREAM_CODE,
		Demo: RequestStreamDemo,
	},
	"request-error": {
		title: "createRequest 错误映射",
		code: REQUEST_ERROR_CODE,
		Demo: RequestErrorDemo,
	},
	"bailian-provider": {
		title: "createBailianChatProvider 连接时序",
		code: PROVIDER_CODE,
		Demo: BailianProviderDemo,
	},
	"provider-events": {
		title: "已转换事件：五方法 Provider",
		code: EVENTS_CODE,
		Demo: TransformedProviderDemo,
	},
	"provider-transform": {
		title: "transformMessage 换展示",
		code: TRANSFORM_CODE,
		Demo: TransformMessageDemo,
	},
	sessions: {
		title: "useSessions（列表、创建与选中）",
		code: SESSIONS_CODE,
		Demo: SessionsDemo,
	},
	"use-chat": {
		title: "useChat（消息、状态与发送）",
		code: USE_CHAT_CODE,
		Demo: UseChatDemo,
	},
	"tool-approvals": {
		title: "useChat approvals（工具审批流）",
		code: TOOL_APPROVALS_CODE,
		Demo: ApprovalDemo,
	},
};

/** MDX 里用 `<Showcase name="chat" />` 渲染「真实组件 + 设备切换 + 源码 + copy-in 命令」。 */
export function Showcase({ name }: { name: string }) {
	if (!isShowcaseName(name)) {
		return (
			<p className="text-sm text-fd-muted-foreground">
				未知预览：<code>{name}</code>（可选：{Object.keys(SHOWCASES).join(" / ")}）
			</p>
		);
	}
	const entry = SHOWCASES[name];
	return <Preview title={entry.title} command={entry.command} code={entry.code} previewName={name} />;
}

/** 静态 iframe 路由只渲染组件本身，避免把文档导航与代码面板嵌套进去。 */
export function ShowcaseDemo({ name }: { name: ShowcaseName }) {
	const Demo = SHOWCASES[name].Demo;
	return <Demo />;
}
