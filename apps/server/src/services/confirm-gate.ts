import { KitError } from "@openagentpack/kit-sdk/protocol";
import type { ServerConfig } from "../config.ts";
import { type ConfirmationSigner, createConfirmationSigner } from "./confirm-token.ts";

/**
 * 破坏性动作两段式闸门：plan → 一次性确认令牌 → execute。
 * 令牌消费即失效；服务端不代替用户确认，无旁路。见 docs/protocol.md 与 AGENTS.md 红线。
 */
/** 已消费记录的保留期：令牌 TTL 是 5min，两倍之后的条目可以安全遗忘（防重放窗口早已关闭）。 */
const CONSUMED_TTL_MS = 10 * 60_000;
const CONSUMED_PRUNE_THRESHOLD = 1000;
const CONSUMED_HARD_CAP = 50_000;

export function createConfirmGate(config: ServerConfig) {
	const signer: ConfirmationSigner = createConfirmationSigner(config.confirmSecret);
	/** key = `planId:action:subject`，value = 消费时间（用于老化，避免长运行进程无界增长）。 */
	const consumed = new Map<string, number>();

	function forgetStale(now: number) {
		if (consumed.size <= CONSUMED_PRUNE_THRESHOLD) return;
		for (const [key, at] of consumed) if (now - at > CONSUMED_TTL_MS) consumed.delete(key);
		while (consumed.size > CONSUMED_HARD_CAP) {
			const oldest = consumed.keys().next().value;
			if (oldest === undefined) break;
			consumed.delete(oldest);
		}
	}

	return {
		async issue(input: { planId: string; action: string; subject: string }) {
			const { token, expiresAt } = await signer.sign(input);
			return { confirmToken: token, expiresAt };
		},
		async consume(input: { planId: string; action: string; subject: string; token: string }) {
			if (!input.token) throw new KitError("confirmation_required", "缺少确认令牌");
			const now = Date.now();
			forgetStale(now);
			const key = `${input.planId}:${input.action}:${input.subject}`;
			if (consumed.has(key)) throw new KitError("confirmation_required", "确认令牌已使用");
			const result = await signer.verify(input.token, {
				planId: input.planId,
				action: input.action,
				subject: input.subject,
			});
			if (!result.ok) throw new KitError("confirmation_required", `确认令牌无效（${result.reason}）`);
			consumed.set(key, now);
		},
		/** 测试用：观察已消费条目数（老化是否生效）。 */
		pendingCount: () => consumed.size,
	};
}
export type ConfirmGate = ReturnType<typeof createConfirmGate>;
