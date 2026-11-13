import { KitError } from "@openagentpack/kit-sdk/protocol";
import type { ProviderGateway } from "../gateway/types.ts";

/** 查看环境不改变向导选择，也不创建 Session 或修改 Provider 资源。 */
export async function readEnvironmentDetail(gateway: ProviderGateway, environmentId: string) {
	const detail = await gateway.getRemoteEnvironment(environmentId);
	if (!detail) throw new KitError("not_found", "环境不存在或已不可用");
	return detail;
}
