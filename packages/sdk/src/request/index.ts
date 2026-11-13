import { AbortScope } from "../internal/abort-scope.ts";
import { abortableResponse, openBodyReader } from "../internal/body.ts";
import { KitError } from "../protocol/index.ts";
import { createSseStream, type RawSseMessage, type SseStreamOptions } from "../stream/index.ts";

export interface RequestOptions {
	baseUrl: string;
	headers?: () => HeadersInit | Promise<HeadersInit>;
	fetchImpl?: typeof fetch;
	mapHttpError?: (response: Response) => Error | Promise<Error>;
}

export interface RequestClient {
	url(path: string): string;
	response(path: string, init?: RequestInit): Promise<Response>;
	json<T>(path: string, init?: RequestInit): Promise<T>;
	stream(path: string, init?: RequestInit, options?: SseStreamOptions): AsyncGenerator<RawSseMessage, void, unknown>;
}

function httpError(response: Response): KitError {
	const code =
		response.status === 401
			? "unauthorized"
			: response.status === 403
				? "forbidden"
				: response.status === 404
					? "not_found"
					: response.status === 429
						? "rate_limited"
						: "provider_error";
	return new KitError(code, `HTTP ${response.status}`, {
		status: response.status,
		retryable: response.status === 429 || response.status >= 500,
	});
}

const closeResponse = async (response: Response) => {
	await response.body?.cancel().catch(() => undefined);
};

async function readJsonBody<T>(response: Response, scope: AbortScope): Promise<T> {
	if (!response.body) return JSON.parse("") as T;
	const owned = openBodyReader(response.body, scope.signal);
	const decoder = new TextDecoder();
	let text = "";
	try {
		while (true) {
			const chunk = await scope.wait(owned.reader.read());
			scope.check();
			if (chunk.done) break;
			text += decoder.decode(chunk.value, { stream: true });
		}
		return JSON.parse(text + decoder.decode()) as T;
	} finally {
		await owned.close();
	}
}

/** 通用 HTTP 客户端：不注入协议头，不重试，不推断业务完成或添加超时。 */
export function createRequest(options: RequestOptions): RequestClient {
	const base = options.baseUrl.replace(/\/+$/, "");
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	const url = (path: string) => `${base}${path.startsWith("/") ? path : `/${path}`}`;

	async function response(path: string, init: RequestInit = {}): Promise<Response> {
		const scope = new AbortScope(init.signal ?? undefined);
		let result: Response | undefined;
		try {
			scope.check();
			const headers = new Headers(await scope.wait(Promise.resolve().then(() => options.headers?.())));
			new Headers(init.headers).forEach((value, name) => {
				headers.set(name, value);
			});
			scope.check();
			// 使用调用方 signal，response 返回后它仍能取消 native fetch 的响应体。
			result = await scope.wait(fetchImpl(url(path), { ...init, headers }), closeResponse);
			scope.check();
			result = abortableResponse(result, init.signal ?? undefined);
			if (!result.ok) {
				const error = await scope.wait(
					Promise.resolve().then(() => (options.mapHttpError ?? httpError)(result as Response)),
				);
				throw error;
			}
			return result;
		} catch (error) {
			if (result) await closeResponse(result);
			throw error;
		} finally {
			scope.dispose();
		}
	}

	async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
		const scope = new AbortScope(init.signal ?? undefined);
		let result: Response | undefined;
		try {
			result = await response(path, init);
			scope.check();
			if (result.status === 204) return undefined as T;
			return await readJsonBody<T>(result, scope);
		} catch (error) {
			if (result) await closeResponse(result);
			throw error;
		} finally {
			scope.dispose();
		}
	}

	async function* stream(
		path: string,
		init: RequestInit = {},
		streamOptions: SseStreamOptions = {},
	): AsyncGenerator<RawSseMessage, void, unknown> {
		const signals = [init.signal, streamOptions.signal].filter((signal): signal is AbortSignal => signal != null);
		const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
		const result = await response(path, { ...init, signal });
		if (!result.body) throw new KitError("provider_error", "stream response has no body", { retryable: true });
		yield* createSseStream(result.body, { ...streamOptions, signal });
	}

	return { response, json, stream, url };
}
