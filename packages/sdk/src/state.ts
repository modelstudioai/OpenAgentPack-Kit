import { KitError } from "./protocol/index.ts";

export interface QuerySnapshot<T> {
	data: T | undefined;
	loading: boolean;
	error: string | null;
}

/** 可订阅的快照容器；状态由调用方计算，订阅只用于通知读取新快照。 */
export function createObservable<T>(initial: T) {
	let state = initial;
	const listeners = new Set<() => void>();
	return {
		getSnapshot: () => state,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		set(next: T) {
			state = next;
			for (const listener of listeners) listener();
		},
	};
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** 查询按请求代次隔离迟到结果；查询失败保留同一目标最近成功的快照。 */
export function createQuery<T>(load: (signal: AbortSignal) => Promise<T>) {
	const store = createObservable<QuerySnapshot<T>>({ data: undefined, loading: false, error: null });
	let active: AbortController | undefined;
	let generation = 0;
	return {
		getSnapshot: store.getSnapshot,
		subscribe: store.subscribe,
		async refresh(): Promise<T | undefined> {
			active?.abort();
			const controller = new AbortController();
			active = controller;
			const turn = ++generation;
			store.set({ ...store.getSnapshot(), loading: true, error: null });
			try {
				const data = await load(controller.signal);
				if (generation !== turn || controller.signal.aborted) return undefined;
				store.set({ data, loading: false, error: null });
				return data;
			} catch (error) {
				if (generation === turn && !controller.signal.aborted)
					store.set({ ...store.getSnapshot(), loading: false, error: message(error) });
				return undefined;
			}
		},
		dispose() {
			generation += 1;
			active?.abort();
		},
	};
}

/** 写请求绝不自动重试；同一入口进行中拒绝重复提交，组件卸载只丢弃状态回写。 */
export function createMutation<Args extends unknown[], Result>(action: (...args: Args) => Promise<Result>) {
	const store = createObservable({ pending: false, error: null as string | null });
	let generation = 0;
	return {
		getSnapshot: store.getSnapshot,
		subscribe: store.subscribe,
		async run(...args: Args): Promise<Result> {
			if (store.getSnapshot().pending) throw new KitError("conflict", "操作进行中，请等待结果");
			const turn = ++generation;
			store.set({ pending: true, error: null });
			try {
				const result = await action(...args);
				if (generation === turn) store.set({ pending: false, error: null });
				return result;
			} catch (error) {
				if (generation === turn) store.set({ pending: false, error: message(error) });
				throw error;
			}
		},
		dispose() {
			generation += 1;
		},
	};
}
