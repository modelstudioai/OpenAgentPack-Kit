import type { AbortScope } from "../internal/abort-scope.ts";
import type { RequestClient } from "../request/index.ts";

export interface BackendRequestContext {
	signal?: AbortSignal;
}

export interface BackendRequestSpec {
	path: string;
	/** 取消信号由 Provider 管理。 */
	init?: Omit<RequestInit, "signal">;
}

/** 后端请求与响应映射；HTTP 统一由 RequestClient 执行。 */
export interface BackendOperation<Input, Output> {
	buildRequest(input: Input, context: BackendRequestContext): BackendRequestSpec | Promise<BackendRequestSpec>;
	mapResponse(response: Response, context: BackendRequestContext & { input: Input }): Output | Promise<Output>;
}

export const closeResponse = async (response: Response | undefined) => {
	await response?.body?.cancel().catch(() => undefined);
};

/** 每次只执行一次请求，取消后不继续构造、读取或映射。 */
export async function executeOperation<Input, Output>(
	request: RequestClient,
	operation: BackendOperation<Input, Output>,
	input: Input,
	scope?: AbortScope,
	onMapped?: (output: Output) => void,
): Promise<Output> {
	const context: BackendRequestContext = scope ? { signal: scope.signal } : {};
	const wait = <T>(promise: Promise<T>, onLate?: (value: T) => void | Promise<void>) =>
		scope ? scope.wait(promise, onLate) : promise;
	scope?.check();
	const spec = await wait(
		Promise.resolve().then(() => {
			scope?.check();
			return operation.buildRequest(input, context);
		}),
	);
	scope?.check();
	const response = await wait(request.response(spec.path, { ...spec.init, signal: context.signal }), closeResponse);
	try {
		scope?.check();
		return await wait(
			Promise.resolve()
				.then(() => {
					scope?.check();
					return operation.mapResponse(response, { ...context, input });
				})
				.then((output) => {
					onMapped?.(output);
					return output;
				}),
			() => closeResponse(response),
		);
	} catch (error) {
		await closeResponse(response);
		throw error;
	}
}
