import { createBackoff, sleep } from "@openagentpack/kit-sdk/chat";
import { KitError, type OperationView } from "@openagentpack/kit-sdk/protocol";
import { createObservable } from "@openagentpack/kit-sdk/state";
import type { AdminClient } from "./client.ts";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export interface AdminOperationSnapshot {
	operation: OperationView | undefined;
	loading: boolean;
	error: string | null;
}

const terminal = (operation?: OperationView) =>
	operation && ["succeeded", "failed", "cancelled"].includes(operation.status);

async function observeOperation(options: {
	connect: () => Promise<void>;
	current: () => boolean;
	completed: () => boolean;
	failure: (error: unknown) => void;
	signal: AbortSignal;
}) {
	const backoff = createBackoff();
	const finished = () => !options.current() || options.completed();
	while (options.current()) {
		try {
			await options.connect();
			if (finished()) return;
			throw new KitError("provider_error", "操作进度连接已断开", { retryable: true });
		} catch (error) {
			if (finished()) return;
			options.failure(error);
			if (error instanceof KitError && !error.retryable) return;
			const delay = backoff.next();
			if (delay === null) return;
			await sleep(delay, options.signal).catch(() => undefined);
		}
	}
}

/** Operation 只重连观测流，不重发执行请求；迟到的初始 GET 不能覆盖较新的 SSE。 */
export function createAdminOperation(client: AdminClient, operationId: string) {
	const store = createObservable<AdminOperationSnapshot>({ operation: undefined, loading: true, error: null });
	let active: AbortController | undefined;
	let generation = 0;
	async function start() {
		active?.abort();
		const controller = new AbortController();
		active = controller;
		const turn = ++generation;
		let liveUpdates = 0;
		const current = () => generation === turn && !controller.signal.aborted;
		const accept = (operation: OperationView) => {
			if (!current() || operation.operation_id !== operationId) return;
			if (terminal(store.getSnapshot().operation) && !terminal(operation)) return;
			store.set({ operation, loading: false, error: null });
		};
		store.set({ ...store.getSnapshot(), loading: !store.getSnapshot().operation, error: null });
		void client.operations
			.get(operationId, controller.signal)
			.then((operation) => {
				if (!liveUpdates) accept(operation);
			})
			.catch(() => undefined);
		await observeOperation({
			current,
			completed: () => Boolean(terminal(store.getSnapshot().operation)),
			failure: (error) => store.set({ ...store.getSnapshot(), loading: false, error: message(error) }),
			signal: controller.signal,
			connect: () =>
				client.operations.stream(
					operationId,
					(operation) => {
						liveUpdates += 1;
						accept(operation);
					},
					controller.signal,
				),
		});
	}
	return {
		getSnapshot: store.getSnapshot,
		subscribe: store.subscribe,
		start,
		dispose() {
			generation += 1;
			active?.abort();
		},
	};
}
