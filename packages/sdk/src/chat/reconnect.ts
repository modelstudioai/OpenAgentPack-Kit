export interface BackoffOptions {
	baseMs?: number;
	factor?: number;
	maxMs?: number;
	maxAttempts?: number;
	/** 0–1，默认 0.2（±20% jitter） */
	jitter?: number;
	random?: () => number;
}

/** 指数退避：delay = min(max, base * factor^attempt) ± jitter。见 docs/protocol.md。 */
export function createBackoff(options: BackoffOptions = {}) {
	const base = options.baseMs ?? 500;
	const factor = options.factor ?? 2;
	const max = options.maxMs ?? 15_000;
	const maxAttempts = options.maxAttempts ?? 8;
	const jitter = options.jitter ?? 0.2;
	const random = options.random ?? Math.random;
	let attempt = 0;

	return {
		/** 返回下一次重连等待毫秒；超过最大次数返回 null（放弃）。 */
		next(): number | null {
			if (attempt >= maxAttempts) return null;
			const raw = Math.min(max, base * factor ** attempt);
			attempt += 1;
			const spread = raw * jitter;
			return Math.round(raw + (random() * 2 - 1) * spread);
		},
		reset() {
			attempt = 0;
		},
		get attempts() {
			return attempt;
		},
	};
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException("Aborted", "AbortError"));
			return;
		}
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(new DOMException("Aborted", "AbortError"));
			},
			{ once: true },
		);
	});
}
