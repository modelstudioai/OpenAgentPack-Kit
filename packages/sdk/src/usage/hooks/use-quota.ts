import { useCallback } from "react";
import { usePublicQuery } from "../../hooks/shared.ts";
import type { KitClient } from "../../providers/kit/client.ts";
import { useResolvedClient } from "../../providers/kit/react/use-resolved-client.ts";

export function useQuota(options: { client?: KitClient; days?: number } = {}) {
	const client = useResolvedClient(options.client);
	const { days } = options;
	const load = useCallback((signal: AbortSignal) => client.quota({ days }, signal), [client, days]);
	const query = usePublicQuery(load, client.supports("quota"));
	return { ...query, quota: query.data ?? null };
}
