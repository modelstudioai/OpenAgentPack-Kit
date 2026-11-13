import { KitError } from "@openagentpack/kit-sdk/protocol";
import { type Ref, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { flushSync } from "react-dom";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { adminApi, getAdminClient } from "../../lib/api.ts";
import { useTemplateLocalResources } from "./template-local-resources.tsx";
import { useTemplateResourceDraft } from "./template-resource-draft.tsx";
import {
	hasPendingVaults,
	prepareTemplateVaults,
	type TemplateVaultDraft,
	vaultCreateInput,
} from "./template-vault-draft.ts";
import { useTemplateDraftProject } from "./use-template-draft-project.ts";

export type VaultFormHandle = { save: () => Promise<TemplateVaultDraft[]> };
export function useTemplateVaultForm(
	value: TemplateVaultDraft[],
	onChange: (value: TemplateVaultDraft[]) => void,
	ref: Ref<VaultFormHandle>,
	editing: boolean,
	onPendingChange?: (pending: boolean) => void,
) {
	const client = useMemo(getAdminClient, []);
	const identity = useAdminQuery("templates:vault-form:identity", (signal) => client.identity(signal));
	const names = useAdminQuery("templates:vault-form:names", (signal) => adminApi.remoteVaults(signal), {
		enabled: value.some((row) => !row.creation && !row.name),
	});
	const project = useTemplateDraftProject("vault-inline", false);
	const local = useTemplateLocalResources();
	const resources = useTemplateResourceDraft();
	const active = useRef(true);
	const uncertain = useRef(false);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	const dirty = hasPendingVaults(value);
	const save = useAdminMutation(() => {
		if (!dirty) return Promise.resolve(value);
		if (uncertain.current) throw new Error("密钥库保存结果尚未确认，请退出当前页面后重新操作。");
		if (identity.data?.role !== "admin") throw new Error("当前身份不可新建密钥库");
		return prepareTemplateVaults(
			value,
			async (row) => {
				const current = await project.prepare();
				if (!active.current) throw new Error("密钥库保存已取消");
				if (current.overview.active_mutation) throw new Error("项目正在修改，请稍后重试。");
				const result = await client.draftResources
					.createVault(current.draft_id, vaultCreateInput(row, current.overview.project_revision))
					.catch((error: unknown) => {
						if (
							error instanceof KitError &&
							["conflict", "invalid_request", "not_found", "forbidden", "unauthorized"].includes(error.code)
						)
							throw error;
						uncertain.current = true;
						throw new Error("密钥库保存结果尚未确认，请退出当前页面后重新操作，避免重复创建。");
					});
				if (!active.current) throw new Error("密钥库保存已取消");
				return local.addVault(result, current.draft_id);
			},
			(prepared) => flushSync(() => onChange(prepared)),
		);
	});
	useImperativeHandle(ref, () => ({ save: () => save.run() }));
	const busy = save.pending || project.projects.loading;
	useEffect(() => {
		onPendingChange?.(busy || editing);
		return () => onPendingChange?.(false);
	}, [busy, editing, onPendingChange]);
	useEffect(() => {
		resources.setVaultDirty(dirty);
		return () => resources.setVaultDirty(false);
	}, [dirty, resources.setVaultDirty]);
	return { identity, names, busy, error: save.error || project.projects.error };
}
