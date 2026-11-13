import { KitError, type RemoteVault, type RemoteVaultDetail } from "@openagentpack/kit-sdk/protocol";
import {
	ApiError,
	type CloudVault,
	getRemoteVault,
	listRemoteVaults,
	type ProjectRuntimeContext,
	type VaultPage,
} from "@openagentpack/sdk";
import { redactRemoteDetailText as safeText } from "./remote-detail-redaction.ts";
import type { ProviderGateway } from "./types.ts";

function toRemote(info: CloudVault): RemoteVault | null {
	if (info.archived_at || info.attributes?.status === "archived") return null;
	if (!info.id) throw new KitError("provider_error", "密钥库信息缺少 ID，请稍后重试");
	return { vault_id: info.id, name: info.display_name || info.id };
}

function nextPage(page: VaultPage, seen: Set<string>): string | undefined {
	const token = page.next_page;
	if (page.has_more && !token) throw new KitError("provider_error", "密钥库列表缺少下一页游标，请重试");
	if (token && seen.has(token)) throw new KitError("provider_error", "密钥库列表分页游标重复，请重试");
	if (token) seen.add(token);
	return token;
}

async function collectVaults(context: ProjectRuntimeContext): Promise<RemoteVault[]> {
	const vaults = new Map<string, RemoteVault>();
	const seenPages = new Set<string>();
	let pageToken: string | undefined;
	do {
		const page = await listRemoteVaults(context, {
			limit: 100,
			include_archived: false,
			...(pageToken ? { page: pageToken } : {}),
		});
		for (const info of page.data) {
			const vault = toRemote(info);
			if (vault) vaults.set(vault.vault_id, vault);
		}
		pageToken = nextPage(page, seenPages);
	} while (pageToken);
	return [...vaults.values()];
}

function credentialMetadata(item: {
	id: string;
	display_name?: string;
	secret_name?: string;
	networking?: { allowed_hosts?: string[] };
}): RemoteVaultDetail["credentials"][number] {
	if (typeof item.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(item.id))
		throw new KitError("provider_error", "密钥列表数据无效，请稍后重试");
	return {
		credential_id: item.id,
		name: typeof item.display_name === "string" ? safeText(item.display_name) : item.id,
		secret_name: typeof item.secret_name === "string" ? safeText(item.secret_name) : "",
		allowed_hosts: Array.isArray(item.networking?.allowed_hosts)
			? item.networking.allowed_hosts.filter((host): host is string => typeof host === "string").map(safeText)
			: [],
	};
}

function detailError(error: unknown): null {
	if (ApiError.isNotFound(error)) return null;
	if (error instanceof KitError) throw error;
	throw new KitError("provider_error", "密钥库详情查询失败，请稍后重试", { retryable: true });
}

/** 列表和绑定校验只查 Vault；显式详情通过公开 runtime 的 provider 查询密钥元数据。 */
export function createSdkVaultGateway(
	context: () => Promise<ProjectRuntimeContext>,
): Pick<ProviderGateway, "listRemoteVaults" | "getRemoteVault" | "getRemoteVaultDetail"> {
	return {
		async listRemoteVaults() {
			try {
				return await collectVaults(await context());
			} catch (error) {
				if (error instanceof KitError) throw error;
				throw new KitError("provider_error", "密钥库列表查询失败，请稍后重试", { retryable: true });
			}
		},
		async getRemoteVault(vaultId) {
			// SDK 将 ID 原样拼入路径，禁止路径/查询字符进入元数据查询。
			if (!/^[A-Za-z0-9_-]+$/.test(vaultId)) throw new KitError("invalid_request", "密钥库 ID 格式无效");
			try {
				return toRemote(await getRemoteVault(await context(), vaultId));
			} catch (error) {
				if (ApiError.isNotFound(error)) return null;
				throw new KitError("provider_error", "密钥库信息查询失败，请稍后重试", { retryable: true });
			}
		},
		async getRemoteVaultDetail(vaultId) {
			if (!/^[A-Za-z0-9_-]+$/.test(vaultId)) throw new KitError("invalid_request", "密钥库 ID 格式无效");
			try {
				const runtime = await context();
				const info = await getRemoteVault(runtime, vaultId);
				if (info.id !== vaultId) throw new KitError("provider_error", "密钥库信息不一致，请稍后重试");
				const vault = toRemote(info);
				if (!vault) return null;
				const provider = runtime.providers.get("bailian");
				if (!provider?.listCredentials) throw new KitError("provider_error", "当前 Provider 不支持密钥列表查询");
				const credentials = new Map<string, RemoteVaultDetail["credentials"][number]>();
				for (const item of await provider.listCredentials(vaultId)) {
					credentials.set(item.id, credentialMetadata(item));
				}
				return { vault_id: vaultId, name: safeText(vault.name), credentials: [...credentials.values()] };
			} catch (error) {
				return detailError(error);
			}
		},
	};
}
