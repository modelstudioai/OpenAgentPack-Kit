import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useLifecycle, useSnapshot } from "../../hooks/shared.ts";
import type { KitClient } from "../../providers/kit/client.ts";
import { useResolvedClient } from "../../providers/kit/react/use-resolved-client.ts";
import { type ComposerBinding, createComposer } from "../composer.ts";

export function useComposer(options: ComposerBinding & { client?: KitClient }) {
	const client = useResolvedClient(options.client);
	const controller = useMemo(() => createComposer(client), [client]);
	useLifecycle(controller);
	useLayoutEffect(
		() => controller.setTarget(options.agentSlug, options.sessionId),
		[controller, options.agentSlug, options.sessionId],
	);
	const binding = useRef(options);
	useLayoutEffect(() => {
		binding.current = options;
	});
	const send = useCallback(
		(text: string, skills?: string[]) =>
			controller.send(
				text,
				{
					...binding.current,
					// Creating a session can synchronously commit its route before sending. Use the committed Chat callback.
					send: (...args) => binding.current.send(...args),
					onSessionCreated: (id) => binding.current.onSessionCreated?.(id),
					onAccepted: (ids) => binding.current.onAccepted?.(ids),
				},
				skills,
			),
		[controller],
	);
	return { ...useSnapshot(controller), send };
}
