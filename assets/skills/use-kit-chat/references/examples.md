# Compiled examples

Generated from the adjacent source files. Adapt the callbacks and runtime configuration to your application.

## approval-list.tsx

[Source](../examples/approval-list.tsx)

```tsx
import { ToolApprovalCard } from "@openagentpack/kit-chat-ui";
import type { UseChatResult } from "@openagentpack/kit-sdk/chat/hooks";

export function ApprovalList({ chat }: { chat: UseChatResult }) {
	return (
		<section aria-label="Tool approvals">
			{chat.approvals.map((approval) => (
				<ToolApprovalCard
					key={JSON.stringify([approval.batch_id, approval.call_id])}
					approval={approval}
					onDecision={chat.submitApproval}
					onRefresh={chat.refreshApprovals}
				/>
			))}
		</section>
	);
}
```

## call-state.ts

[Source](../examples/call-state.ts)

```ts
import { createMutation, createObservable, createQuery, type QuerySnapshot } from "@openagentpack/kit-sdk/state";

interface ResourceView<T> {
	query: QuerySnapshot<T>;
	mutation: { pending: boolean; error: string | null };
	editing: boolean;
}

/** Backend calls are supplied by the host; the SDK only owns observable call state. */
export function bindResource<T, Input>(
	read: (signal: AbortSignal) => Promise<T>,
	write: (input: Input) => Promise<void>,
	render: (view: ResourceView<T>) => void,
) {
	const query = createQuery(read);
	const mutation = createMutation(write);
	const editing = createObservable(false);
	const publish = () =>
		render({ query: query.getSnapshot(), mutation: mutation.getSnapshot(), editing: editing.getSnapshot() });
	const subscriptions = [query.subscribe(publish), mutation.subscribe(publish), editing.subscribe(publish)];
	publish();
	void query.refresh();
	return {
		refresh: query.refresh,
		// Call after explicit user action; errors reject and are never automatically retried.
		save: mutation.run,
		setEditing: editing.set,
		dispose() {
			for (const unsubscribe of subscriptions) unsubscribe();
			query.dispose();
			mutation.dispose();
		},
	};
}
```

## controller.ts

[Source](../examples/controller.ts)

```ts
import {
	createChatController,
	createSessionStore,
	type SessionSnapshot,
	type SessionStoreOptions,
} from "@openagentpack/kit-sdk/chat";
import type { ChatProvider } from "@openagentpack/kit-sdk/providers";

// This owner is independent of React and must be disposed by its host.
export function observeSession(
	provider: ChatProvider,
	sessionId: string,
	onChange: (snapshot: SessionSnapshot) => void,
) {
	const controller = createChatController(provider, sessionId);
	const unsubscribe = controller.subscribe(() => onChange(controller.getSnapshot()));
	const dispose = () => {
		unsubscribe();
		controller.dispose();
	};
	const ready = controller.connect().catch((error) => {
		dispose();
		throw error;
	});
	return { controller, ready, dispose };
}

// Lower-level alternative: this host must feed SDK SessionEvent snapshots through
// applyEvent and manage lifecycle itself. Ordinary chat integrations use the owner above.
export function createLocalStore(sessionId: string, provider: ChatProvider) {
	const options: SessionStoreOptions = { transformMessage: provider.transformMessage?.bind(provider) };
	return createSessionStore(sessionId, options);
}
```

## custom-chat.tsx

[Source](../examples/custom-chat.tsx)

```tsx
import { Chat, Sender } from "@openagentpack/kit-chat-ui";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";
import { KitError } from "@openagentpack/kit-sdk/protocol";
import type { ChatProvider } from "@openagentpack/kit-sdk/providers";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ApprovalList } from "./approval-list.tsx";

// Both inputs are stable application-owned functions/objects.
// createSession calls the application's backend and returns its real Session ID.
export function CustomChat({
	provider,
	createSession,
}: {
	provider: ChatProvider;
	createSession: () => Promise<string>;
}) {
	const binding = useMemo(() => ({ provider, createSession }), [provider, createSession]);
	const [selection, setSelection] = useState<{ binding: typeof binding; id: string } | null>(null);
	const sessionId = selection?.binding === binding ? selection.id : null;
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const sending = useRef<object | null>(null);
	const chat = useChat({ sessionId, provider });
	const active = useRef<typeof binding | null>(binding);
	useLayoutEffect(() => {
		active.current = binding;
		sending.current = null;
		setBusy(false);
		setError(null);
		return () => {
			active.current = null;
		};
	}, [binding]);
	const report = (cause: unknown) => {
		if (active.current === binding)
			setError(cause instanceof KitError ? cause.message : "The request failed. Your draft was kept.");
	};
	const finish = (operation: object) => {
		// An old request must not unlock a newer backend's pending request.
		if (sending.current !== operation) return;
		sending.current = null;
		if (active.current === binding) setBusy(false);
	};

	async function send(text: string) {
		if (!text.trim() || sending.current || (sessionId !== null && !chat.canSend)) return;
		const operation = {};
		sending.current = operation;
		setBusy(true);
		setError(null);
		try {
			const target = sessionId ?? (await createSession());
			if (active.current !== binding) return;
			setSelection({ binding, id: target });
			// React may not have committed the new selection yet.
			await chat.send(text.trim(), { sessionId: target });
			if (active.current === binding) setDraft((current) => (current === text ? "" : current));
		} catch (cause) {
			report(cause);
		} finally {
			finish(operation);
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col" data-kit-appearance="workspace">
			{(error || chat.streamError) && <p role="alert">{error ?? chat.streamError?.message}</p>}
			<Chat
				variant="workspace"
				messages={chat.messages}
				multiAgent={chat.multiAgent}
				scrollKey={sessionId}
				turnRunning={chat.turnRunning}
				approvals={chat.approvals.length > 0 ? <ApprovalList chat={chat} /> : null}
				onStop={() => chat.stop().catch(report)}
				sender={
					<Sender
						variant="workspace"
						value={draft}
						onChange={setDraft}
						loading={chat.turnRunning}
						submitDisabled={busy || (sessionId !== null && !chat.canSend)}
						onSubmit={(text) => void send(text)}
						onCancel={() => void chat.stop().catch(report)}
						placeholder={sessionId ? "Send a message" : "Write the first message to create a session"}
					/>
				}
			/>
		</div>
	);
}
```

## default-chat.tsx

[Source](../examples/default-chat.tsx)

```tsx
import { Chat, Sender } from "@openagentpack/kit-chat-ui";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";
import { KitError } from "@openagentpack/kit-sdk/protocol";
import { createKitClient, type KitClient } from "@openagentpack/kit-sdk/providers/kit";
import { KitProvider } from "@openagentpack/kit-sdk/providers/kit/react";
import { useRef, useState } from "react";
import { ApprovalList } from "./approval-list.tsx";

// Initialize once. apiBaseUrl comes from runtime configuration, not location.origin.
// getAppToken supplies application identity, never a Bailian API key.
export function createDefaultClient(apiBaseUrl: string, getAppToken: () => Promise<string>) {
	return createKitClient({
		baseUrl: apiBaseUrl,
		headers: async () => ({ Authorization: `Bearer ${await getAppToken()}` }),
	});
}

export function DefaultChat({ client, sessionId }: { client: KitClient; sessionId: string | null }) {
	return (
		<KitProvider client={client}>
			<ChatPanel key={sessionId ?? "unselected"} sessionId={sessionId} />
		</KitProvider>
	);
}

function ChatPanel({ sessionId }: { sessionId: string | null }) {
	const chat = useChat(sessionId);
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);
	const sending = useRef(false);
	const report = (cause: unknown) => setError(cause instanceof KitError ? cause.message : "The request failed.");

	async function send(text: string) {
		if (!text.trim() || !chat.canSend || sending.current) return;
		sending.current = true;
		setError(null);
		try {
			await chat.send(text.trim());
			setDraft((current) => (current === text ? "" : current));
		} catch (cause) {
			report(cause);
		} finally {
			sending.current = false;
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col" data-kit-appearance="workspace">
			<p role="status">{`${chat.connection} / ${chat.phase}`}</p>
			{(error || chat.streamError) && <p role="alert">{error ?? chat.streamError?.message}</p>}
			<Chat
				variant="workspace"
				messages={chat.messages}
				multiAgent={chat.multiAgent}
				scrollKey={sessionId}
				turnRunning={chat.turnRunning}
				canSend={chat.canSend}
				onStop={() => chat.stop().catch(report)}
				approvals={chat.approvals.length > 0 ? <ApprovalList chat={chat} /> : null}
				sender={
					<Sender
						variant="workspace"
						value={draft}
						onChange={setDraft}
						loading={chat.turnRunning}
						submitDisabled={!chat.canSend}
						onSubmit={(text) => void send(text)}
						onCancel={() => void chat.stop().catch(report)}
						placeholder={sessionId ? "Send a message" : "Select a session to begin"}
					/>
				}
			/>
		</div>
	);
}
```

## discovery-usage.tsx

[Source](../examples/discovery-usage.tsx)

```tsx
import { usePlaza } from "@openagentpack/kit-sdk/agents/hooks";
import { useKitClient } from "@openagentpack/kit-sdk/providers/kit/react";
import { useQuota, useQuotaRequests } from "@openagentpack/kit-sdk/usage/hooks";
import { useState } from "react";

// Mount inside the same KitProvider as the default chat page.
// These hooks use KitClient; an explicit ChatProvider does not redirect them.
export function DiscoveryAndUsage() {
	const client = useKitClient();
	const plaza = usePlaza({ category: "general" });
	const usage = useQuota();
	const history = useQuotaRequests();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function requestCredits() {
		if (pending) return;
		setPending(true);
		setError(null);
		try {
			await client.createQuotaRequest({ requestedCredits: 100, reason: "Additional project work" });
			usage.reload();
			history.reload();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Request failed");
		} finally {
			setPending(false);
		}
	}

	return (
		<section>
			<h2>Available agents</h2>
			{plaza.error ? <p role="alert">{plaza.error}</p> : null}
			<ul>
				{plaza.view?.agents.map((agent) => (
					<li key={agent.slug}>{agent.display_name}</li>
				))}
			</ul>
			<h2>Monthly usage</h2>
			{usage.error ? <p role="alert">{usage.error}</p> : null}
			<p>{usage.quota ? `${usage.quota.used} credits used` : "Loading usage"}</p>
			<button
				type="button"
				disabled={pending || usage.loading || !usage.quota || Boolean(usage.quota.pending_request)}
				onClick={() => void requestCredits()}
			>
				Request 100 credits
			</button>
			{error ? <p role="alert">{error}</p> : null}
			<ul>
				{history.requests.map((request) => (
					<li key={request.id}>{request.status}</li>
				))}
			</ul>
		</section>
	);
}
```

## experience-controller.ts

[Source](../examples/experience-controller.ts)

```ts
import { createComposer, deriveTitle } from "@openagentpack/kit-sdk/chat";
import {
	type ArtifactHost,
	createArtifactActions,
	createAttachments,
	previewableArtifactType,
	resolveArtifactType,
} from "@openagentpack/kit-sdk/files";
import type { MemberUsageLimitView } from "@openagentpack/kit-sdk/protocol";
import type { KitClient } from "@openagentpack/kit-sdk/providers/kit";
import {
	createSessionActions,
	createSessionDetails,
	createSessionDirectory,
	createSessionSearch,
} from "@openagentpack/kit-sdk/sessions";
import { createQuotaRecovery, readQuotaExceeded, usageLimitsAllowSending } from "@openagentpack/kit-sdk/usage";

// Non-React hosts own subscriptions and disposal. Each controller is a separate capability.
export function createExperienceControllers(client: KitClient, host: ArtifactHost) {
	const directory = createSessionDirectory(client);
	const search = createSessionSearch(client);
	const details = createSessionDetails(client, null);
	const actions = createSessionActions(client, () => directory.reload());
	const attachments = createAttachments(client);
	const composer = createComposer(client);
	const artifacts = createArtifactActions(client, host);
	const quota = createQuotaRecovery(client);
	directory.start();
	return {
		directory,
		search,
		details,
		actions,
		attachments,
		composer,
		artifacts,
		quota,
		dispose() {
			for (const controller of [directory, search, details, actions, attachments, composer, artifacts, quota])
				controller.dispose();
		},
	};
}
export function presentationHelpers(error: unknown, limits: MemberUsageLimitView) {
	return {
		title: deriveTitle("First message"),
		quotaError: readQuotaExceeded(error),
		canRecover: usageLimitsAllowSending(limits),
		type: resolveArtifactType(undefined, "report.pdf", "application/octet-stream"),
		canPreview: previewableArtifactType("application/pdf"),
	};
}
```

## experience-data.tsx

[Source](../examples/experience-data.tsx)

```tsx
import { useAgentResources } from "@openagentpack/kit-sdk/agents/hooks";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";
import type { ChatProvider } from "@openagentpack/kit-sdk/providers";
import type { KitClient } from "@openagentpack/kit-sdk/providers/kit";
import { useSessionDetails } from "@openagentpack/kit-sdk/sessions/hooks";
import { useUsageLimits } from "@openagentpack/kit-sdk/usage/hooks";

// Data hooks accept an explicit Client; Context remains an optional compatibility path.
export function AgentResourceSummary({ slug }: { slug: string | null }) {
	const resources = useAgentResources(slug);
	return (
		<div>
			<p>{resources?.skills?.map((skill) => skill.name).join(", ") || "No skill metadata"}</p>
			<p>{resources?.memory_stores?.map((store) => store.name).join(", ") || "No memory stores"}</p>
		</div>
	);
}

export function MemberLimitSummary() {
	const limits = useUsageLimits({ days: 30 });
	if (limits.loading) return <p role="status">Loading usage limits…</p>;
	if (limits.error) return <p role="alert">{String(limits.error)}</p>;
	if (!limits.data) return <p>Not a local Kit member</p>;
	return (
		<button type="button" onClick={() => void limits.reload()}>
			Refresh usage limits
		</button>
	);
}

// File associations belong to application metadata, not SSE message text.
export function ChatWithFileMetadata({
	client,
	sessionId,
	provider,
}: {
	client: KitClient;
	sessionId: string;
	provider: ChatProvider;
}) {
	const chat = useChat({ sessionId, provider });
	const details = useSessionDetails({ client, sessionId, setMessageFiles: chat.setMessageFiles });
	return details.error ? <p role="alert">{details.error}</p> : <p>{chat.messages.length} messages</p>;
}

export async function readUploadStatus(client: KitClient, fileId: string) {
	const status = await client.fileStatus(fileId);
	// Keep the draft until ready; the server enforces readiness and ownership too.
	return { ready: status.available, status: status.status };
}
```

## experience.tsx

[Source](../examples/experience.tsx)

```tsx
import { Attachments, Chat, ConfirmDialog, SessionSidebar } from "@openagentpack/kit-chat-ui";
import { useAgentCatalog, useAgentResources } from "@openagentpack/kit-sdk/agents/hooks";
import { useChat, useComposer } from "@openagentpack/kit-sdk/chat/hooks";
import type { ArtifactHost } from "@openagentpack/kit-sdk/files";
import { useArtifactActions, useAttachments } from "@openagentpack/kit-sdk/files/hooks";
import type { ChatProvider } from "@openagentpack/kit-sdk/providers";
import type { KitClient } from "@openagentpack/kit-sdk/providers/kit";
import { useSessionDetails, useSessionDirectory, useSessionSearch } from "@openagentpack/kit-sdk/sessions/hooks";
import { useQuotaRecovery, useUsageLimits } from "@openagentpack/kit-sdk/usage/hooks";
import { useState } from "react";

// No KitProvider is required. Keep client/provider/host stable outside this component.
export function Experience({
	client,
	provider,
	host,
	agentSlug,
}: {
	client: KitClient;
	provider: ChatProvider;
	host: ArtifactHost;
	agentSlug: string;
}) {
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [keyword, setKeyword] = useState("");
	const chat = useChat({ sessionId, provider });
	const directory = useSessionDirectory({
		client,
		onExecuted: (id) => {
			if (id === sessionId) setSessionId(null);
		},
	});
	const search = useSessionSearch(keyword, { client });
	const details = useSessionDetails({ client, sessionId, setMessageFiles: chat.setMessageFiles });
	const attachments = useAttachments({ client });
	const composer = useComposer({
		client,
		agentSlug,
		sessionId,
		files: attachments.files,
		send: chat.send,
		onSessionCreated: setSessionId,
		onAccepted: attachments.consume,
	});
	const artifacts = useArtifactActions({ client, host, sessionId: sessionId ?? undefined, artifacts: chat.artifacts });
	const recovery = useQuotaRecovery({ client });
	const { agents } = useAgentCatalog({ client });
	const resources = useAgentResources(agentSlug, { client });
	const limits = useUsageLimits({ client });
	const pending = directory.actions.pending;
	return (
		<main>
			<p>
				{agents.length} agents, {resources?.skills?.length ?? 0} skills
			</p>
			<SessionSidebar
				activeId={sessionId}
				groups={directory.groups.map((group) => ({
					...group,
					id: group.slug,
					name: group.slug,
					onLoad: group.load,
					onLoadMore: group.loadMore,
					onRetry: group.retry,
				}))}
				recent={{ ...directory.recent, onLoadMore: directory.recent.loadMore }}
				searchInput={keyword}
				onSearchInput={setKeyword}
				search={keyword ? { ...search, onLoadMore: search.loadMore, onRetry: search.retry } : undefined}
				onSelect={(session) => setSessionId(session.session_id)}
			/>
			{details.error && <p role="alert">{details.error}</p>}
			{client.supports("uploadFile") && client.supports("fileStatus") && (
				<Attachments
					items={attachments.files.map((file) => ({
						uid: file.file_id,
						name: file.filename,
						status: file.available ? "done" : "uploading",
					}))}
					onSelectFiles={(files) => void attachments.upload(files)}
					onRemove={(file) => attachments.remove(file.uid)}
				/>
			)}
			<Chat
				messages={chat.messages}
				canSend={(!sessionId || chat.canSend) && !attachments.processing && !composer.pending}
				onSend={composer.send}
				onStop={chat.stop}
				onArtifactOpen={(id, type) => void artifacts.open(id, type).catch(() => undefined)}
				onArtifactDownload={(id) => void artifacts.download(id).catch(() => undefined)}
			/>
			{composer.error ? <p role="alert">Sending failed; the draft and attachments are retained.</p> : null}
			{limits.error && <p role="alert">{limits.error}</p>}
			<button type="button" disabled={recovery.loading} onClick={() => void recovery.recheck()}>
				Recheck server limits
			</button>
			{sessionId && client.supports("sessionPlan") && client.supports("deleteSession") && (
				<button type="button" onClick={() => void directory.actions.request(sessionId, "delete")}>
					Prepare deletion
				</button>
			)}
			{pending && (
				<ConfirmDialog
					title="Confirm session change"
					busy={directory.actions.busy}
					body={pending.error ?? JSON.stringify(pending.plan?.diff ?? [])}
					onCancel={directory.actions.cancel}
					onConfirm={() => void directory.actions.confirm()}
				/>
			)}
		</main>
	);
}
```

## member-auth.tsx

[Source](../examples/member-auth.tsx)

```tsx
import {
	createMemberAuthController,
	type MemberAuthController,
	type MemberAuthOptions,
} from "@openagentpack/kit-sdk/auth";
import { useMemberAuth } from "@openagentpack/kit-sdk/auth/hooks";
import { KitProvider } from "@openagentpack/kit-sdk/providers/kit/react";
import type { FormEvent, ReactNode } from "react";

// Call once after public config resolves the final API URL. The host's storage
// must be scoped to that full URL, including its path prefix. Store no password.
export function createLogin(options: MemberAuthOptions) {
	return createMemberAuthController(options);
}

export function MemberRoot({ controller, children }: { controller: MemberAuthController; children: ReactNode }) {
	const auth = useMemberAuth(controller);
	if (auth.status === "checking") return <p>Restoring sign-in…</p>;
	if (auth.status === "error") {
		return (
			<section>
				<p role="alert">{auth.error}</p>
				<button type="button" onClick={() => void auth.retry()}>
					Retry
				</button>
			</section>
		);
	}
	if (!auth.client) {
		const submit = async (event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			const form = event.currentTarget;
			const data = new FormData(form);
			try {
				await auth.login({
					username: String(data.get("username") ?? ""),
					password: String(data.get("password") ?? ""),
				});
			} catch {
				// The controller exposes a safe error in its snapshot.
			} finally {
				const password = form.elements.namedItem("password");
				if (password instanceof HTMLInputElement) password.value = "";
			}
		};
		return (
			<form onSubmit={submit}>
				<label>
					Username <input name="username" autoComplete="username" required disabled={auth.pending} />
				</label>
				<label>
					Password{" "}
					<input name="password" type="password" autoComplete="current-password" required disabled={auth.pending} />
				</label>
				{auth.error && <p role="alert">{auth.error}</p>}
				<button type="submit" disabled={auth.pending}>
					Sign in
				</button>
			</form>
		);
	}
	return (
		<KitProvider key={auth.generation} client={auth.client}>
			<header>
				{auth.member?.display_name}
				{auth.member && (
					<button type="button" onClick={() => void auth.logout()}>
						Sign out
					</button>
				)}
			</header>
			{children}
		</KitProvider>
	);
}
```
