import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { adminApi } from "../../lib/api.ts";

export function useRemoteVaults() {
	return useAdminQuery("catalog:remote-vaults", (signal) => adminApi.remoteVaults(signal));
}

export type RemoteVaultsQuery = ReturnType<typeof useRemoteVaults>;
