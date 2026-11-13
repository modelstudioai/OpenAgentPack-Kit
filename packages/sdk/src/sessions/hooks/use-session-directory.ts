import { useLayoutEffect, useMemo, useRef } from "react";
import { useLifecycle, useSnapshot } from "../../hooks/shared.ts";
import type { KitClient } from "../../providers/kit/client.ts";
import { useResolvedClient } from "../../providers/kit/react/use-resolved-client.ts";
import type { SessionAction } from "../session-actions.ts";
import { createSessionDirectory } from "../session-directory.ts";

export function useSessionDirectory(
	options: { client?: KitClient; onExecuted?: (id: string, action: SessionAction) => void } = {},
) {
	const client = useResolvedClient(options.client);
	const callback = useRef(options.onExecuted);
	useLayoutEffect(() => {
		callback.current = options.onExecuted;
	});
	const controller = useMemo(
		() => createSessionDirectory(client, { onExecuted: (id, action) => callback.current?.(id, action) }),
		[client],
	);
	useLifecycle(controller, controller.start);
	const state = useSnapshot(controller);
	const actions = useSnapshot(controller.actions);
	return {
		...state,
		reload: controller.reload,
		reloadGroups: controller.reloadGroups,
		refreshStatuses: controller.refreshStatuses,
		rename: controller.rename,
		checkAgent: controller.checkAgent,
		observeChat: controller.observeChat,
		watchStatuses: controller.watchStatuses,
		actions: {
			...actions,
			request: controller.actions.request,
			cancel: controller.actions.cancel,
			confirm: controller.actions.confirm,
		},
	};
}
