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
