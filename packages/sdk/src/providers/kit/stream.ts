import { AbortScope } from "../../internal/abort-scope.ts";
import { decodeFrame, type ErrorCode, KitError, type SseFrame } from "../../protocol/index.ts";
import type { RequestClient } from "../../request/index.ts";

export interface StreamHandlers {
	onFrame?: (frame: SseFrame) => void;
	signal?: AbortSignal;
	/** 已转换事件后端可配置订阅方法和请求头；取消仍由 signal 负责。 */
	init?: Omit<RequestInit, "signal">;
	/** 默认 45 秒无有效帧即断线恢复。 */
	idleTimeoutMs?: number;
}

/** Kit 控制帧策略。通用 Request / Stream 不解释 done、error 或心跳。 */
export async function streamKitFrames(
	request: RequestClient,
	path: string,
	handlers: StreamHandlers = {},
): Promise<void> {
	const scope = new AbortScope(handlers.signal);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const activity = () => {
		clearTimeout(timer);
		timer = setTimeout(
			() => scope.fail(new KitError("provider_error", "事件连接长时间没有响应", { retryable: true })),
			handlers.idleTimeoutMs ?? 45_000,
		);
	};
	try {
		activity();
		for await (const raw of request.stream(path, { ...handlers.init, signal: scope.signal })) {
			scope.check();
			const frame = decodeFrame(raw);
			if (!frame) continue;
			activity();
			if (frame.type === "error")
				throw new KitError(frame.data.code as ErrorCode, frame.data.message, { retryable: frame.data.retryable });
			handlers.onFrame?.(frame);
			if (frame.type === "done") return;
		}
		throw new KitError("provider_error", "事件连接意外关闭", { retryable: true });
	} finally {
		clearTimeout(timer);
		scope.dispose();
	}
}
