import { KitError, type PublicationErrorDetails } from "@openagentpack/kit-sdk/protocol";

/** Gateway 已归一化的错误；业务层无须识别 SDK 类或解析 Provider 文案。 */
export class PublicationError extends KitError {
	constructor(
		readonly errorDetails: PublicationErrorDetails,
		message: string,
		code: KitError["code"] = "provider_error",
	) {
		super(code, message, { details: { error_details: errorDetails } });
	}
}
