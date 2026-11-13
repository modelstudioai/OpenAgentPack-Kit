import { KitError } from "@openagentpack/kit-sdk/protocol";
import { ApiError } from "@openagentpack/sdk";

// 只认可明确拒绝请求的状态；408、未知状态及 5xx 仍可能已经产生执行，不能解除幂等保护。
const rejectedStatuses = new Set([400, 401, 403, 404, 405, 409, 410, 413, 415, 422, 429]);

/** Gateway 已确认请求未受理；不保存或传播 Provider 响应正文、URL 与凭据。 */
export class GatewaySendRejectedError extends KitError {
	constructor(status: number) {
		super("provider_error", "Provider 已拒绝本次请求，请检查请求或稍后重试", {
			retryable: status === 409 || status === 429,
			details: { request_rejected: true, provider_status: status },
		});
	}
}

export async function withSendRejection<T>(send: () => Promise<T>): Promise<T> {
	try {
		return await send();
	} catch (error) {
		if (error instanceof ApiError && rejectedStatuses.has(error.statusCode))
			throw new GatewaySendRejectedError(error.statusCode);
		throw error;
	}
}
