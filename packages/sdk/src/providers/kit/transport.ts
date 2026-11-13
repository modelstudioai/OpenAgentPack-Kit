import { AbortScope } from "../../internal/abort-scope.ts";
import { errorFromResponse, PROTOCOL_VERSION } from "../../protocol/index.ts";
import { createRequest } from "../../request/index.ts";
import { type StreamHandlers, streamKitFrames } from "./stream.ts";

export type { StreamHandlers } from "./stream.ts";

export interface TransportOptions {
	baseUrl: string;
	headers?: () => Record<string, string> | Promise<Record<string, string>>;
	fetchImpl?: typeof fetch;
}

/** Kit 协议兼容入口：保留旧动态 headers 优先级及控制帧行为。 */
export function createTransport(options: TransportOptions) {
	const http = createRequest({ ...options, headers: undefined, mapHttpError: errorFromResponse });
	async function withHeaders<T>(
		path: string,
		init: RequestInit | undefined,
		send: (path: string, init: RequestInit) => Promise<T>,
	): Promise<T> {
		const scope = new AbortScope(init?.signal ?? undefined);
		try {
			scope.check();
			const headers = new Headers(init?.headers);
			const dynamic = await scope.wait(Promise.resolve().then(() => options.headers?.()));
			new Headers(dynamic).forEach((value, name) => {
				headers.set(name, value);
			});
			headers.set("x-kit-protocol-version", PROTOCOL_VERSION);
			return await send(path, { ...init, headers });
		} finally {
			scope.dispose();
		}
	}
	const streamHttp = createRequest({
		...options,
		mapHttpError: errorFromResponse,
		headers: async () => ({
			Accept: "text/event-stream",
			...(await options.headers?.()),
			"x-kit-protocol-version": PROTOCOL_VERSION,
		}),
	});
	return {
		request: <T>(path: string, init?: RequestInit) => withHeaders(path, init, http.json<T>),
		/** 二进制响应也使用相同的认证、协议头和错误处理。 */
		response: (path: string, init?: RequestInit) => withHeaders(path, init, http.response),
		stream: (path: string, handlers: StreamHandlers = {}) => streamKitFrames(streamHttp, path, handlers),
		url: http.url,
	};
}
export type KitTransport = ReturnType<typeof createTransport>;
