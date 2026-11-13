import { encodeFrame, KitError, type SseFrame } from "@openagentpack/kit-sdk/protocol";
import type { Context } from "hono";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import type { AppEnv } from "../app-env.ts";
import { createAuthStreamGuard } from "../services/auth-stream.ts";
import type { AuthStreamBinding } from "../services/member-auth.ts";

/** 先给活跃浏览器发送认证错误；读端背压时也必须有限时地释放 writer 与上游订阅。 */
function bindCancellation(stream: SSEStreamingApi, request: AbortSignal, grant: AbortSignal) {
	const abort = new AbortController();
	let deadline: ReturnType<typeof setTimeout> | undefined;
	const onClose = () => {
		abort.abort();
		stream.abort();
	};
	const onRevoke = () => {
		deadline ??= setTimeout(() => stream.abort(), 250);
		deadline.unref();
	};
	stream.onAbort(onClose);
	request.addEventListener("abort", onClose, { once: true });
	grant.addEventListener("abort", onRevoke, { once: true });
	if (request.aborted) onClose();
	if (grant.aborted) onRevoke();
	return {
		closed: abort.signal,
		signal: AbortSignal.any([abort.signal, grant]),
		revoke: onRevoke,
		close() {
			clearTimeout(deadline);
			request.removeEventListener("abort", onClose);
			grant.removeEventListener("abort", onRevoke);
			abort.abort();
		},
	};
}

async function forwardFrames(
	stream: SSEStreamingApi,
	frames: AsyncGenerator<SseFrame>,
	grant: AuthStreamBinding,
	signal: AbortSignal,
) {
	for await (const frame of frames) {
		if (signal.aborted) break;
		grant.assertActive();
		await stream.write(encodeFrame(frame));
		if (frame.type === "done") break;
	}
}

/** 归属检查在调用方完成；此处负责认证到期/撤销与 HTTP 连接的共同生命周期。 */
export function streamSession(c: Context<AppEnv>, sessionId: string, after?: string): Response {
	const { sessions, memberAuth } = c.get("services");
	const grant = createAuthStreamGuard(memberAuth, c.get("memberSession"), c.get("authExpiresAt"));
	return streamSSE(c, async (stream) => {
		const connection = bindCancellation(stream, c.req.raw.signal, grant.signal);
		try {
			const { signal } = connection;
			await forwardFrames(stream, sessions.openStream(sessionId, { after, signal }), grant, signal);
			if (grant.signal.aborted && !connection.closed.aborted)
				throw new KitError("unauthorized", "登录已失效，请重新登录");
		} catch (error) {
			if (!connection.closed.aborted && error instanceof KitError && error.code === "unauthorized") {
				connection.revoke();
				await stream.write(
					encodeFrame({
						type: "error",
						data: { code: "unauthorized", message: "登录已失效，请重新登录", retryable: false },
					}),
				);
			} else if (!connection.closed.aborted) throw error;
		} finally {
			grant.close();
			connection.close();
		}
	});
}
