"use client";

import {
	AgentHeader,
	Chat,
	ConfirmDialog,
	EmptyState,
	Layout,
	Menu,
	MenuContent,
	MenuItem,
	MenuTrigger,
	Prompts,
	Sender,
	SessionSidebar,
	StatusIndicator,
} from "@openagentpack/kit-chat-ui";
import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import type { AgentSummary, SessionSummary } from "@openagentpack/kit-sdk/protocol";
import { useRef, useState } from "react";
import { LogoMark, MessageSquare, SignalBars } from "../icons.tsx";

/** 行尾「更多操作」菜单由预览经 render prop 构造；归档/删除先经 ConfirmDialog。 */
function RowMenu({ onClick }: { onClick: (action: "archive" | "delete") => void }) {
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
				<MenuItem onSelect={() => onClick("archive")}>归档</MenuItem>
				<MenuItem className="text-[var(--kit-danger)]" onSelect={() => onClick("delete")}>
					删除
				</MenuItem>
			</MenuContent>
		</Menu>
	);
}

export const AGENT: AgentSummary = {
	slug: "support-agent",
	display_name: "客服助手",
	description: "开场白、示例问题与能力由调用方提供",
	opening_remarks: "你好，我是客服助手，可以查订单、改地址、开发票。",
	suggested_prompts: ["查一下我的订单", "帮我改收货地址", "怎么开发票？"],
	capabilities: { streaming: true, fileUpload: true, artifacts: true, threads: true, reasoning: true },
	category: "general",
	featured: false,
};

export const AGENTS: AgentSummary[] = [
	AGENT,
	{
		...AGENT,
		slug: "writing-agent",
		display_name: "写作助手",
		description: "帮助整理思路与修改文稿",
		opening_remarks: "想一起写点什么？",
		suggested_prompts: ["写一份周报提纲", "把这段话改得更清楚"],
	},
];

export const SESSIONS: SessionSummary[] = [
	{
		session_id: "s1",
		agent_slug: "support-agent",
		title: "订单 2026101 物流异常",
		status: "idle",
		created_at: "2026-10-15T02:11:00.000Z",
	},
	{
		session_id: "s2",
		agent_slug: "support-agent",
		title: "开发票",
		status: "idle",
		created_at: "2026-10-15T01:40:00.000Z",
	},
	{ session_id: "s3", agent_slug: "support-agent", status: "archived", created_at: "2026-10-14T09:02:00.000Z" },
];

/** 整页布局仅持有本地演示状态；抽屉、焦点与视口行为来自公共 Layout。 */
export function LayoutDemo() {
	const [view, setView] = useState<"chat" | "usage">("chat");
	const [sessions, setSessions] = useState(SESSIONS);
	const [activeId, setActiveId] = useState<string | null>("s1");
	const [draft, setDraft] = useState("");
	const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
	const [pending, setPending] = useState<{ id: string; action: "archive" | "delete" } | null>(null);
	const [notice, setNotice] = useState("本地交互演示，不连接 Agent 服务。");
	const [searchInput, setSearchInput] = useState("");
	const sequence = useRef(0);
	const visibleSessions = sessions.filter((session) => session.status !== "archived");
	const activeSession = sessions.find((session) => session.session_id === activeId);
	const pendingSession = sessions.find((session) => session.session_id === pending?.id);
	const sentCount = Object.values(messages)
		.flat()
		.filter((message) => message.role === "user").length;

	const createSession = () => {
		const id = `layout-session-${++sequence.current}`;
		setSessions((current) => [
			{ session_id: id, agent_slug: AGENT.slug, title: "新会话", status: "idle", created_at: new Date().toISOString() },
			...current,
		]);
		setActiveId(id);
		setView("chat");
		return id;
	};
	const send = (text: string) => {
		const sessionId = activeId ?? createSession();
		const id = `layout-message-${++sequence.current}`;
		setMessages((current) => ({
			...current,
			[sessionId]: [
				...(current[sessionId] ?? []),
				{
					id,
					role: "user",
					status: "done",
					createdAt: new Date().toISOString(),
					parts: [{ id: `${id}-text`, type: "text", text }],
				},
				{
					id: `${id}-reply`,
					role: "assistant",
					status: "done",
					createdAt: new Date().toISOString(),
					parts: [
						{
							id: `${id}-reply-text`,
							type: "text",
							text: "已收到。这是一条本地模拟回复，可以继续切换会话或查看我的用量。",
						},
					],
				},
			],
		}));
		setDraft("");
		setNotice("已在当前预览中发送消息。");
	};
	const confirm = () => {
		if (!pending) return;
		setSessions((current) =>
			pending.action === "delete"
				? current.filter((session) => session.session_id !== pending.id)
				: current.map((session) => (session.session_id === pending.id ? { ...session, status: "archived" } : session)),
		);
		if (activeId === pending.id) setActiveId(null);
		setNotice(`已在本地预览中${pending.action === "delete" ? "删除" : "归档"}会话，输入草稿仍保留。`);
		setPending(null);
	};

	return (
		<div className="h-dvh min-h-0 w-full" data-kit-appearance="workspace">
			<Layout
				header={(menuToggle) => (
					<AgentHeader
						agent={AGENT}
						compact
						leading={menuToggle}
						actions={<StatusIndicator variant="badge" connected turnRunning={false} />}
					/>
				)}
				dialogs={
					pending ? (
						<ConfirmDialog
							title={pending.action === "archive" ? "归档会话" : "删除会话"}
							body={`本地变更预览：将${pending.action === "archive" ? "归档" : "删除"} 1 个会话「${pendingSession?.title ?? pending.id}」，并从最近会话中移除。仅修改演示数据，不调用后端。`}
							onCancel={() => setPending(null)}
							onConfirm={confirm}
						/>
					) : null
				}
				sidebar={({ closeSidebar, closeButton }) => (
					<aside className="flex min-h-0 w-64 shrink-0 flex-col border-r border-[var(--kit-border-subtle)] bg-[var(--kit-bg-subtle)]">
						<div className="flex min-h-16 shrink-0 items-center gap-3 px-4 py-3">
							<LogoMark className="h-6 w-6 shrink-0" />
							<strong className="min-w-0 flex-1 truncate text-[length:var(--kit-text-base)]">Managed Agent</strong>
							{closeButton}
						</div>
						<div className="shrink-0 px-3 pb-1">
							<button
								type="button"
								onClick={() => {
									createSession();
									closeSidebar();
								}}
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
							groups={[{ id: AGENT.slug, name: AGENT.display_name, sessions: visibleSessions, initialized: true }]}
							recent={{ sessions: visibleSessions, initialized: true }}
							activeId={activeId}
							onSelect={(session) => {
								setActiveId(session.session_id);
								setView("chat");
								closeSidebar();
							}}
							menu={(session) => <RowMenu onClick={(action) => setPending({ id: session.session_id, action })} />}
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
									onClick={() => {
										setView(id);
										closeSidebar();
									}}
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
				)}
			>
				<p
					role="status"
					className="shrink-0 px-4 py-2 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]"
				>
					{notice}
				</p>
				{view === "chat" ? (
					<Chat
						variant="workspace"
						messages={activeId ? (messages[activeId] ?? []) : []}
						scrollKey={activeId}
						empty={
							<div className="my-auto flex flex-col gap-4 p-4">
								<EmptyState title={activeSession?.title ?? "开始新会话"} hint={AGENT.opening_remarks} />
								<Prompts
									wrap
									items={AGENT.suggested_prompts.map((text) => ({ key: text, label: text }))}
									onItemClick={({ data }) => setDraft(data.key)}
									classNames={{ list: "justify-center" }}
								/>
							</div>
						}
						sender={
							<Sender
								variant="workspace"
								value={draft}
								onChange={setDraft}
								onSubmit={send}
								placeholder="输入消息，切页或切换会话后草稿仍保留"
							/>
						}
					/>
				) : (
					<section className="min-h-0 flex-1 overflow-y-auto p-6" aria-label="我的用量">
						<h2 className="text-[length:var(--kit-text-title)] font-semibold">我的用量</h2>
						<p className="mt-3 text-[length:var(--kit-text-body)]">
							本次预览已发送 {sentCount} 条消息，最近会话 {visibleSessions.length} 个。
						</p>
						<p className="mt-3 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
							返回对话后，未发送的输入草稿仍会保留。这里不查询或计入真实用量。
						</p>
					</section>
				)}
			</Layout>
		</div>
	);
}
