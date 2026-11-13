import { useCallback } from "react";
import { usePublicQuery } from "../../hooks/shared.ts";
import type { KitClient } from "../../providers/kit/client.ts";
import { useResolvedClient } from "../../providers/kit/react/use-resolved-client.ts";

export function useQuotaRequests(options: { client?: KitClient } = {}) {
	const client = useResolvedClient(options.client);
	const load = useCallback((signal: AbortSignal) => client.quotaRequests(signal), [client]);
	const query = usePublicQuery(load, client.supports("quotaRequests"));
	return { ...query, requests: query.data ?? [] };
}
