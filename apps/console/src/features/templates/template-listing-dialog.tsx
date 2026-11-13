import type { ApplyRequest, CatalogAgentView, TemplateView } from "@openagentpack/kit-sdk/protocol";
import { Modal } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { adminApi, getAdminClient } from "../../lib/api.ts";
import styles from "./template-pages.module.less";

/** 上下架均只展示一次确认；后台自动准备只读计划，用户确认后才提交。 */
export function TemplateListingDialog({
	template,
	onClose,
	onUpdated,
	onPendingChange,
}: {
	template: TemplateView;
	onClose: () => void;
	onUpdated: (catalog: CatalogAgentView) => void;
	onPendingChange: (pending: boolean) => void;
}) {
	const client = useMemo(getAdminClient, []);
	const listing = template.listing;
	const unlisting = listing?.status === "listed";
	const action = unlisting ? "下架" : "上架";
	const displayName = (template.listing?.display_name ?? template.name).trim().slice(0, 60).trimEnd();
	const [phase, setPhase] = useState<"plan" | "confirm">("plan");
	const plan = useAdminQuery<ApplyRequest>(`templates:listing:${template.template_id}:${action}:${displayName}`, () =>
		unlisting
			? adminApi.catalog.plan(listing.slug, "unlisted")
			: client.templates.planListing(template.template_id, { display_name: displayName }),
	);
	const confirm = useAdminMutation((prepared: ApplyRequest) => {
		const confirmation = {
			plan_id: prepared.plan_id,
			confirm_token: prepared.confirm_token,
		};
		return unlisting
			? adminApi.catalog.setStatus(listing.slug, "unlisted", confirmation)
			: client.templates.confirmListing(template.template_id, { display_name: displayName, ...confirmation });
	});
	const preparing = plan.loading || (!plan.data && !plan.error);
	const busy = preparing || confirm.pending;
	const error = phase === "plan" ? plan.error : confirm.error;
	useEffect(() => {
		onPendingChange(busy);
		return () => onPendingChange(false);
	}, [busy, onPendingChange]);
	const message = unlisting
		? `是否下架模版「${displayName}」？下架后员工端将不再展示。`
		: `是否上架模版「${displayName}」？${listing ? "将使用模版配置更新原条目，" : ""}上架后员工即可使用。`;
	return (
		<Modal
			open
			centered
			title={`确认${action}`}
			okText={preparing ? "准备中…" : error ? "重试" : `确认${action}`}
			okButtonProps={{ danger: unlisting, loading: busy }}
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
					.run(plan.data)
					.then(onUpdated)
					.catch(() => {});
			}}
		>
			<p className={styles.dialogMessage}>{error ? `${message}\n\n${action}失败：${error}` : message}</p>
		</Modal>
	);
}
