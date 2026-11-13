import {
	AgentHeader,
	Chat,
	EmptyState,
	ErrorState,
	Menu,
	MenuContent,
	MenuItem,
	MenuTrigger,
	Prompts,
	Sender,
	SessionSidebar,
	type SessionSidebarSection,
	StatusIndicator,
	Suggestion,
	ToolApprovalGroup,
} from "@openagentpack/kit-chat-ui";
import { useAgentCatalog } from "@openagentpack/kit-sdk/agents/hooks";
import type { MemberAuthController } from "@openagentpack/kit-sdk/auth";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";
import { useKitClient } from "@openagentpack/kit-sdk/providers/kit/react";
import { useSessions } from "@openagentpack/kit-sdk/sessions/hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MemberAccount, MemberAuthGate } from "./features/auth/member-auth-gate.tsx";
import { saveFileWithHost } from "./lib/host.ts";

/** 首句当标题：会话在首次发送时才创建，用首句折叠空白截到协议上限；空文本回退 agent_slug 展示。 */
function deriveTitle(text: string): string | undefined {
	const compact = text.replace(/\s+/g, " ").trim();
	return compact ? compact.slice(0, 120) : undefined;
}

/** 行尾操作菜单由业务渲染：触发按钮、弹层与菜单项全部在本模板内组装；
 * 重命名项只改 editing（id + 来源分区），提交校验与退出走 SessionSidebar 的 onEdited / onEditEnd。 */
function SessionRowMenu({ onRename }: { onRename: () => void }) {
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
				<MenuItem onSelect={onRename}>重命名</MenuItem>
			</MenuContent>
		</Menu>
	);
}

function Workspace() {
	const client = useKitClient();
	const { agents, loading, error, reload } = useAgentCatalog();
	const [agentSlug, setAgentSlug] = useState<string | null>(() =>
		new URLSearchParams(window.location.search).get("agent"),
	);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [value, setValue] = useState("");
	const { sessions, reload: reloadSessions } = useSessions({ agentSlug: agentSlug ?? undefined });
	const chat = useChat(sessionId);
	const [sendError, setSendError] = useState<string | null>(null);

	const agent = agents.find((a) => a.slug === agentSlug) ?? agents[0] ?? null;
	useEffect(() => {
		if (agents.length === 0) return;
		if (!agentSlug || !agents.some((a) => a.slug === agentSlug)) setAgentSlug(agents[0]?.slug ?? null);
	}, [agents, agentSlug]);

	const send = useCallback(
		async (text: string) => {
			setSendError(null);
			try {
				let id = sessionId;
				if (!id && agent) {
					const title = deriveTitle(text);
					id = (await client.createSession({ agentSlug: agent.slug, ...(title ? { title } : {}) })).session_id;
					setSessionId(id);
					reloadSessions();
				}
				if (!id) return false;
				await chat.send(text, { sessionId: id });
				reloadSessions();
				return true;
			} catch (e) {
				setSendError(e instanceof Error ? e.message : String(e));
				return false;
			}
		},
		[sessionId, agent, client, chat, reloadSessions],
	);

	const downloadArtifact = useCallback(
		async (fileId: string) => {
			try {
				const res = await client.downloadFile(fileId, { sessionId: sessionId ?? undefined });
				const blob = await res.blob();
				const filename = (res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? fileId) as string;
				await saveFileWithHost({ filename, blob });
			} catch (error) {
				setSendError(error instanceof Error ? error.message : "文件下载失败，请重试");
			}
		},
		[client, sessionId],
	);

	// 受控行内重命名：editing 按「行 id + 来源分区」收窄，同一会话在分组与最近都会渲染，
	// 提交/退出经 onEdited / onEditEnd 回到这里。
	const [editing, setEditing] = useState<{ id: string; section: SessionSidebarSection } | null>(null);
	// 受控搜索框：模板没有后端检索页，非空时元素退化为过滤已加载行。
	const [searchInput, setSearchInput] = useState("");
	const endEditing = useCallback((id: string) => setEditing((current) => (current?.id === id ? null : current)), []);
	const renameSession = useCallback(
		(id: string, title: string) => {
			client
				.renameSession(id, title)
				.then(() => reloadSessions())
				.catch((e) => setSendError(e instanceof Error ? e.message : String(e)));
		},
		[client, reloadSessions],
	);
	// 模板没有独立的历史接口：把当前页会话按 agent 静态分组，展开不触发懒加载。
	const groups = useMemo(() => {
		const bySlug = new Map<string, typeof sessions>();
		for (const session of sessions) {
			const rows = bySlug.get(session.agent_slug) ?? [];
			rows.push(session);
			bySlug.set(session.agent_slug, rows);
		}
		return [...bySlug].map(([slug, rows]) => ({
			id: slug,
			name: agents.find((a) => a.slug === slug)?.display_name ?? slug,
			sessions: rows,
			initialized: true,
		}));
	}, [sessions, agents]);

	if (loading) return <EmptyState title="加载中…" />;
	if (error)
		return (
			<div className="p-6">
				<ErrorState message={error} onRetry={reload} />
			</div>
		);
	if (!agent) return <EmptyState title="还没有上架的 Agent" hint="在管理端完成 publish 与上架后重试。" />;

	return (
		<div className="flex h-full">
			<aside className="flex min-h-0 w-60 shrink-0 flex-col border-r border-[var(--kit-border-subtle)] bg-[var(--kit-bg-subtle)]">
				<div className="shrink-0 px-3 pb-1 pt-3">
					<button
						type="button"
						onClick={() => setSessionId(null)}
						className="flex w-full cursor-pointer items-center justify-center rounded-[var(--kit-radius-sm)] border border-dashed border-[var(--kit-border)] py-2 text-[length:var(--kit-text-label)] text-[var(--kit-fg-muted)] transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:border-[var(--kit-border-strong)] hover:text-[var(--kit-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]"
					>
						新会话
					</button>
				</div>
				<SessionSidebar
					groups={groups}
					recent={{ sessions, initialized: true }}
					activeId={sessionId}
					onSelect={(session) => setSessionId(session.session_id)}
					menu={(session, section) => (
						<SessionRowMenu onRename={() => setEditing({ id: session.session_id, section })} />
					)}
					editing={editing}
					onEdited={renameSession}
					onEditEnd={endEditing}
					searchInput={searchInput}
					onSearchInput={setSearchInput}
				/>
			</aside>
			<main className="flex min-w-0 flex-1 flex-col">
				<AgentHeader agent={agent} onNewSession={() => setSessionId(null)} />
				{sendError ? (
					<div className="p-4">
						<ErrorState message={sendError} />
					</div>
				) : null}
				<Chat
					scrollKey={sessionId}
					messages={chat.messages}
					multiAgent={chat.multiAgent}
					turnRunning={chat.turnRunning}
					onStop={chat.stop}
					approvals={
						chat.approvals.length > 0 ? (
							<ToolApprovalGroup
								approvals={chat.approvals}
								onDecision={chat.submitApproval}
								onRefresh={chat.refreshApprovals}
								onStop={() => void chat.stop()}
							/>
						) : null
					}
					onArtifactDownload={(id) => void downloadArtifact(id)}
					sender={
						<Suggestion
							items={[...new Set(agent.suggested_prompts)].map((prompt) => ({ label: prompt, value: prompt }))}
							block
							onSelect={setValue}
						>
							{({ onTrigger, onKeyDown, inputProps }) => (
								<Sender
									value={value}
									onChange={(next) => {
										setValue(next);
										onTrigger(next === "/" ? undefined : false);
									}}
									onKeyDown={onKeyDown}
									inputProps={inputProps}
									loading={chat.turnRunning}
									submitDisabled={sessionId !== null && !chat.canSend}
									onSubmit={(text) => {
										void send(text.trim()).then((sent) => {
											if (sent) setValue((current) => (current === text ? "" : current));
										});
									}}
									onCancel={() => void chat.stop()}
								/>
							)}
						</Suggestion>
					}
					empty={
						<div className="flex flex-1 flex-col items-center justify-center gap-5 p-6">
							<EmptyState title={agent.opening_remarks ?? `和 ${agent.display_name} 聊聊`} hint="选择示例或直接输入" />
							<Prompts
								wrap
								items={[...new Set(agent.suggested_prompts)].map((prompt) => ({ key: prompt, label: prompt }))}
								onItemClick={({ data }) => void send(data.key)}
								classNames={{ list: "justify-center" }}
							/>
						</div>
					}
				/>
				<div className="border-t border-[var(--kit-border)] px-4 py-1.5">
					<StatusIndicator
						connected={chat.connected}
						turnRunning={chat.turnRunning}
						phase={chat.phase}
						connection={chat.connection}
						error={chat.streamError}
					/>
				</div>
			</main>
		</div>
	);
}

export function App({ controller }: { controller: MemberAuthController }) {
	useEffect(() => {
		if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) document.documentElement.dataset.kitTheme = "dark";
	}, []);
	return (
		<MemberAuthGate controller={controller}>
			{(account) => (
				<div className="flex h-full flex-col">
					<header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--kit-border)] bg-[var(--kit-bg)] px-3 py-2">
						<span className="text-sm font-semibold">OpenAgentPack Kit</span>
						<MemberAccount {...account} />
					</header>
					<div className="min-h-0 flex-1">
						<Workspace />
					</div>
				</div>
			)}
		</MemberAuthGate>
	);
}
