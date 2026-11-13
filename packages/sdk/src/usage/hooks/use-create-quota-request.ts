import { useMemo } from "react";
import { useLifecycle, useSnapshot } from "../../hooks/shared.ts";
import type { KitClient } from "../../providers/kit/client.ts";
import { useResolvedClient } from "../../providers/kit/react/use-resolved-client.ts";
import { createMutation } from "../../state.ts";

export function useCreateQuotaRequest(options: { client?: KitClient } = {}) {
	const client = useResolvedClient(options.client);
	const controller = useMemo(() => createMutation(client.createQuotaRequest), [client]);
	useLifecycle(controller);
	return { ...useSnapshot(controller), submit: controller.run };
}
