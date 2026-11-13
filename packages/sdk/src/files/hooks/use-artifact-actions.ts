import { useCallback, useMemo } from "react";
import { useLifecycle, useSnapshot } from "../../hooks/shared.ts";
import type { ArtifactDescriptor } from "../../protocol/index.ts";
import type { KitClient } from "../../providers/kit/client.ts";
import { useResolvedClient } from "../../providers/kit/react/use-resolved-client.ts";
import { type ArtifactHost, createArtifactActions } from "../artifacts.ts";

export function useArtifactActions(options: {
	client?: KitClient;
	host: ArtifactHost;
	sessionId?: string;
	artifacts?: ArtifactDescriptor[];
}) {
	const client = useResolvedClient(options.client);
	const controller = useMemo(() => createArtifactActions(client, options.host), [client, options.host]);
	useLifecycle(controller);
	return {
		...useSnapshot(controller),
		open: useCallback(
			(id: string, contentType?: string) =>
				controller.open(id, { sessionId: options.sessionId, artifacts: options.artifacts, contentType }),
			[controller, options.sessionId, options.artifacts],
		),
		download: useCallback(
			(id: string) => controller.download(id, { sessionId: options.sessionId, artifacts: options.artifacts }),
			[controller, options.sessionId, options.artifacts],
		),
	};
}
