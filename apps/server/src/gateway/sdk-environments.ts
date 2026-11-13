import { KitError } from "@openagentpack/kit-sdk/protocol";
import { ApiError, getRemoteEnvironment, type ProjectRuntimeContext } from "@openagentpack/sdk";
import { environmentDetail } from "./environment-detail.ts";
import type { ProviderGateway } from "./types.ts";

/** SDK 公开详情接口只读；不向浏览器透传原始响应或 Provider 错误正文。 */
export function createSdkEnvironmentGateway(
	context: () => Promise<ProjectRuntimeContext>,
): Pick<ProviderGateway, "getRemoteEnvironment"> {
	return {
		async getRemoteEnvironment(environmentId) {
			// SDK 直接把 ID 拼入路径，先阻止路径、查询和片段注入。
			if (!/^[A-Za-z0-9_-]+$/.test(environmentId)) throw new KitError("invalid_request", "环境 ID 格式无效");
			try {
				const environment = await getRemoteEnvironment(await context(), environmentId);
				if (environment.archived_at || environment.attributes?.status === "archived") return null;
				if (environment.id !== environmentId) throw new KitError("provider_error", "环境信息不一致，请稍后重试");
				return environmentDetail(environment);
			} catch (error) {
				if (ApiError.isNotFound(error)) return null;
				if (error instanceof KitError) throw error;
				throw new KitError("provider_error", "环境详情查询失败，请稍后重试", { retryable: true });
			}
		},
	};
}
