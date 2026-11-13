/**
 * 每 subject 的令牌桶限流（内存实现，单实例）。
 * 保护的不变量：数据面对同一身份的突发刷量有上限，超限返回 429 `rate_limited`（可重试），
 * 而不是把 Provider 配额打爆或让 SSE 连接饿死。多副本部署时按副本各自计数（见 docs/architecture.md）。
 */
export interface RateLimiter {
	/** 返回 true=放行；false=超限（附建议等待秒数）。 */
	take(key: string, now?: number): { ok: true } | { ok: false; retryAfterSeconds: number };
	size(): number;
	reset(): void;
}

interface Bucket {
	tokens: number;
	updatedAt: number;
}

export function createRateLimiter(options: { rps: number; burst: number; idleTtlMs?: number }): RateLimiter {
	const rps = options.rps;
	const burst = Math.max(1, options.burst);
	const idleTtlMs = options.idleTtlMs ?? 10 * 60_000;
	const buckets = new Map<string, Bucket>();

	return {
		take(key, now = Date.now()) {
			if (rps <= 0) return { ok: true };
			const existing = buckets.get(key);
			const tokens = existing ? Math.min(burst, existing.tokens + ((now - existing.updatedAt) / 1000) * rps) : burst;
			if (tokens < 1) {
				buckets.set(key, { tokens, updatedAt: now });
				return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / rps)) };
			}
			buckets.set(key, { tokens: tokens - 1, updatedAt: now });
			// 简单老化：桶数过多时清掉长期不活动的 key，避免匿名 subject 无限增长
			if (buckets.size > 5000) {
				for (const [k, b] of buckets) if (now - b.updatedAt > idleTtlMs) buckets.delete(k);
			}
			return { ok: true };
		},
		size: () => buckets.size,
		reset: () => buckets.clear(),
	};
}
