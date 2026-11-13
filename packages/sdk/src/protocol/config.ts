import { z } from "zod";

/** `GET /api/config` 的运行时公开配置。所有端启动必读，禁止假设同源。 */
export const KitRuntimeConfigSchema = z.object({
	apiBaseUrl: z.string(),
	protocolVersion: z.string(),
	gateway: z.enum(["sdk", "mock"]),
	/** Server 始终返回；可选仅兼容此前公开配置的静态调用方。缺省按成员登录处理。 */
	auth: z.object({ mode: z.enum(["member", "anonymous"]), passwordLogin: z.literal(true) }).optional(),
	capabilities: z.object({
		streaming: z.boolean(),
		fileUpload: z.boolean(),
		artifacts: z.boolean(),
		threads: z.boolean(),
	}),
	branding: z.object({
		productName: z.string(),
		logoUrl: z.string().optional(),
		accent: z.string().optional(),
	}),
});
export type KitRuntimeConfig = z.infer<typeof KitRuntimeConfigSchema>;

export const PROTOCOL_VERSION = "2.0.0";
export const PROTOCOL_VERSION_HEADER = "x-kit-protocol-version";

export function isProtocolCompatible(version: string): boolean {
	return /^2\./.test(version);
}
