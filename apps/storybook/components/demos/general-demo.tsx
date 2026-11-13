"use client";

import {
	AgentHeader,
	EmptyState,
	Menu,
	MenuContent,
	MenuItem,
	MenuTrigger,
	MessageList,
	SessionList,
	SessionSidebar,
	StatusIndicator,
	SubAgentPanel,
} from "@openagentpack/kit-chat-ui";
import type { ChatAgentThread, ChatMultiAgent } from "@openagentpack/kit-sdk/chat";
import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import type { SessionSummary } from "@openagentpack/kit-sdk/protocol";
import { useRef, useState } from "react";
import { LogoMark, MessageSquare, SignalBars } from "../icons.tsx";
import { AGENT, AGENTS, SESSIONS } from "./layout-demo.tsx";
import { MESSAGES } from "./message-demo.tsx";

/** 行尾「更多操作」菜单由预览经 render prop 构造；操作只改本地演示状态。 */
function RowMenu({ onClick }: { onClick: (action: "rename" | "archive" | "delete") => void }) {
	return (
		<Menu>
			<MenuTrigger asChild>
				<button
					type="button"
					aria-label="更多操作"
					title="更多操作"
					className="grid size-full cursor-pointer place-items-center rounded-[var(--kit-radius-sm)] outline-none"
				>
					<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
						<circle cx="5" cy="12" r="1.5" />
						<circle cx="12" cy="12" r="1.5" />
						<circle cx="19" cy="12" r="1.5" />
					</svg>
				</button>
			</MenuTrigger>
			<MenuContent align="end">
				<MenuItem onSelect={() => onClick("rename")}>重命名</MenuItem>
				<MenuItem onSelect={() => onClick("archive")}>归档</MenuItem>
				<MenuItem className="text-[var(--kit-danger)]" onSelect={() => onClick("delete")}>
					删除
				</MenuItem>
			</MenuContent>
		</Menu>
	);
}

export const CONTROL_CLASS =
	"rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] bg-[var(--kit-bg)] px-3 py-2 text-sm";
export const TOOLBAR_CLASS = "flex flex-wrap items-center gap-2 border-b border-[var(--kit-border)] p-3 text-sm";

/** 列表独立提供滚动容器，追加消息、开关自动滚动和清空均为本地操作。 */
export function MessageListDemo() {
	const [messages, setMessages] = useState<ChatMessage[]>(MESSAGES);
	const [autoScroll, setAutoScroll] = useState(true);
	const sequence = useRef(0);
	const append = () => {
		sequence.current += 1;
		const number = sequence.current;
		const id = `list-demo-${number}`;
		setMessages((current) => [
			...current,
			{
				id,
				role: "assistant",
				status: "done",
				parts: [
					{
						id: `${id}-text`,
						type: "text",
						text: `第 ${number} 条追加消息。可以向上阅读历史，再追加消息观察滚动位置。`,
					},
				],
			},
		]);
	};
	return (
		<div
			data-kit-appearance="workspace"
			className="relative min-h-[inherit] min-w-0 flex-1 bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className="absolute inset-0 flex min-h-0 flex-col">
				<div className={TOOLBAR_CLASS}>
					<button type="button" className={CONTROL_CLASS} onClick={append}>
						追加消息
					</button>
					<button type="button" className={CONTROL_CLASS} onClick={() => setMessages([])}>
						清空
					</button>
					<label className="flex items-center gap-2">
						<input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
						自动跟随
					</label>
				</div>
				<MessageList
					variant="workspace"
					messages={messages}
					autoScroll={autoScroll}
					empty={<EmptyState title="消息列表为空" hint="点击追加消息开始预览" />}
				/>
			</div>
		</div>
	);
}

/** 由外部容器决定宽度，不包含新建或删除等业务流程。 */
export function SessionListDemo() {
	const [activeId, setActiveId] = useState<string | null>("s1");
	const [empty, setEmpty] = useState(false);
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={empty} onChange={(event) => setEmpty(event.target.checked)} />
					查看空列表
				</label>
				<span role="status">当前会话：{empty ? "无" : (activeId ?? "未选择")}</span>
			</div>
			<SessionList
				variant="workspace"
				sessions={empty ? [] : SESSIONS}
				activeId={activeId}
				onSelect={(session) => setActiveId(session.session_id)}
			/>
		</div>
	);
}

/** 行内状态与「更多操作」：状态由演示数据标注，打开行的实时状态经 activeStatus 注入；操作只改本地状态。 */
const STATUS_SESSIONS: SessionSummary[] = [
	{
		session_id: "st-running",
		agent_slug: "support-agent",
		title: "生成季度经营报表",
		status: "running",
		created_at: "2026-11-09T02:11:00.000Z",
	},
	{
		session_id: "st-approval",
		agent_slug: "support-agent",
		title: "审批差旅报销单",
		status: "requires_action",
		created_at: "2026-11-09T01:40:00.000Z",
	},
	{
		session_id: "st-failed",
		agent_slug: "support-agent",
		title: "同步 CRM 联系人",
		status: "failed",
		created_at: "2026-11-08T18:02:00.000Z",
	},
	{
		session_id: "st-idle",
		agent_slug: "support-agent",
		title: "整理会议纪要",
		status: "idle",
		created_at: "2026-11-08T09:00:00.000Z",
	},
];

export function SessionListStatusDemo() {
	const [sessions, setSessions] = useState(STATUS_SESSIONS);
	const [activeId, setActiveId] = useState<string | null>("st-idle");
	const [editingId, setEditingId] = useState<string | null>(null);
	const [note, setNote] = useState("悬停会话行，行尾 ⋯ 打开更多操作");
	// render prop：每行渲染时构造菜单元素，session 与三个操作的收口都在这一处闭包里。
	const beginRename = (id: string) => setEditingId(id);
	const endEditing = (id: string) => setEditingId((current) => (current === id ? null : current));
	const archiveSession = (id: string) => {
		setSessions((current) =>
			current.map((session) => (session.session_id === id ? { ...session, status: "archived" } : session)),
		);
		setNote("已归档（真实接入先经 AlertDialog 确认）");
	};
	const removeSession = (id: string) => {
		setSessions((current) => current.filter((session) => session.session_id !== id));
		setActiveId((current) => (current === id ? null : current));
		setNote("已删除（真实接入先经 AlertDialog 确认）");
	};
	// 演示数据里的 status 是协议索引状态；activeStatus prop 只收中性展示词，在这里映射。
	const activeStatus = STATUS_SESSIONS.find((session) => session.session_id === activeId)?.status;
	const activeStatusMark =
		activeStatus === "running"
			? ("running" as const)
			: activeStatus === "requires_action"
				? ("attention" as const)
				: activeStatus === "failed"
					? ("failed" as const)
					: undefined;
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className={TOOLBAR_CLASS}>
				<span role="status">{note}</span>
			</div>
			<SessionList
				variant="workspace"
				sessions={sessions}
				activeId={activeId}
				activeStatus={activeStatusMark}
				onSelect={(session) => {
					setActiveId(session.session_id);
					setNote(`已选择：${session.title || session.session_id}`);
				}}
				menu={(session) => (
					<RowMenu
						onClick={(action) => {
							if (action === "rename") beginRename(session.session_id);
							if (action === "archive") archiveSession(session.session_id);
							if (action === "delete") removeSession(session.session_id);
						}}
					/>
				)}
				editingId={editingId}
				onEdited={(id, title) => {
					setSessions((current) =>
						current.map((session) => (session.session_id === id ? { ...session, title } : session)),
					);
					setNote(`已重命名为「${title}」`);
				}}
				onEditEnd={endEditing}
			/>
		</div>
	);
}

const DIRECTORY_SESSIONS: SessionSummary[] = [
	...Array.from({ length: 12 }, (_, index) => ({
		session_id: `dir-support-${index + 1}`,
		agent_slug: "support-agent",
		title: `订单咨询 ${index + 1}`,
		status: "idle" as const,
		created_at: `2026-10-15T02:${String(index * 3).padStart(2, "0")}:00.000Z`,
	})),
	{
		session_id: "dir-writing-1",
		agent_slug: "writing-agent",
		title: "周报提纲",
		status: "idle",
		created_at: "2026-10-15T01:40:00.000Z",
	},
	{
		session_id: "dir-writing-2",
		agent_slug: "writing-agent",
		title: "产品命名头脑风暴",
		status: "running",
		created_at: "2026-10-15T01:12:00.000Z",
	},
];

/** 分组会话目录：目录区只负责展示与行内交互；分组/最近的数据、懒加载与动作由调用方注入。 */
export function SessionSidebarBasicDemo() {
	const [sessions, setSessions] = useState(DIRECTORY_SESSIONS);
	const [loadedCount, setLoadedCount] = useState(10);
	const [activeId, setActiveId] = useState<string | null>("dir-support-1");
	const [activeSection, setActiveSection] = useState<"groups" | "recent">("groups");
	const [editing, setEditing] = useState<{ id: string; section: "groups" | "recent" } | null>(null);
	const [note, setNote] = useState("展开「客服助手」模拟懒加载：补齐剩余会话并去掉 + 号");
	const [searchInput, setSearchInput] = useState("");
	const support = sessions.filter((session) => session.agent_slug === "support-agent");
	const writing = sessions.filter((session) => session.agent_slug === "writing-agent");
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className={TOOLBAR_CLASS}>
				<span role="status">{note}</span>
			</div>
			<div className="flex min-h-0 flex-1">
				<aside className="flex min-h-0 w-72 shrink-0 flex-col border-r border-[var(--kit-border-subtle)] bg-[var(--kit-bg-subtle)]">
					<SessionSidebar
						groups={[
							{
								id: "support-agent",
								name: "客服助手",
								sessions: support.slice(0, loadedCount),
								initialized: true,
								hasMore: loadedCount < support.length,
								onLoad: () => setLoadedCount(support.length),
							},
							{ id: "writing-agent", name: "写作助手", sessions: writing, initialized: true },
						]}
						recent={{ sessions: sessions.slice(-6).reverse(), initialized: true }}
						activeId={activeId}
						activeSection={activeSection}
						onSelect={(session, section) => {
							setActiveId(session.session_id);
							setActiveSection(section);
							setNote(`已选择（${section === "groups" ? "分组" : "最近"}）：${session.title || session.session_id}`);
						}}
						menu={(session, section) => (
							<RowMenu
								onClick={(action) => {
									if (action === "rename") setEditing({ id: session.session_id, section });
									else
										setNote(
											action === "archive"
												? "归档需先经 AlertDialog 确认（演示不执行）"
												: "删除需先经 AlertDialog 确认（演示不执行）",
										);
								}}
							/>
						)}
						editing={editing}
						onEdited={(id, title) => {
							setSessions((current) =>
								current.map((session) => (session.session_id === id ? { ...session, title } : session)),
							);
							setNote(`已重命名为「${title}」`);
						}}
						onEditEnd={(id) => setEditing((current) => (current?.id === id ? null : current))}
						searchInput={searchInput}
						onSearchInput={setSearchInput}
					/>
				</aside>
				<div aria-hidden="true" className="min-w-0 flex-1" />
			</div>
		</div>
	);
}

/** 员工端外壳：品牌、新聊天、业务导航与账号是 rail 的一部分，由调用方组装；目录区保持组件默认行为。 */
export function SessionSidebarWorkspaceDemo() {
	const [view, setView] = useState<"chat" | "usage">("chat");
	const [activeId, setActiveId] = useState<string | null>("dir-support-1");
	const [editing, setEditing] = useState<{ id: string; section: "groups" | "recent" } | null>(null);
	const [sessions, setSessions] = useState(DIRECTORY_SESSIONS);
	const [searchInput, setSearchInput] = useState("");
	const writing = sessions.filter((session) => session.agent_slug === "writing-agent");
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className="flex min-h-0 flex-1">
				<aside className="flex min-h-0 w-64 shrink-0 flex-col border-r border-[var(--kit-border-subtle)] bg-[var(--kit-bg-subtle)]">
					<div className="flex min-h-14 shrink-0 items-center gap-3 px-4 py-3">
						<LogoMark className="h-6 w-6 shrink-0" />
						<strong className="min-w-0 flex-1 truncate text-[length:var(--kit-text-base)]">Managed Agent</strong>
					</div>
					<div className="shrink-0 px-3 pb-1">
						<button
							type="button"
							className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[var(--kit-radius)] bg-[var(--kit-accent)] px-3 py-2 text-[length:var(--kit-text-label)] font-medium text-[var(--kit-accent-fg)] transition-[opacity,transform] duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:opacity-90 active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]"
						>
							<svg
								aria-hidden="true"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								className="size-3.5"
							>
								<path d="M12 5v14M5 12h14" strokeLinecap="round" />
							</svg>
							新聊天
						</button>
					</div>
					<SessionSidebar
						groups={[{ id: "support-agent", name: "客服助手", sessions: sessions.slice(0, 12), initialized: true }]}
						recent={{ sessions: writing, initialized: true }}
						activeId={activeId}
						onSelect={(session) => setActiveId(session.session_id)}
						menu={(session, section) => (
							<RowMenu
								onClick={(action) => {
									if (action === "rename") setEditing({ id: session.session_id, section });
								}}
							/>
						)}
						editing={editing}
						onEdited={(id, title) => {
							setSessions((current) =>
								current.map((session) => (session.session_id === id ? { ...session, title } : session)),
							);
						}}
						onEditEnd={(id) => setEditing((current) => (current?.id === id ? null : current))}
						searchInput={searchInput}
						onSearchInput={setSearchInput}
					/>
					<nav aria-label="预览主导航" className="flex shrink-0 flex-col gap-1 px-3 py-1">
						{(
							[
								{ id: "chat", label: "对话", Icon: MessageSquare },
								{ id: "usage", label: "我的用量", Icon: SignalBars },
							] as const
						).map(({ id, label, Icon }) => (
							<button
								key={id}
								type="button"
								aria-current={view === id ? "page" : undefined}
								onClick={() => setView(id)}
								className={`flex min-h-10 cursor-pointer items-center gap-3 rounded-[var(--kit-radius-sm)] px-3 py-2 text-left text-[length:var(--kit-text-label)] transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:bg-[var(--kit-surface)] focus-visible:outline-2 focus-visible:outline-[var(--kit-focus)] ${view === id ? "bg-[var(--kit-nav-active)] font-medium" : "text-[var(--kit-fg-muted)]"}`}
							>
								<Icon className="h-4 w-4 shrink-0" />
								{label}
							</button>
						))}
					</nav>
					<div className="mx-3 flex items-center gap-3 border-t border-[var(--kit-border)] px-1 py-3">
						<div
							aria-hidden
							className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--kit-nav-active)]"
						>
							<LogoMark className="h-5 w-5" />
						</div>
						<div className="min-w-0 text-[length:var(--kit-text-label)]">
							<p className="truncate font-medium">演示用户</p>
							<p className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">本地预览账号</p>
						</div>
					</div>
				</aside>
				<div aria-hidden="true" className="min-w-0 flex-1" />
			</div>
		</div>
	);
}

/** 工作区页头：标题下拉切换 Agent，leading 放侧栏开关；compact 固定高度并省略描述。 */
export function AgentHeaderDemo() {
	const [agentSlug, setAgentSlug] = useState(AGENT.slug);
	const [compact, setCompact] = useState(true);
	const [note, setNote] = useState("切换与操作结果显示在这里");
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={compact} onChange={(event) => setCompact(event.target.checked)} />
					紧凑页头
				</label>
				<span role="status">{note}</span>
			</div>
			<AgentHeader
				agent={AGENTS.find((agent) => agent.slug === agentSlug) ?? AGENT}
				compact={compact}
				agents={AGENTS}
				onPickAgent={(slug) => {
					setAgentSlug(slug);
					setNote(`已切换 Agent：${AGENTS.find((agent) => agent.slug === slug)?.display_name ?? slug}`);
				}}
				leading={
					<button type="button" className={CONTROL_CLASS} onClick={() => setNote("已触发侧栏开关")}>
						菜单
					</button>
				}
				onNewSession={() => setNote("已触发新会话回调")}
			/>
		</div>
	);
}

/** 操作区插槽：显式传 actions 替代默认新会话按钮（自定义按钮 + 状态徽标）；置 null 整块隐藏。 */
export function AgentHeaderActionsDemo() {
	const [hidden, setHidden] = useState(false);
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} />
					隐藏操作区（actions 置 null）
				</label>
			</div>
			<AgentHeader
				compact
				agent={AGENT}
				actions={
					hidden ? null : (
						<>
							<button type="button" className={CONTROL_CLASS}>
								查看详情
							</button>
							<StatusIndicator variant="badge" connected turnRunning phase="running" />
						</>
					)
				}
			/>
		</div>
	);
}

/** 演示线程基座：loaded 即无加载态，mock 的 loadThreadEvents 保持空实现，时间线直接展示 messages。 */
function panelThread(id: string, overrides: Partial<ChatAgentThread>): ChatAgentThread {
	return {
		id,
		name: "research",
		status: "idle",
		messages: [],
		loading: false,
		error: null,
		nextPageToken: null,
		historyAvailable: true,
		loaded: true,
		...overrides,
	};
}

const SUB_AGENT_MESSAGES: ChatMessage[] = [
	{
		id: "sub-agent-demo-1",
		role: "assistant",
		status: "done",
		parts: [
			{
				type: "reasoning",
				text: "先列对比维度，再逐家取数。",
				status: "done",
				startedAt: "2026-11-10T01:30:01.000Z",
			},
			{ type: "text", text: "已整理定价与配额对比，结论见产物表格。" },
		],
	},
];

const SUB_AGENT_MULTI: ChatMultiAgent = {
	selectedThreadId: null,
	threads: [
		panelThread("sthr-pricing", {
			status: "running",
			task: "对比三家云厂商的 API 定价与配额，输出对比表",
			// 运行计时从「45 秒前」起逐秒走，弹窗头部可见「正在执行 Ns」形态。
			createdAt: new Date(Date.now() - 45_000).toISOString(),
			messages: SUB_AGENT_MESSAGES,
		}),
		panelThread("sthr-quota", {
			task: "整理国内大模型 API 限流策略",
			createdAt: "2026-11-10T01:30:00.000Z",
			endedAt: "2026-11-10T01:30:48.000Z",
			messages: SUB_AGENT_MESSAGES,
		}),
		panelThread("sthr-slide", {
			name: "slide-maker",
			status: "failed",
			task: "根据评审大纲起草 12 页季度汇报",
			createdAt: "2026-11-10T01:10:00.000Z",
			endedAt: "2026-11-10T01:11:12.000Z",
			messages: SUB_AGENT_MESSAGES,
		}),
	],
	loading: false,
	error: null,
	selectThread: () => undefined,
	refreshThreads: async () => undefined,
	loadThreadEvents: async () => undefined,
};

/** 分区概览：research 按展示名分组计数，行内区分运行中/完成/失败；勾选后线程清空，分区整体不渲染。 */
export function SubAgentPanelDemo() {
	const [empty, setEmpty] = useState(false);
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={empty} onChange={(event) => setEmpty(event.target.checked)} />
					清空线程（观察空态）
				</label>
			</div>
			<div className="mx-auto flex w-80 min-h-0 flex-1 flex-col border-l border-[var(--kit-border-subtle)] px-4 py-4">
				<SubAgentPanel multiAgent={empty ? { ...SUB_AGENT_MULTI, threads: [] } : SUB_AGENT_MULTI} />
			</div>
		</div>
	);
}

/** 翻页演示：mock 400ms 拉取更早事件后清除 nextPageToken；期间按钮禁用并显示加载文案。 */
const SUB_AGENT_OLDER_MESSAGES: ChatMessage[] = [
	{
		id: "sub-agent-demo-0",
		role: "assistant",
		status: "done",
		parts: [
			{
				type: "reasoning",
				text: "先取各家公开定价页，再核对官方限流文档。",
				status: "done",
				startedAt: "2026-11-10T01:29:40.000Z",
			},
			{ type: "text", text: "首轮取数完成，开始汇总对比表。" },
		],
	},
];

const SUB_AGENT_HISTORY_THREADS: ChatAgentThread[] = [
	panelThread("sthr-price", {
		status: "completed",
		task: "对比三家云厂商的 API 定价与配额，输出对比表",
		createdAt: "2026-11-10T01:30:00.000Z",
		endedAt: "2026-11-10T01:30:48.000Z",
		messages: SUB_AGENT_MESSAGES,
		nextPageToken: "page-2",
	}),
	panelThread("sthr-slide", {
		name: "slide-maker",
		status: "completed",
		task: "根据评审大纲起草 12 页季度汇报",
		createdAt: "2026-11-10T02:00:00.000Z",
		endedAt: "2026-11-10T02:00:31.000Z",
		historyAvailable: false,
	}),
];

/** 执行记录弹窗与历史加载：research 可翻页（more: true），slide-maker 无可回放历史只显示本次收到的消息。 */
export function SubAgentPanelHistoryDemo() {
	const [threads, setThreads] = useState(SUB_AGENT_HISTORY_THREADS);
	const multiAgent: ChatMultiAgent = {
		selectedThreadId: null,
		threads,
		loading: false,
		error: null,
		selectThread: () => undefined,
		refreshThreads: async () => undefined,
		loadThreadEvents: async (id, options) => {
			if (!options?.more) return;
			setThreads((current) => current.map((thread) => (thread.id === id ? { ...thread, loading: true } : thread)));
			await new Promise((resolve) => setTimeout(resolve, 400));
			setThreads((current) =>
				current.map((thread) =>
					thread.id === id
						? {
								...thread,
								loading: false,
								nextPageToken: null,
								messages: [...SUB_AGENT_OLDER_MESSAGES, ...thread.messages],
							}
						: thread,
				),
			);
		},
	};
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className="mx-auto flex w-80 min-h-0 flex-1 flex-col border-l border-[var(--kit-border-subtle)] px-4 py-4">
				<SubAgentPanel multiAgent={multiAgent} />
			</div>
		</div>
	);
}
