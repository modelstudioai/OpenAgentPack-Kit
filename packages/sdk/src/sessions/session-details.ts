import type { MessageFileAssociation } from "../protocol/index.ts";
import type { KitClient } from "../providers/kit/client.ts";
import { createQuery } from "../state.ts";

/** Historical file associations are injected into the existing chat store, not a second message model. */
export function createSessionDetails(
	client: KitClient,
	sessionId: string | null,
	setMessageFiles?: (entries: MessageFileAssociation[] | null) => void,
) {
	const query = createQuery(async (signal) => (sessionId ? client.session(sessionId, signal) : null));
	const unsubscribe = query.subscribe(() => {
		const detail = query.getSnapshot().data;
		if (detail !== undefined) setMessageFiles?.(detail?.message_files ?? []);
	});
	return {
		...query,
		dispose() {
			unsubscribe();
			query.dispose();
		},
	};
}
