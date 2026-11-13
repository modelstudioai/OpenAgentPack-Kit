import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { adminApi } from "../../lib/api.ts";

export function useRemoteMemoryStores() {
	return useAdminQuery("catalog:remote-memory-stores", (signal) => adminApi.remoteMemoryStores(signal));
}

export type RemoteMemoryStoresQuery = ReturnType<typeof useRemoteMemoryStores>;
