import { useCallback } from "react";
import { usePublicQuery } from "../../hooks/shared.ts";
import type { KitClient } from "../../providers/kit/client.ts";
import { useResolvedClient } from "../../providers/kit/react/use-resolved-client.ts";

export function useSessions(options: { client?: KitClient; agentSlug?: string; limit?: number } = {}) {
	const client = useResolvedClient(options.client);
	const { agentSlug, limit } = options;
	const load = useCallback(
		(signal: AbortSignal) => client.sessions({ agentSlug, limit }, signal),
		[client, agentSlug, limit],
	);
	const query = usePublicQuery(load, client.supports("sessions"));
	return { ...query, sessions: query.data?.sessions ?? [] };
}
