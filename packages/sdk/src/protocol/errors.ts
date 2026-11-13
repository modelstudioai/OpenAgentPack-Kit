export const ERROR_CODES = [
	"invalid_request",
	"unauthorized",
	"forbidden",
	"not_found",
	"conflict",
	"confirmation_required",
	"rate_limited",
	"quota_exceeded",
	"request_pending",
	"provider_error",
	"not_implemented",
	"internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface KitErrorBody {
	error: {
		code: ErrorCode;
		message: string;
		details?: unknown;
		retryable?: boolean;
	};
}

export class KitError extends Error {
	readonly code: ErrorCode;
	readonly details?: unknown;
	readonly retryable: boolean;
	readonly status: number;

	constructor(
		code: ErrorCode,
		message: string,
		options: { details?: unknown; retryable?: boolean; status?: number } = {},
	) {
		super(message);
		this.name = "KitError";
		this.code = code;
		this.details = options.details;
		this.retryable = options.retryable ?? false;
		this.status = options.status ?? httpStatusFor(code);
	}

	toBody(): KitErrorBody {
		return {
			error: {
				code: this.code,
				message: this.message,
				...(this.details !== undefined ? { details: this.details } : {}),
				retryable: this.retryable,
			},
		};
	}
}

export function httpStatusFor(code: ErrorCode): number {
	switch (code) {
		case "invalid_request":
			return 400;
		case "unauthorized":
			return 401;
		case "forbidden":
			return 403;
		case "not_found":
			return 404;
		case "conflict":
			return 409;
		case "quota_exceeded":
			return 403;
		case "request_pending":
			return 409;
		case "confirmation_required":
			return 428;
		case "rate_limited":
			return 429;
		case "provider_error":
			return 502;
		case "not_implemented":
			return 501;
		case "internal":
			return 500;
	}
}

/** 从 fetch Response 构造 KitError（浏览器侧使用，与 core 的 errorFromResponse 同语义）。 */
export async function fromResponse(response: Response): Promise<KitError> {
	return errorFromResponse(response);
}

export function isKitErrorBody(value: unknown): value is KitErrorBody {
	if (!value || typeof value !== "object") return false;
	const e = (value as { error?: unknown }).error;
	if (!e || typeof e !== "object") return false;
	const code = (e as { code?: unknown }).code;
	return typeof code === "string" && (ERROR_CODES as readonly string[]).includes(code);
}

/** 从任意 fetch 响应体解析出 KitError；解析失败归为 internal。 */
export async function errorFromResponse(response: Response): Promise<KitError> {
	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		body = null;
	}
	if (isKitErrorBody(body)) {
		const { code, message, details, retryable } = body.error;
		return new KitError(code, message, { details, retryable, status: response.status });
	}
	const fallback: ErrorCode =
		response.status === 401
			? "unauthorized"
			: response.status === 403
				? "forbidden"
				: response.status === 404
					? "not_found"
					: response.status >= 500
						? "provider_error"
						: "internal";
	return new KitError(fallback, `HTTP ${response.status}`, {
		status: response.status,
		retryable: response.status >= 500,
	});
}
