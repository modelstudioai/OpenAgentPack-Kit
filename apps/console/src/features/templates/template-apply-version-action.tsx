import { ConfirmDialog } from "@openagentpack/kit-chat-ui";
import { KitError, type TemplateVersionView, type TemplateView } from "@openagentpack/kit-sdk/protocol";
import { useEffect, useMemo, useState } from "react";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";
import { getAdminClient } from "../../lib/api.ts";
import { primaryButtonClass } from "../../lib/styles.ts";
import styles from "./template-pages.module.less";

/** 通过既有更新事务追加新版本；只提交配置字段，不覆写历史快照或降低版本号。 */
export function TemplateApplyVersionAction({
	template,
	currentVersion,
	disabled = false,
	onApplied,
	onPendingChange,
}: {
	template: TemplateVersionView;
	currentVersion: number;
	disabled?: boolean;
	onApplied: (template: TemplateView) => void;
	onPendingChange: (pending: boolean) => void;
}) {
	const client = useMemo(getAdminClient, []);
	const [confirming, setConfirming] = useState(false);
	const [conflict, setConflict] = useState(false);
	const apply = useAdminMutation(async () => {
		try {
			return await client.templates.update(template.template_id, {
				base_version: currentVersion,
				name: template.name,
				category: template.category,
				remote_agent_id: template.remote_agent_id,
				agent_version: template.agent_version,
				remote_environment_id: template.remote_environment_id,
				files: template.files,
				memory_stores: template.memory_stores,
				vault_ids: template.vault_ids,
				description: template.description,
				opening_remarks: template.opening_remarks,
				suggested_prompts: template.suggested_prompts,
			});
		} catch (error) {
			setConflict(error instanceof KitError && error.status === 409);
			throw error;
		}
	});
	useEffect(() => {
		onPendingChange(apply.pending);
		return () => onPendingChange(false);
	}, [apply.pending, onPendingChange]);
	return (
		<div className={styles.actionRoot}>
			<button
				type="button"
				className={primaryButtonClass}
				disabled={disabled || apply.pending || conflict}
				onClick={() => setConfirming(true)}
			>
				应用此版本
			</button>
			{apply.error ? (
				<p role="alert" className={styles.actionError}>
					{apply.error}
					{conflict ? "。请返回模版列表重新打开详情，核对当前配置后再应用。" : null}
				</p>
			) : null}
			{confirming ? (
				<ConfirmDialog
					title="确认应用此版本"
					body="应用后会自动生效，是否确认？"
					danger={false}
					confirmLabel={apply.pending ? "应用中…" : "确认应用"}
					busy={apply.pending}
					onCancel={() => setConfirming(false)}
					onConfirm={() => {
						if (disabled || apply.pending || conflict) return;
						void apply
							.run()
							.then(onApplied)
							.catch(() => setConfirming(false));
					}}
				/>
			) : null}
		</div>
	);
}
