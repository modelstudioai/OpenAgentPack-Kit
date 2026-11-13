import { useEffect, useMemo, useSyncExternalStore } from "react";
import { type AdminClient, createMemberUsageController } from "./index.ts";

export function useMemberUsage(client: AdminClient, memberId: string) {
	const controller = useMemo(() => createMemberUsageController(client, memberId), [client, memberId]);
	useEffect(() => {
		void controller.start();
		return controller.dispose;
	}, [controller]);
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	return {
		...snapshot,
		refresh: controller.refresh,
		retry: controller.start,
		setAgent: controller.setAgent,
		next: controller.next,
		previous: controller.previous,
	};
}
