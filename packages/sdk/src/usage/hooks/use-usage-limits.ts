import { useCallback } from "react";
import { usePublicQuery } from "../../hooks/shared.ts";
import type { KitClient } from "../../providers/kit/client.ts";
import { useResolvedClient } from "../../providers/kit/react/use-resolved-client.ts";

export function useUsageLimits(options: { client?: KitClient; enabled?: boolean; days?: number } = {}) {
	const client = useResolvedClient(options.client);
	const load = useCallback(
		(signal: AbortSignal) => client.usageLimits({ days: options.days }, signal),
		[client, options.days],
	);
	return usePublicQuery(load, options.enabled !== false && client.supports("usageLimits"));
}
