import { z } from "@hono/zod-openapi";
import { PROTOCOL_VERSION, PROTOCOL_VERSION_HEADER } from "@openagentpack/kit-sdk/protocol";

/** 与 app.ts 的运行时版本闸门一致，供 OpenAPI 示例和调用方生成请求。 */
export const ProtocolVersionHeadersSchema = z.object({
	[PROTOCOL_VERSION_HEADER]: z.string().openapi({
		example: PROTOCOL_VERSION,
		description: "必填的 Kit 协议版本；当前要求 2.x，缺失或主版本不匹配返回 409。",
	}),
});
