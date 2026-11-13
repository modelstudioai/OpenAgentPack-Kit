import { useMemo } from "react";
import { useLifecycle, useSnapshot } from "../../hooks/shared.ts";
import type { KitClient } from "../../providers/kit/client.ts";
import { useResolvedClient } from "../../providers/kit/react/use-resolved-client.ts";
import { type AttachmentsOptions, createAttachments } from "../attachments.ts";

export function useAttachments(options: AttachmentsOptions & { client?: KitClient } = {}) {
	const client = useResolvedClient(options.client);
	const controller = useMemo(
		() => createAttachments(client, { pollIntervalMs: options.pollIntervalMs, scanTimeoutMs: options.scanTimeoutMs }),
		[client, options.pollIntervalMs, options.scanTimeoutMs],
	);
	useLifecycle(controller);
	const state = useSnapshot(controller);
	return {
		...state,
		uploading: state.pending.length > 0,
		processing: state.files.some((file) => !file.available),
		upload: controller.upload,
		remove: controller.remove,
		clear: controller.clear,
		consume: controller.consume,
	};
}
