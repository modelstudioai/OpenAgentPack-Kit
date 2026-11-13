import { useCallback } from "react";
import { usePublicQuery } from "../../hooks/shared.ts";
import type { KitClient } from "../../providers/kit/client.ts";
import { useResolvedClient } from "../../providers/kit/react/use-resolved-client.ts";

export function useAgentResources(slug: string | null, options: { client?: KitClient } = {}) {
	const client = useResolvedClient(options.client);
	const load = useCallback(
		async (signal: AbortSignal) => {
			if (!slug) return null;
			const detail = await client.agent(slug, signal);
			if (!detail.resources && !detail.memory_stores?.length) return null;
			return {
				tools: [],
				skills: [],
				mcp_servers: [],
				...detail.resources,
				...(detail.memory_stores ? { memory_stores: detail.memory_stores } : {}),
			};
		},
		[client, slug],
	);
	const query = usePublicQuery(load, Boolean(slug) && client.supports("agent"));
	return query.data ?? null;
}
