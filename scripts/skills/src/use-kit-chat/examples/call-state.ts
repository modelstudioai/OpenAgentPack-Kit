import { createMutation, createObservable, createQuery, type QuerySnapshot } from "@openagentpack/kit-sdk/state";

interface ResourceView<T> {
	query: QuerySnapshot<T>;
	mutation: { pending: boolean; error: string | null };
	editing: boolean;
}

/** Backend calls are supplied by the host; the SDK only owns observable call state. */
export function bindResource<T, Input>(
	read: (signal: AbortSignal) => Promise<T>,
	write: (input: Input) => Promise<void>,
	render: (view: ResourceView<T>) => void,
) {
	const query = createQuery(read);
	const mutation = createMutation(write);
	const editing = createObservable(false);
	const publish = () =>
		render({ query: query.getSnapshot(), mutation: mutation.getSnapshot(), editing: editing.getSnapshot() });
	const subscriptions = [query.subscribe(publish), mutation.subscribe(publish), editing.subscribe(publish)];
	publish();
	void query.refresh();
	return {
		refresh: query.refresh,
		// Call after explicit user action; errors reject and are never automatically retried.
		save: mutation.run,
		setEditing: editing.set,
		dispose() {
			for (const unsubscribe of subscriptions) unsubscribe();
			query.dispose();
			mutation.dispose();
		},
	};
}
