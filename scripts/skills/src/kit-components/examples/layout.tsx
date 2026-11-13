import { AgentHeader, Layout, SessionSidebar } from "@openagentpack/kit-chat-ui";
import type { AgentSummary, SessionSummary } from "@openagentpack/kit-sdk/protocol";
import { type ReactNode, useState } from "react";

export interface WorkspaceLayoutProps {
	agent: AgentSummary | null;
	sessions: SessionSummary[];
	sessionId: string | null;
	onSelect: (sessionId: string) => void;
	onCreate: () => void;
	onOpenUsage: () => void;
	account?: ReactNode;
	dialogs?: ReactNode;
	children: ReactNode;
}

// Routing, identity, session state, and confirmation plans belong to the caller.
// The rail (brand, new-chat, directory, navigation, account) is caller-owned;
// SessionSidebar only renders the session directory area.
export function WorkspaceLayout(props: WorkspaceLayoutProps) {
	const [searchInput, setSearchInput] = useState("");
	return (
		<div className="h-dvh" data-kit-appearance="workspace">
			<Layout
				mobileTitle="Workspace"
				sidebarLabel="Navigation"
				header={(menuToggle) => <AgentHeader compact agent={props.agent} leading={menuToggle} actions={null} />}
				sidebar={({ closeSidebar, closeButton }) => (
					<aside className="flex min-h-0 w-64 shrink-0 flex-col border-r border-[var(--kit-border-subtle)] bg-[var(--kit-bg-subtle)]">
						<div className="flex min-h-16 shrink-0 items-center gap-3 px-5 py-3">
							<span className="min-w-0 flex-1 truncate font-semibold">Managed Agent</span>
							{closeButton}
						</div>
						<button
							type="button"
							onClick={() => {
								closeSidebar();
								props.onCreate();
							}}
							className="mx-3 mb-1 min-h-10 shrink-0 rounded-[var(--kit-radius-sm)] border border-dashed border-[var(--kit-border)] px-3 text-sm text-[var(--kit-fg-muted)] transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:border-[var(--kit-border)] hover:text-[var(--kit-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]"
						>
							New chat
						</button>
						<SessionSidebar
							groups={
								props.agent
									? [
											{
												id: props.agent.slug,
												name: props.agent.display_name,
												sessions: props.sessions,
												initialized: true,
											},
										]
									: []
							}
							recent={{ sessions: props.sessions, initialized: true }}
							activeId={props.sessionId}
							searchInput={searchInput}
							onSearchInput={setSearchInput}
							onSelect={(session) => {
								closeSidebar();
								props.onSelect(session.session_id);
							}}
						/>
						<nav aria-label="Workspace navigation" className="shrink-0 px-3 py-1">
							<button
								type="button"
								onClick={() => {
									closeSidebar();
									props.onOpenUsage();
								}}
								className="min-h-10 w-full rounded-[var(--kit-radius-sm)] px-3 py-2 text-left hover:bg-[var(--kit-surface)] focus-visible:outline-2 focus-visible:outline-[var(--kit-focus)]"
							>
								My usage
							</button>
						</nav>
						{props.account}
					</aside>
				)}
				dialogs={props.dialogs}
			>
				{props.children}
			</Layout>
		</div>
	);
}
