import { KitError } from "@openagentpack/kit-sdk/protocol";
import type { AdminClient } from "../../lib/admin/index.ts";

type CleanupClient = { debug: Pick<AdminClient["debug"], "planDelete" | "deleteSession"> };

export interface TemplateDebugCleanupState {
	key: number;
	sessionId: string;
	pending: boolean;
	error: string | null;
}

interface CleanupTask extends TemplateDebugCleanupState {
	client: CleanupClient;
	request: Promise<void> | null;
}

/** 队列独立于预览组件生命周期；失败任务保留原客户端，只在用户重试时重新准备计划。 */
export function createTemplateDebugCleanupQueue() {
	const tasks = new Map<number, CleanupTask>();
	const byClient = new WeakMap<CleanupClient, Map<string, CleanupTask>>();
	const listeners = new Set<() => void>();
	let nextKey = 0;
	let snapshot: readonly TemplateDebugCleanupState[] = [];
	const publish = () => {
		snapshot = [...tasks.values()].map(({ key, sessionId, pending, error }) => ({ key, sessionId, pending, error }));
		for (const listener of listeners) listener();
	};
	const forget = (task: CleanupTask) => {
		tasks.delete(task.key);
		byClient.get(task.client)?.delete(task.sessionId);
	};
	const run = (task: CleanupTask): Promise<void> => {
		if (task.request) return task.request;
		task.pending = true;
		task.request = Promise.resolve()
			.then(async () => {
				const plan = await task.client.debug.planDelete(task.sessionId);
				const result = await task.client.debug.deleteSession(task.sessionId, {
					plan_id: plan.plan_id,
					confirm_token: plan.confirm_token,
				});
				if (!result.deleted) throw new Error("服务未确认调试会话已删除，请重试清理");
				forget(task);
			})
			.catch((error: unknown) => {
				if (error instanceof KitError && error.status === 404) forget(task);
				else task.error = error instanceof Error ? error.message : "清理请求未完成，请重试";
			})
			.finally(() => {
				task.pending = false;
				task.request = null;
				publish();
			});
		publish();
		return task.request;
	};
	return {
		getSnapshot: () => snapshot,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		enqueue(client: CleanupClient, sessionId: string): void {
			let clientTasks = byClient.get(client);
			if (!clientTasks) {
				clientTasks = new Map();
				byClient.set(client, clientTasks);
			}
			if (clientTasks.has(sessionId)) return;
			const task: CleanupTask = { key: ++nextKey, sessionId, pending: false, error: null, client, request: null };
			clientTasks.set(sessionId, task);
			tasks.set(task.key, task);
			void run(task);
		},
		async retryFailed(): Promise<void> {
			await Promise.all([...tasks.values()].filter((task) => task.error !== null).map(run));
		},
	};
}

export const templateDebugCleanupQueue = createTemplateDebugCleanupQueue();

export function enqueueTemplateDebugCleanup(client: AdminClient, id: string): void {
	templateDebugCleanupQueue.enqueue(client, id);
}
