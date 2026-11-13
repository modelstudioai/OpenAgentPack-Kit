import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useLifecycle, useSnapshot } from "../../hooks/shared.ts";
import type { MessageFileAssociation } from "../../protocol/index.ts";
import type { KitClient } from "../../providers/kit/client.ts";
import { useResolvedClient } from "../../providers/kit/react/use-resolved-client.ts";
import { createSessionDetails } from "../session-details.ts";

export function useSessionDetails(options: {
	client?: KitClient;
	sessionId: string | null;
	setMessageFiles?: (entries: MessageFileAssociation[] | null) => void;
}) {
	const client = useResolvedClient(options.client);
	const target = useMemo(() => ({ client, sessionId: options.sessionId }), [client, options.sessionId]);
	const callback = useRef({ target, apply: options.setMessageFiles });
	useLayoutEffect(() => {
		callback.current = { target, apply: options.setMessageFiles };
	});
	const controller = useMemo(
		() =>
			createSessionDetails(target.client, target.sessionId, (entries) => {
				// 内联回调只更新绑定；旧目标的迟到通知不能写入当前会话。
				const current = callback.current;
				if (current.target === target) current.apply?.(entries);
			}),
		[target],
	);
	const start = useCallback(() => {
		if (client.supports("session")) void controller.refresh();
	}, [client, controller]);
	useLifecycle(controller, start);
	return { ...useSnapshot(controller), reload: controller.refresh };
}
