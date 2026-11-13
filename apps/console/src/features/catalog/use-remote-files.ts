import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { adminApi } from "../../lib/api.ts";

export function useRemoteFiles() {
	return useAdminQuery("catalog:remote-files", (signal) => adminApi.remoteFiles(signal));
}

export type RemoteFilesQuery = ReturnType<typeof useRemoteFiles>;
