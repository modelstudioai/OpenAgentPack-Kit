import type { KitClient } from "../providers/kit/client.ts";
import { createObservable } from "../state.ts";

export type SessionAction = "archive" | "delete";
export interface PendingSessionAction {
	sessionId: string;
	action: SessionAction;
	plan?: Awaited<ReturnType<KitClient["sessionPlan"]>>;
	error?: string;
}

/** Preparing a plan never executes it. Failed execution discards its one-use confirmation token. */
export function createSessionActions(client: KitClient, onExecuted: (id: string, action: SessionAction) => void) {
	const store = createObservable({ pending: null as PendingSessionAction | null, busy: false });
	let active: AbortController | undefined;
	const current = (owner: AbortController) => active === owner && !owner.signal.aborted;
	async function request(sessionId: string, action: SessionAction) {
		if (store.getSnapshot().busy) return;
		active?.abort();
		const owner = new AbortController();
		active = owner;
		store.set({ pending: { sessionId, action }, busy: true });
		try {
			const plan = await client.sessionPlan(sessionId, action, owner.signal);
			if (current(owner)) store.set({ pending: { sessionId, action, plan }, busy: false });
		} catch (error) {
			if (current(owner))
				store.set({
					pending: { sessionId, action, error: error instanceof Error ? error.message : String(error) },
					busy: false,
				});
		}
	}
	async function confirm() {
		const { pending, busy } = store.getSnapshot();
		if (!pending || busy) return;
		const { sessionId, action, plan } = pending;
		if (!plan) return request(sessionId, action);
		const owner = new AbortController();
		active = owner;
		store.set({ pending, busy: true });
		try {
			if (action === "archive") await client.archiveSession(sessionId, plan, owner.signal);
			else await client.deleteSession(sessionId, plan, owner.signal);
			if (current(owner)) {
				store.set({ pending: null, busy: false });
				onExecuted(sessionId, action);
			}
		} catch (error) {
			if (current(owner))
				store.set({
					pending: { sessionId, action, error: error instanceof Error ? error.message : String(error) },
					busy: false,
				});
		}
	}
	return {
		...store,
		request,
		confirm,
		cancel() {
			if (!store.getSnapshot().busy) {
				active?.abort();
				store.set({ pending: null, busy: false });
			}
		},
		dispose() {
			active?.abort();
		},
	};
}
