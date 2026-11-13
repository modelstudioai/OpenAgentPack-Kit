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
