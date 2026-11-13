import type { ApplyRequest, TemplateView } from "@openagentpack/kit-sdk/protocol";
import { Modal } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import styles from "./template-pages.module.less";

/** 计划只读；准备完成及重试完成后，都必须由用户再次明确确认删除。 */
export function TemplateDeleteDialog({
	template,
	onClose,
	onDeleted,
	onPendingChange,
}: {
	template: TemplateView;
	onClose: () => void;
	onDeleted: () => void;
	onPendingChange: (pending: boolean) => void;
}) {
	const client = useMemo(getAdminClient, []);
	const [phase, setPhase] = useState<"plan" | "confirm">("plan");
	const plan = useAdminQuery(`templates:delete:${template.template_id}`, () =>
		client.templates.planDelete(template.template_id),
	);
	const confirm = useAdminMutation((confirmation: ApplyRequest) =>
		client.templates.remove(template.template_id, confirmation),
	);
	const preparing = plan.loading || (!plan.data && !plan.error);
	const busy = preparing || confirm.pending;
	const error = phase === "plan" ? plan.error : confirm.error;
	useEffect(() => {
		onPendingChange(busy);
		return () => onPendingChange(false);
	}, [busy, onPendingChange]);
	const message = error ? `是否删除该模版\n\n删除失败：${error}` : "是否删除该模版";
	return (
		<Modal
			open
			centered
			title="确认删除"
			okText={preparing ? "准备中…" : error ? "重试" : "确认删除"}
			okButtonProps={{ danger: true, loading: busy }}
			cancelText="取消"
			onCancel={onClose}
			onOk={() => {
				if (busy) return;
				if (error || !plan.data) {
					setPhase("plan");
					void plan.refresh();
					return;
				}
				setPhase("confirm");
				void confirm
					.run({ plan_id: plan.data.plan_id, confirm_token: plan.data.confirm_token })
					.then(onDeleted)
					.catch(() => {});
			}}
		>
			<p className={styles.dialogMessage}>{message}</p>
		</Modal>
	);
}
