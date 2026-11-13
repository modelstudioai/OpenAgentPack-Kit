import { createHash, randomUUID } from "node:crypto";
import {
	type CatalogAgentView,
	KitError,
	PLAZA_CATEGORY_LABELS,
	type PlanResponse,
	type TemplateInput,
	type TemplateListingInput,
	TemplateListingInputSchema,
	type TemplateListingRequest,
	type TemplateView,
} from "@openagentpack/kit-sdk/protocol";
import { redactSecrets } from "../config.ts";
import type { ProviderGateway } from "../gateway/types.ts";
import type { AuditLog } from "../store/audit.ts";
import type { CatalogEntryInput, CatalogStore } from "../store/catalog.ts";
import type { TemplateStore } from "../store/templates.ts";
import { prepareCatalogResources } from "./catalog-resources.ts";
import type { ConfirmGate } from "./confirm-gate.ts";

interface ListingTarget {
	template: TemplateView;
	entry: CatalogAgentView | null;
	slug: string;
}

function listingInput(input: TemplateListingInput): TemplateListingInput {
	const parsed = TemplateListingInputSchema.safeParse(input);
	if (!parsed.success) throw new KitError("invalid_request", parsed.error.issues[0]?.message ?? "上架参数无效");
	return parsed.data;
}

function fingerprint(target: ListingTarget, config: CatalogEntryInput): string {
	return createHash("sha256").update(JSON.stringify({ target, config })).digest("hex");
}

/** 模版编辑与上架共用同一配置投影；Provider 版本快照不能变成运行时锁定。 */
export function catalogInputFromTemplate(
	template: TemplateInput,
	slug: string,
	displayName: string,
): CatalogEntryInput {
	return {
		slug,
		display_name: displayName,
		remote_agent_id: template.remote_agent_id,
		category: template.category,
		remote_environment_id: template.remote_environment_id ?? null,
		remote_agent_version: undefined,
		agent_version: template.agent_version ?? null,
		files: template.files,
		memory_stores: template.memory_stores,
		vault_ids: template.vault_ids,
		description: template.description,
		opening_remarks: template.opening_remarks,
		suggested_prompts: template.suggested_prompts,
	};
}

export function createTemplateListingService({
	store,
	catalog,
	gateway,
	gate,
	audit,
}: {
	store: TemplateStore;
	catalog: CatalogStore;
	gateway: ProviderGateway;
	gate: ConfirmGate;
	audit: AuditLog;
}) {
	function targetFor(templateId: string, displayName: string): ListingTarget {
		const template = store.get(templateId);
		const entry = template.listing ? catalog.get(template.listing.catalog_id) : null;
		if (entry?.status === "listed") throw new KitError("conflict", "该模版已上架，请刷新模版列表查看");
		const slug = entry?.slug ?? template.template_id;
		if (!entry && catalog.getBySlug(slug)) throw new KitError("conflict", "模版的上架 ID 已被其他条目占用");
		if (catalog.all().some((item) => item.id !== entry?.id && item.display_name === displayName)) {
			throw new KitError("conflict", "展示名已存在，请使用其他展示名");
		}
		return { template, entry, slug };
	}

	async function configFor(target: ListingTarget, displayName: string): Promise<CatalogEntryInput> {
		const { template } = target;
		const [agents, environments] = await Promise.all([
			gateway.listRemoteAgents(),
			template.remote_environment_id ? gateway.listRemoteEnvironments() : Promise.resolve([]),
		]);
		if (!agents.some((agent) => agent.agent_id === template.remote_agent_id)) {
			throw new KitError("invalid_request", "模版的智能体不存在，请重新保存模版");
		}
		if (
			template.remote_environment_id &&
			!environments.some((environment) => environment.environment_id === template.remote_environment_id)
		) {
			throw new KitError("invalid_request", "模版的环境不存在，请重新保存模版");
		}
		return prepareCatalogResources(gateway, catalogInputFromTemplate(template, target.slug, displayName));
	}

	return {
		async planListing(templateId: string, input: TemplateListingInput, subject: string): Promise<PlanResponse> {
			const { display_name: displayName } = listingInput(input);
			const target = targetFor(templateId, displayName);
			const config = await configFor(target, displayName);
			const planId = `template_listing:${fingerprint(target, config)}:${randomUUID()}`;
			const issued = await gate.issue({ planId, action: `templates.listing:${templateId}`, subject });
			return {
				plan_id: planId,
				confirm_token: issued.confirmToken,
				expires_at: issued.expiresAt,
				destructive: true,
				diff: [
					{
						resource: `catalog:${target.slug}`,
						action: target.entry ? "update" : "create",
						destructive: Boolean(target.entry),
						summary: `${target.entry ? "覆盖现有条目的智能体、运行时配置和展示配置" : "使用模版配置创建上架条目"}：${displayName}。分类 ${PLAZA_CATEGORY_LABELS[target.template.category]}；智能体 ${config.remote_agent_id}，环境 ${config.remote_environment_id ?? "使用智能体默认环境"}；文件 ${config.files?.length ?? 0} 个、记忆库 ${config.memory_stores?.length ?? 0} 个、密钥库 ${config.vault_ids?.length ?? 0} 个；同步描述、开场白和示例问题。`,
					},
					{
						resource: `catalog:${target.slug}/status`,
						action: "update",
						destructive: true,
						summary: `「${displayName}」未上架 → 已上架，员工端可见并可创建会话。`,
					},
				],
			};
		},
		async listing(templateId: string, input: TemplateListingRequest, subject: string): Promise<CatalogAgentView> {
			const { display_name: displayName } = listingInput({ display_name: input.display_name });
			const planId = input.plan_id ?? "";
			await gate.consume({
				planId,
				action: `templates.listing:${templateId}`,
				subject,
				token: input.confirm_token ?? "",
			});
			const parts = planId.split(":");
			if (parts.length !== 3 || parts[0] !== "template_listing" || !/^[a-f0-9]{64}$/.test(parts[1] ?? "")) {
				throw new KitError("confirmation_required", "上架确认计划无效，请重新预览计划");
			}
			const target = targetFor(templateId, displayName);
			const config = await configFor(target, displayName);
			const entry = store.saveListing(templateId, () => {
				// Provider 校验和确认验签均会 await；事务内再次读取完整目标，拒绝期间的任何目录变化。
				const current = targetFor(templateId, displayName);
				if (fingerprint(current, config) !== parts[1]) {
					throw new KitError("conflict", "模版、上架信息或资源已变更，请重新预览上架计划");
				}
				if (current.entry) {
					const updated = catalog.update(current.entry.id, { ...config, status: "listed" });
					if (!updated) throw new KitError("conflict", "上架条目已变更，请重新预览上架计划");
					return updated;
				}
				const created = catalog.create(config);
				const listed = catalog.setStatus(created.slug, "listed");
				if (!listed) throw new KitError("conflict", "上架条目已变更，请重新预览上架计划");
				return listed;
			});
			audit.append({
				subject,
				action: "templates.listing",
				target: templateId,
				detail: { name: redactSecrets(entry.display_name), catalog_id: entry.id },
			});
			return entry;
		},
	};
}
