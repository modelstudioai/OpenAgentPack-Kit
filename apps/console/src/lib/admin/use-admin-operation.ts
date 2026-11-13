import { useEffect, useMemo, useSyncExternalStore } from "react";
import { type AdminClient, createAdminOperation } from "./index.ts";

export function useAdminOperation(client: AdminClient, operationId: string | null) {
	const controller = useMemo(() => createAdminOperation(client, operationId ?? ""), [client, operationId]);
	useEffect(() => {
		if (operationId) void controller.start();
		return controller.dispose;
	}, [controller, operationId]);
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	return { ...snapshot, loading: Boolean(operationId) && snapshot.loading, retry: controller.start };
}
