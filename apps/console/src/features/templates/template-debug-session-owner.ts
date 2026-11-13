interface TemplateDebugSessionOwnerOptions {
	create: () => Promise<{ session_id: string }>;
	/** 调用方负责可靠排队、失败提示和重试；该函数不得抛出异常。 */
	cleanup: (sessionId: string) => void;
}

/** 当前预览拥有调试会话；真正释放后，晚到的创建结果也必须进入清理队列。 */
export function createTemplateDebugSessionOwner(options: TemplateDebugSessionOwnerOptions): {
	acquire: () => () => void;
	create: () => Promise<string | null>;
} {
	let leases = 0;
	let generation = 0;
	let sessionId: string | null = null;
	let pending: Promise<string | null> | null = null;

	return {
		acquire() {
			leases += 1;
			let released = false;
			return () => {
				if (released) return;
				released = true;
				leases -= 1;
				if (leases > 0) return;
				// StrictMode 的 setup → cleanup → setup 在同一轮完成，不应销毁仍在使用的会话。
				queueMicrotask(() => {
					if (leases > 0) return;
					generation += 1;
					pending = null;
					const owned = sessionId;
					sessionId = null;
					if (owned !== null) options.cleanup(owned);
				});
			};
		},
		create() {
			if (leases === 0) return Promise.resolve(null);
			if (sessionId !== null) return Promise.resolve(sessionId);
			if (pending) return pending;
			const requestGeneration = generation;
			const request: Promise<string | null> = Promise.resolve()
				.then(options.create)
				.then((session) => {
					if (leases === 0 || requestGeneration !== generation) {
						options.cleanup(session.session_id);
						return null;
					}
					sessionId = session.session_id;
					return sessionId;
				})
				.finally(() => {
					if (pending === request) pending = null;
				});
			pending = request;
			return request;
		},
	};
}
