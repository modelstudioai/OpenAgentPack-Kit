import { ProjectVaultCreateInputSchema, type RemoteVaultDetail } from "@openagentpack/kit-sdk/protocol";
import { validateCatalogVaults } from "../catalog/catalog-vault-field.tsx";
import type { TemplateVaultSelectionValue } from "./template-local-resources.tsx";
import type { VaultCredentialDraft } from "./template-vault-credential-dialog.tsx";

export const MAX_TEMPLATE_VAULTS = 10;
export type TemplateVaultDraft = TemplateVaultSelectionValue & {
	/** 仅在当前页面内保留新库输入；保存成功后立即替换为不含密钥值的引用。 */
	creation?: { credentials: VaultCredentialDraft[] };
	/** 导入基线只包含元数据和空值；比较后决定复用还是创建副本。 */
	configuration?: { originalName: string; baseline: string; credentials: VaultCredentialDraft[] };
};

export function emptyTemplateVault(): TemplateVaultDraft {
	return { vault_id: `pending:${crypto.randomUUID()}`, name: "", creation: { credentials: [] } };
}

function configurationFingerprint(name: string, credentials: VaultCredentialDraft[]) {
	return JSON.stringify({
		name: name.trim(),
		credentials: credentials
			.map(({ id, input }) => ({
				id,
				name: input.name.trim(),
				secret_name: input.secret_name.trim(),
				secret_value: input.secret_value,
				allowed_hosts: [...new Set(input.allowed_hosts.map((host) => host.trim().toLowerCase()))].sort(),
			}))
			.sort((a, b) => a.id.localeCompare(b.id)),
	});
}

export function importedTemplateVault(row: TemplateVaultDraft, detail: RemoteVaultDetail): TemplateVaultDraft {
	const credentials = detail.credentials.map(
		(item): VaultCredentialDraft => ({
			id: item.credential_id,
			input: {
				name: item.name,
				secret_name: item.secret_name,
				allowed_hosts: item.allowed_hosts,
				secret_value: "",
				acknowledged: false,
			},
		}),
	);
	return {
		...row,
		name: detail.name,
		configuration: {
			originalName: detail.name,
			baseline: configurationFingerprint(detail.name, credentials),
			credentials,
		},
	};
}

export function vaultNeedsCreation(row: TemplateVaultDraft) {
	return Boolean(
		row.creation ||
			(row.configuration &&
				configurationFingerprint(row.name, row.configuration.credentials) !== row.configuration.baseline),
	);
}

export const hasPendingVaults = (rows: TemplateVaultDraft[]) => rows.some(vaultNeedsCreation);

export function vaultCreateInput(row: TemplateVaultDraft, revision: string) {
	const credentials = row.creation?.credentials ?? row.configuration?.credentials ?? [];
	const parsed = ProjectVaultCreateInputSchema.safeParse({
		base_revision: revision,
		display_name: row.name,
		...(credentials.length ? { credentials: credentials.map((item) => item.input) } : {}),
	});
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		if (row.configuration && issue?.path.at(-1) === "secret_value")
			throw new Error("修改密钥库后，请重新填写保留密钥的变量值。");
		throw new Error(issue?.message ?? "请检查密钥库配置");
	}
	return parsed.data;
}

export function validateTemplateVaults(rows: TemplateVaultDraft[]): string | null {
	if (rows.length > MAX_TEMPLATE_VAULTS) return `最多选择 ${MAX_TEMPLATE_VAULTS} 个密钥库`;
	if (new Set(rows.map((row) => row.vault_id.trim())).size !== rows.length) return "同一个密钥库只能选择一次";
	const bindingError = validateCatalogVaults(
		rows.filter((row) => !row.local && !row.creation).map((row) => row.vault_id),
	);
	if (bindingError) return bindingError;
	try {
		for (const row of rows) if (vaultNeedsCreation(row)) vaultCreateInput(row, "draft");
	} catch (error) {
		return error instanceof Error ? error.message : "请检查密钥库配置";
	}
	return null;
}

export function mergeImportedVaults(current: TemplateVaultDraft[], imported: TemplateVaultSelectionValue[]) {
	const selected = new Set(imported.map((row) => row.vault_id));
	const retained = current.filter((row) => row.creation || selected.has(row.vault_id));
	const existing = new Set(retained.map((row) => row.vault_id));
	return [...retained, ...imported.filter((row) => !existing.has(row.vault_id))];
}

/** 逐项回填已成功引用；后续失败重试不会重复保存，也不把密钥输入留在引用中。 */
export async function prepareTemplateVaults(
	rows: TemplateVaultDraft[],
	create: (row: TemplateVaultDraft) => Promise<TemplateVaultSelectionValue>,
	onPrepared: (rows: TemplateVaultDraft[]) => void,
) {
	const error = validateTemplateVaults(rows);
	if (error) throw new Error(error);
	let result = rows;
	for (const row of rows) {
		if (!vaultNeedsCreation(row)) continue;
		const reference = await create(row);
		result = result.map((item) => (item.vault_id === row.vault_id ? reference : item));
		onPrepared(result);
	}
	return result;
}
