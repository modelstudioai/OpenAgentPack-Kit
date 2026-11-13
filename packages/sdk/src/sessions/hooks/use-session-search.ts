import { useEffect, useMemo } from "react";
import { useLifecycle, useSnapshot } from "../../hooks/shared.ts";
import type { KitClient } from "../../providers/kit/client.ts";
import { useResolvedClient } from "../../providers/kit/react/use-resolved-client.ts";
import { createSessionSearch } from "../session-directory.ts";

export function useSessionSearch(input: string, options: { client?: KitClient; debounceMs?: number } = {}) {
	const client = useResolvedClient(options.client);
	const controller = useMemo(() => createSessionSearch(client, options.debounceMs), [client, options.debounceMs]);
	useLifecycle(controller);
	useEffect(() => controller.setQuery(input), [controller, input]);
	return {
		...useSnapshot(controller),
		load: controller.load,
		reload: controller.reload,
		loadMore: controller.loadMore,
		retry: controller.retry,
	};
}
