# Compiled examples

Generated from the adjacent source files. Adapt the callbacks and runtime configuration to your application.

## agent-icon.tsx

[Source](../examples/agent-icon.tsx)

```tsx
import { isIconImageSource } from "@openagentpack/kit-chat-ui";

// Keep the shared image-or-text rule when the application owns the icon layout.
export function AgentIcon({ icon }: { icon?: string }) {
	return <span aria-hidden>{isIconImageSource(icon) ? <img src={icon} alt="" /> : (icon ?? "🤖")}</span>;
}
```

## approval-card.tsx

[Source](../examples/approval-card.tsx)

```tsx
import { ToolApprovalCard } from "@openagentpack/kit-chat-ui";
import type { ChatToolApproval } from "@openagentpack/kit-sdk/chat";
import type { ToolApprovalDecision } from "@openagentpack/kit-sdk/protocol";

export interface ApprovalCardProps {
	approval: ChatToolApproval;
	submitApproval: (decision: ToolApprovalDecision) => Promise<void>;
	refreshApprovals: () => Promise<void>;
	stop: () => void;
}

// Single pending approval rendered directly. Allow and deny are one-click
// submissions; no confirmation dialog. Prefer ToolApprovalGroup when multiple approvals exist.
export function ApprovalCard({ approval, submitApproval, refreshApprovals, stop }: ApprovalCardProps) {
	return (
		<ToolApprovalCard approval={approval} onDecision={submitApproval} onRefresh={refreshApprovals} onStop={stop} />
	);
}
```

## approvals.tsx

[Source](../examples/approvals.tsx)

```tsx
import { ToolApprovalGroup } from "@openagentpack/kit-chat-ui";
import type { ChatToolApproval } from "@openagentpack/kit-sdk/chat";
import type { ToolApprovalDecision } from "@openagentpack/kit-sdk/protocol";

export interface ApprovalListProps {
	approvals: ChatToolApproval[];
	submitApproval: (decision: ToolApprovalDecision) => Promise<void>;
	refreshApprovals: () => Promise<void>;
	stop: () => void;
}

// Pass useChat's approvals, submitApproval, refreshApprovals, and stop.
// Allow and deny are one-click submissions. Multiple pending approvals page
// horizontally, one card at a time. The backend confirms validity.
export function ApprovalList({ approvals, submitApproval, refreshApprovals, stop }: ApprovalListProps) {
	if (approvals.length === 0) return null;
	return (
		<ToolApprovalGroup approvals={approvals} onDecision={submitApproval} onRefresh={refreshApprovals} onStop={stop} />
	);
}
```

## attachment-sender.tsx

[Source](../examples/attachment-sender.tsx)

```tsx
import {
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
					sender.current?.replaceRange(context.start, end, `/${item.value} `);
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
}
```

## chat-runtime.tsx

[Source](../examples/chat-runtime.tsx)

```tsx
import { Chat, type SenderSkill, ToolApprovalCard } from "@openagentpack/kit-chat-ui";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";
import { useState } from "react";

// Render below a configured KitProvider, inside a bounded Layout content area.
// The same component works with useChat({ sessionId, provider }) for a custom backend.
export function SessionChat({ sessionId, skills }: { sessionId: string | null; skills?: SenderSkill[] }) {
	const chat = useChat(sessionId);
	const [error, setError] = useState<string | null>(null);
	const report = (cause: unknown) => setError(cause instanceof Error ? cause.message : "The request failed.");

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-kit-appearance="workspace">
			{error || chat.streamError ? <p role="alert">{error ?? chat.streamError?.message}</p> : null}
			<Chat
				variant="workspace"
				messages={chat.messages}
				skills={skills}
				multiAgent={chat.multiAgent}
				scrollKey={sessionId}
				turnRunning={chat.turnRunning}
				canSend={chat.canSend}
				onSend={async (text, selectedSkills) => {
					setError(null);
					try {
						await chat.send(text, { skills: selectedSkills });
					} catch (cause) {
						report(cause);
						throw cause; // Preserve Chat's draft when sending fails.
					}
				}}
				onStop={() => chat.stop().catch(report)}
				approvals={
					chat.approvals.length > 0
						? chat.approvals.map((approval) => (
								<ToolApprovalCard
									key={JSON.stringify([approval.batch_id, approval.call_id])}
									approval={approval}
									onDecision={chat.submitApproval}
									onRefresh={chat.refreshApprovals}
									onStop={() => void chat.stop().catch(report)}
								/>
							))
						: null
				}
			/>
		</div>
	);
}
```

## content.tsx

[Source](../examples/content.tsx)

```tsx
import {
	Actions,
	ActionsCopy,
	ActionsFeedback,
	type ActionsFeedbackValue,
	ArtifactCard,
	AttachmentFileCard,
	type AttachmentItem,
	Attachments,
	CodeHighlighter,
	FileCard,
	Markdown,
	Mermaid,
	Message,
	MessageList,
	ReasoningBlock,
	SenderHeader,
	ToolCallCard,
} from "@openagentpack/kit-chat-ui";
import type { ChatMessage, MessagePart } from "@openagentpack/kit-sdk/messages";
import { useState } from "react";

export interface ContentExamplesProps {
	messages: ChatMessage[];
	tool: Extract<MessagePart, { type: "tool" }>;
	attachment: AttachmentItem;
	onDownload: (fileId: string) => void;
	onCopy: (text: string) => Promise<void>;
}

// Render the message list inside a host with a bounded height.
export function ContentExamples({ messages, tool, attachment, onDownload, onCopy }: ContentExamplesProps) {
	const [feedback, setFeedback] = useState<ActionsFeedbackValue>("default");
	const message = messages[0];
	return (
		<div className="flex flex-col gap-3" data-kit-appearance="workspace">
			{message ? (
				<Message variant="workspace" message={message} onArtifactDownload={onDownload} onCopy={onCopy} />
			) : null}
			<div className="flex h-full min-h-0 flex-col">
				<MessageList
					variant="workspace"
					messages={messages}
					autoScroll={false}
					onArtifactDownload={onDownload}
					onCopy={onCopy}
					empty={<p>No messages yet.</p>}
				/>
			</div>
			<ReasoningBlock text="Compare the available evidence before answering." status="done" />
			<ToolCallCard part={tool} />
			<ArtifactCard
				filename="report.pdf"
				contentType="application/pdf"
				onDownload={() => onDownload("output-report")}
			/>
			<FileCard name="notes.txt" onDownload={() => onDownload("notes")} />
			<Markdown>
				{
					"## Result\n\nA **sanitized** Markdown response with a table:\n\n| Item | Status |\n| --- | --- |\n| Report | Ready |"
				}
			</Markdown>
			<CodeHighlighter lang="typescript" header="Example code" showLineNumbers>
				{'const status: string = "ready";'}
			</CodeHighlighter>
			<Mermaid header="Request flow" defaultRenderType="image">
				{"flowchart LR\n  User --> Backend\n  Backend --> Agent"}
			</Mermaid>
			<Actions
				aria-label="Response actions"
				items={[{ key: "download", label: "Download report", onItemClick: () => onDownload("output-report") }]}
			>
				<Actions.Copy text="The report is ready." onCopy={onCopy} label="Copy answer" />
				<Actions.Feedback value={feedback} onChange={setFeedback} />
			</Actions>
			{/* Equivalent named exports are supported for selective imports. */}
			<ActionsCopy text="A second excerpt." onCopy={onCopy} label="Copy excerpt" />
			<ActionsFeedback value={feedback} onChange={setFeedback} />
			<SenderHeader title="Prepared files" open closable={false}>
				<Attachments.FileCard item={attachment} />
				<AttachmentFileCard item={attachment} />
			</SenderHeader>
			<p role="status">Local feedback: {feedback}. Persistence belongs to the caller.</p>
		</div>
	);
}
```

## discovery-usage.tsx

[Source](../examples/discovery-usage.tsx)

```tsx
import { ActivityHeatmap, CategoryTabs, MeterBar, PlazaCard, type PlazaTabId } from "@openagentpack/kit-chat-ui";
import type { PlazaCategory, PlazaEntry } from "@openagentpack/kit-sdk/protocol";

export interface DiscoveryUsageProps {
	entries: PlazaEntry[];
	categories: { id: PlazaCategory; name: string; count: number }[];
	active: PlazaTabId;
	onCategoryChange: (next: PlazaTabId) => void;
	onOpen: (slug: string) => void;
	used: number;
	limit: number;
	unlimited: boolean;
	days: { day: string; turns: number }[];
}

// The caller obtains data from hooks and owns filtering, navigation, and quota policy.
export function DiscoveryUsage(props: DiscoveryUsageProps) {
	return (
		<section>
			<CategoryTabs categories={props.categories} active={props.active} onChange={props.onCategoryChange} />
			<div className="grid gap-4">
				{props.entries.map((entry) => (
					<PlazaCard key={entry.slug} entry={entry} onOpen={props.onOpen} />
				))}
			</div>
			<h2>Monthly usage</h2>
			<MeterBar value={props.used} max={props.limit} unlimited={props.unlimited} />
			<ActivityHeatmap days={props.days} />
		</section>
	);
}
```

## general.tsx

[Source](../examples/general.tsx)

```tsx
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
```

## layout.tsx

[Source](../examples/layout.tsx)

```tsx
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
```

## prompts-suggestion.tsx

[Source](../examples/prompts-suggestion.tsx)

```tsx
import {
	Prompts,
	Sender,
	type SenderRef,
	type SenderSelection,
	SkillGlyph,
	Suggestion,
} from "@openagentpack/kit-chat-ui";
import { useRef, useState } from "react";

const promptText: Record<string, string> = {
	summary: "Summarize the current report.",
	compare: "Compare these two alternatives.",
};

export function PromptComposer({ onSend, canSend }: { onSend: (text: string) => Promise<void>; canSend: boolean }) {
	const [draft, setDraft] = useState("");
	const [selection, setSelection] = useState<SenderSelection>({ start: 0, end: 0 });
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const sender = useRef<SenderRef>(null);
	const sending = useRef(false);

	const send = async (text: string) => {
		if (!canSend || sending.current || !text.trim()) return;
		sending.current = true;
		setSubmitting(true);
		setError(null);
		try {
			await onSend(text);
			setDraft((current) => (current === text ? "" : current));
		} catch {
			setError("Send failed. Your draft is preserved.");
		} finally {
			sending.current = false;
			setSubmitting(false);
		}
	};

	return (
		<div className="flex flex-col gap-3" data-kit-appearance="workspace">
			<Prompts
				title="Try a question"
				wrap
				items={[
					{ key: "summary", label: "Summarize", description: "Extract the main points." },
					{ key: "compare", label: "Compare", description: "Review two alternatives." },
				]}
				onItemClick={({ data }) => {
					setDraft(promptText[data.key] ?? "");
					sender.current?.focus();
				}}
			/>
			<Suggestion
				block
				items={[
					{ value: "summary", label: "Summarize the report", icon: <SkillGlyph className="size-4" /> },
					{ value: "compare", label: "Compare alternatives", icon: <SkillGlyph className="size-4" /> },
				]}
				value={draft}
				caret={selection.end}
				trigger="/"
				onSelect={(_, item, context) => {
					if (!context) return;
					sender.current?.replaceRange(context.start, context.end, promptText[item.value] ?? "");
					sender.current?.focus();
				}}
			>
				{({ onKeyDown, inputProps }) => (
					<Sender
						variant="workspace"
						ref={sender}
						value={draft}
						placeholder="Type / to choose a command"
						onChange={setDraft}
						onSelectionChange={setSelection}
						onKeyDown={onKeyDown}
						inputProps={inputProps}
						submitDisabled={!canSend || submitting}
						onSubmit={(text) => void send(text)}
						suffix={(_origin, { components }) => <components.SendButton>Send</components.SendButton>}
					/>
				)}
			</Suggestion>
			{error ? <p role="alert">{error}</p> : null}
		</div>
	);
}
```

## reasoning.tsx

[Source](../examples/reasoning.tsx)

```tsx
import { ReasoningBlock } from "@openagentpack/kit-chat-ui";
import { useState } from "react";

// Real chat messages supply each reasoning part's status through the Provider.
// These controls demonstrate one stable component across lifecycle transitions.
export function ReasoningLifecycle() {
	const [status, setStatus] = useState<"streaming" | "done" | "failed" | "interrupted">("done");
	return (
		<div className="flex flex-col gap-3" data-kit-appearance="workspace">
			<fieldset className="flex flex-wrap gap-3">
				<legend className="sr-only">Reasoning lifecycle controls</legend>
				<button type="button" onClick={() => setStatus("streaming")}>
					Start reasoning
				</button>
				<button type="button" onClick={() => setStatus("done")}>
					Complete
				</button>
				<button type="button" onClick={() => setStatus("interrupted")}>
					Interrupt
				</button>
				<button type="button" onClick={() => setStatus("failed")}>
					Fail
				</button>
			</fieldset>
			<ReasoningBlock text="Compare the evidence before answering." status={status} />
		</div>
	);
}
```
