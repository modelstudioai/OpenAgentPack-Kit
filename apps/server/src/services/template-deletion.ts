import { createHash, randomUUID } from "node:crypto";
import {
	type ApplyRequest,
	type CatalogAgentView,
	KitError,
	type PlanResponse,
	type TemplateView,
} from "@openagentpack/kit-sdk/protocol";
import { redactSecrets } from "../config.ts";
import type { AuditLog } from "../store/audit.ts";
import type { CatalogStore } from "../store/catalog.ts";
import type { TemplateStore } from "../store/templates.ts";
import type { ConfirmGate } from "./confirm-gate.ts";

function fingerprint(template: TemplateView, entry: CatalogAgentView | null): string {
	return createHash("sha256").update(JSON.stringify({ template, entry })).digest("hex");
}

/** 只删除本地配置目录和关联条目，不依赖 Provider，也不触碰既有 Session。 */
export function createTemplateDeletionService({
	store,
	catalog,
	gate,
	audit,
}: {
	store: TemplateStore;
	catalog: CatalogStore;
	gate: ConfirmGate;
	audit: AuditLog;
}) {
	function catalogFor(template: TemplateView): CatalogAgentView | null {
		return template.listing ? catalog.get(template.listing.catalog_id) : null;
	}
	return {
		async planDelete(templateId: string, subject: string): Promise<PlanResponse> {
			const template = store.get(templateId);
			const entry = catalogFor(template);
			const planId = `template_delete:${fingerprint(template, entry)}:${randomUUID()}`;
			const issued = await gate.issue({ planId, action: `templates.delete:${templateId}`, subject });
			return {
				plan_id: planId,
				confirm_token: issued.confirmToken,
				expires_at: issued.expiresAt,
				destructive: true,
				diff: [
					{
						resource: `template:${templateId}`,
						action: "delete",
						destructive: true,
						summary: `删除模版「${template.name}」的当前配置和全部历史版本，此操作不可恢复。`,
					},
					...(entry
						? [
								{
									resource: `catalog:${entry.slug}`,
									action: "delete" as const,
									destructive: true,
									summary: `同时移除${entry.status === "listed" ? "已上架" : "未上架"}条目「${entry.display_name}」，员工不能再通过该条目新建会话。`,
								},
							]
						: []),
					{
						resource: `template:${templateId}/retained-resources`,
						action: "noop",
						destructive: false,
						summary: "已有会话、远端智能体、环境、文件、记忆库和密钥库将保留。",
					},
				],
			};
		},
		async remove(templateId: string, input: Partial<ApplyRequest>, subject: string) {
			const planId = input?.plan_id ?? "";
			await gate.consume({
				planId,
				action: `templates.delete:${templateId}`,
				subject,
				token: input?.confirm_token ?? "",
			});
			const parts = planId.split(":");
			if (parts.length !== 3 || parts[0] !== "template_delete" || !/^[a-f0-9]{64}$/.test(parts[1] ?? "")) {
				throw new KitError("confirmation_required", "删除确认计划无效，请重试并再次确认删除");
			}
			let catalogId: string | undefined;
			let name = "";
			store.remove(templateId, (current) => {
				const entry = catalogFor(current);
				if (fingerprint(current, entry) !== parts[1]) {
					throw new KitError("conflict", "模版或关联条目已变更，请重试并再次确认删除");
				}
				name = current.name;
				if (entry) {
					if (!catalog.remove(entry.id)) throw new KitError("conflict", "关联条目已变更，请重试并再次确认删除");
					catalogId = entry.id;
				}
			});
			audit.append({
				subject,
				action: "templates.delete",
				target: templateId,
				detail: { name: redactSecrets(name), ...(catalogId ? { catalog_id: catalogId } : {}) },
			});
			return { deleted: true as const };
		},
	};
}
