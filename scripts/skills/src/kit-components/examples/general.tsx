import {
	AgentHeader,
	Chat,
	ConfirmDialog,
	EmptyState,
	ErrorState,
	Layout,
	Menu,
	MenuContent,
	MenuItem,
	MenuTrigger,
	MessageAnchorRail,
	MessageListSkeleton,
	SessionList,
	SessionSidebar,
	StatusIndicator,
	SubAgentPanel,
	ThreadPanel,
	Tooltip,
} from "@openagentpack/kit-chat-ui";
import type { ChatMultiAgent } from "@openagentpack/kit-sdk/chat";
import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import type { AgentSummary, SessionSummary } from "@openagentpack/kit-sdk/protocol";
import { useState } from "react";

export interface GeneralComponentsProps {
	agent: AgentSummary;
	agents?: AgentSummary[];
	onPickAgent?: (slug: string) => void;
	sessions: SessionSummary[];
	sessionId: string | null;
	messages: ChatMessage[];
	multiAgent?: ChatMultiAgent;
	connected: boolean;
	turnRunning: boolean;
	canSend: boolean;
	onSelect: (sessionId: string) => void;
	onCreate: () => void;
	onSend: (text: string) => Promise<void>;
	onStop: () => Promise<void>;
	onDownload: (fileId: string) => void;
	onCopy: (text: string) => Promise<void>;
	onRetry: () => void;
}

export function GeneralComponents(props: GeneralComponentsProps) {
	const [searchInput, setSearchInput] = useState("");
	return (
		<div className="h-dvh" data-kit-appearance="workspace">
			<Layout
				sidebarLabel="Navigation"
				header={(menuToggle) => (
					<AgentHeader
						compact
						leading={menuToggle}
						agent={props.agent}
						agents={props.agents}
						onPickAgent={props.onPickAgent}
						actions={<StatusIndicator variant="badge" connected={props.connected} turnRunning={props.turnRunning} />}
					/>
				)}
				sidebar={({ closeSidebar, closeButton }) => (
					<aside className="flex min-h-0 w-64 shrink-0 flex-col border-r border-[var(--kit-border-subtle)] bg-[var(--kit-bg-subtle)]">
						<div className="flex min-h-16 shrink-0 items-center gap-3 px-5 py-3">
							<span className="min-w-0 flex-1 truncate font-semibold">Workspace</span>
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
							groups={[
								{ id: props.agent.slug, name: props.agent.display_name, sessions: props.sessions, initialized: true },
							]}
							recent={{ sessions: props.sessions, initialized: true }}
							activeId={props.sessionId}
							searchInput={searchInput}
							onSearchInput={setSearchInput}
							onSelect={(session) => {
								closeSidebar();
								props.onSelect(session.session_id);
							}}
						/>
					</aside>
				)}
			>
				<Chat
					variant="workspace"
					messages={props.messages}
					multiAgent={props.multiAgent}
					scrollKey={props.sessionId}
					canSend={props.canSend}
					turnRunning={props.turnRunning}
					onSend={props.onSend}
					onStop={props.onStop}
					onArtifactDownload={props.onDownload}
					onCopy={props.onCopy}
					empty={<EmptyState title="Start a conversation" hint="Send your first message." />}
				/>
			</Layout>
		</div>
	);
}

// Compatibility view for already projected messages. Use Chat.multiAgent for
// thread discovery, history, pagination, and main/child Agent navigation.
export function LegacyThreadMessages({ threads }: { threads: Record<string, ChatMessage[]> }) {
	return <ThreadPanel threads={threads} />;
}

// Standalone anchor rail with caller-owned state. MessageList.anchorRail already
// derives turns, syncs the active tick on scroll, and jumps within its own container.
export function ConversationAnchors() {
	const [active, setActive] = useState(0);
	return (
		<div className="relative h-72">
			<MessageAnchorRail
				items={[
					{ label: "Summarize the report", summary: "Key findings: latency dropped 40% after batching." },
					{ label: "Translate the conclusions", summary: "Ran 2 tool calls." },
					{ label: "Draft the outline", summary: "Sections: background, rollout, open questions." },
				]}
				activeIndex={active}
				onSelect={setActive}
			/>
		</div>
	);
}

// Session-loading skeleton: render in MessageList.empty while a switched
// session has no messages yet and the stream is not connected.
export function SessionLoadingSkeleton() {
	return (
		<div className="mx-auto w-full max-w-[var(--kit-chat-width)] p-4">
			<MessageListSkeleton />
		</div>
	);
}

// Truncation-gated tooltip: the bubble appears only when the text is actually clipped.
export function OverflowTooltip() {
	return (
		<p className="w-64">
			<Tooltip
				className="block truncate"
				content="Full session title that is far longer than the row width"
				overflowOnly
			>
				Long session title that is far longer than the row width
			</Tooltip>
		</p>
	);
}

// SessionList also works in a caller-owned mobile drawer or details panel.
export function SessionNavigation(props: Pick<GeneralComponentsProps, "sessions" | "sessionId" | "onSelect">) {
	return (
		<SessionList
			variant="workspace"
			sessions={props.sessions}
			activeId={props.sessionId}
			onSelect={(session) => props.onSelect(session.session_id)}
		/>
	);
}

export function ConnectionFailure({ onRetry }: Pick<GeneralComponentsProps, "onRetry">) {
	return <ErrorState message="Connection failed. Your draft is preserved." onRetry={onRetry} />;
}

// Attachment entry as a command menu: each item feeds its own accept filter to the caller's picker.
export function AttachmentMenu({ onPick }: { onPick: (accept?: string) => void }) {
	return (
		<Menu>
			<MenuTrigger asChild>
				<button type="button">Add attachment</button>
			</MenuTrigger>
			<MenuContent>
				<MenuItem onSelect={() => onPick("image/*")}>Upload image</MenuItem>
				<MenuItem onSelect={() => onPick("video/*")}>Upload video</MenuItem>
				<MenuItem onSelect={() => onPick()}>Upload file</MenuItem>
			</MenuContent>
		</Menu>
	);
}

// Local preview only. A production deletion must first retrieve the real plan
// and keep its matching confirmation token; this dialog does neither.
export function ConfirmationPreview() {
	const [open, setOpen] = useState(false);
	const [resets, setResets] = useState(0);
	return (
		<div>
			<button type="button" onClick={() => setOpen(true)}>
				Reset preview
			</button>
			<p role="status">Preview resets: {resets}</p>
			{open ? (
				<ConfirmDialog
					title="Reset this preview?"
					body="This will clear only the local preview state. No backend operation will run."
					confirmLabel="Reset preview"
					cancelLabel="Keep preview"
					danger={false}
					onCancel={() => setOpen(false)}
					onConfirm={() => {
						setResets((value) => value + 1);
						setOpen(false);
					}}
				/>
			) : null}
		</div>
	);
}

// Aside resources section: dedupes sub-agents by display name; a task row opens
// a dialog with that dispatch's own event timeline (independent of main-stream pagination).
function panelThread(overrides: Partial<ChatMultiAgent["threads"][number]>): ChatMultiAgent["threads"][number] {
	return {
		id: "sthr_preview",
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

export function SubAgentPanelPreview() {
	const multiAgent: ChatMultiAgent = {
		selectedThreadId: null,
		threads: [
			panelThread({
				id: "sthr_slide",
				name: "slide-maker",
				status: "running",
				task: "Draft a 12-page deck from the approved outline",
				messages: [
					{
						id: "m1",
						role: "assistant",
						status: "done",
						parts: [
							{
								type: "reasoning",
								text: "Outline the deck first, then fill each page.",
								status: "done",
								startedAt: "2026-11-03T00:00:01Z",
							},
							{ type: "text", text: "Pages 1-3 are ready." },
						],
					},
				],
			}),
			panelThread({
				id: "sthr_price",
				task: "Compare domestic API pricing and quotas",
				createdAt: "2026-11-03T00:00:00Z",
				endedAt: "2026-11-03T00:00:48Z",
			}),
		],
		loading: false,
		error: null,
		selectThread: () => undefined,
		refreshThreads: async () => undefined,
		loadThreadEvents: async () => undefined,
	};
	return <SubAgentPanel multiAgent={multiAgent} />;
}
