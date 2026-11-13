import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { adminApi } from "../../lib/api.ts";

export function useRemoteEnvironments() {
	return useAdminQuery("catalog:remote-environments", (signal) => adminApi.remoteEnvironments(signal));
}

export type RemoteEnvironmentsQuery = ReturnType<typeof useRemoteEnvironments>;
