import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { adminApi } from "../../lib/api.ts";

export function useRemoteAgents() {
	return useAdminQuery("catalog:remote-agents", (signal) => adminApi.remoteAgents(signal));
}

export type RemoteAgentsQuery = ReturnType<typeof useRemoteAgents>;
export type RemoteAgent = NonNullable<RemoteAgentsQuery["data"]>[number];
