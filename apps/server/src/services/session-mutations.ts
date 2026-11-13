import { KitError } from "@openagentpack/kit-sdk/protocol";

/** 删除先关入口，再等待已受理的写入退出。不能只禁用浏览器按钮。 */
export function createSessionMutations(isBlocked: (sessionId: string) => boolean) {
	const deleting = new Set<string>();
	const pending = new Map<string, Set<Promise<unknown>>>();
	return {
		async run<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
			if (deleting.has(sessionId) || isBlocked(sessionId))
				throw new KitError("conflict", "会话正在删除或删除结果待确认，请先重试删除", { retryable: true });
			const tasks = pending.get(sessionId) ?? new Set<Promise<unknown>>();
			pending.set(sessionId, tasks);
			// task 延迟一个微任务，确保在任何异步写入启动前已登记。
			const promise = Promise.resolve().then(task);
			tasks.add(promise);
			try {
				return await promise;
			} finally {
				tasks.delete(promise);
				if (!tasks.size) pending.delete(sessionId);
			}
		},
		async exclusive<T>(sessionId: string, task: (drain: Promise<unknown>) => Promise<T>): Promise<T> {
			if (deleting.has(sessionId))
				throw new KitError("conflict", "会话删除正在处理中，请稍后重试", { retryable: true });
			deleting.add(sessionId);
			try {
				return await task(Promise.allSettled([...(pending.get(sessionId) ?? [])]));
			} finally {
				deleting.delete(sessionId);
			}
		},
	};
}
