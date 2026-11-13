/** 同构取消边界：外部实现忽略 signal 时仍能退出，并处理迟到资源。 */
export class AbortScope {
	readonly controller = new AbortController();
	readonly signal = this.controller.signal;
	private readonly onAbort = () => this.fail(this.parent?.reason);

	constructor(private readonly parent?: AbortSignal) {
		if (parent?.aborted) this.onAbort();
		else parent?.addEventListener("abort", this.onAbort, { once: true });
	}

	check(): void {
		if (this.signal.aborted) throw this.signal.reason;
	}

	fail(reason: unknown = new DOMException("操作已取消", "AbortError")): void {
		if (!this.signal.aborted) this.controller.abort(reason);
	}

	wait<T>(promise: Promise<T>, onLate?: (value: T) => void | Promise<void>): Promise<T> {
		return new Promise((resolve, reject) => {
			const abort = () => reject(this.signal.reason);
			if (this.signal.aborted) abort();
			else this.signal.addEventListener("abort", abort, { once: true });
			promise.then(
				(value) => {
					this.signal.removeEventListener("abort", abort);
					if (this.signal.aborted) {
						void Promise.resolve()
							.then(() => onLate?.(value))
							.catch(() => undefined);
						abort();
					} else resolve(value);
				},
				(error: unknown) => {
					this.signal.removeEventListener("abort", abort);
					reject(this.signal.aborted ? this.signal.reason : error);
				},
			);
		});
	}

	dispose(): void {
		this.release();
		this.fail();
	}

	/** Detach a completed operation without cancelling a successfully received HTTP response. */
	release(): void {
		this.parent?.removeEventListener("abort", this.onAbort);
	}
}
