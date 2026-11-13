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
