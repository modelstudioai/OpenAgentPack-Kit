import { useMemo } from "react";
import { useLifecycle, useSnapshot } from "../../hooks/shared.ts";
import type { KitClient } from "../../providers/kit/client.ts";
import { useResolvedClient } from "../../providers/kit/react/use-resolved-client.ts";
import { createQuotaRecovery } from "../quota.ts";

export function useQuotaRecovery(options: { client?: KitClient } = {}) {
	const client = useResolvedClient(options.client);
	const controller = useMemo(() => createQuotaRecovery(client), [client]);
	useLifecycle(controller);
	return { ...useSnapshot(controller), recheck: controller.recheck };
}
