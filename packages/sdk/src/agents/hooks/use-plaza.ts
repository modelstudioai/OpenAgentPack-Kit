import { useCallback } from "react";
import { usePublicQuery } from "../../hooks/shared.ts";
import type { PlazaCategory } from "../../protocol/index.ts";
import type { KitClient } from "../../providers/kit/client.ts";
import { useResolvedClient } from "../../providers/kit/react/use-resolved-client.ts";

export function usePlaza(options: { client?: KitClient; category?: PlazaCategory; q?: string } = {}) {
	const client = useResolvedClient(options.client);
	const { category, q } = options;
	const load = useCallback((signal: AbortSignal) => client.plaza({ category, q }, signal), [client, category, q]);
	const query = usePublicQuery(load, client.supports("plaza"));
	return { ...query, view: query.data ?? null };
}
