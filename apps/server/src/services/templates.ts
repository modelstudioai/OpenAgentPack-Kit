import {
	KitError,
	type TemplateInput,
	TemplateInputSchema,
	type TemplatesQuery,
	TemplatesQuerySchema,
	type TemplateUpdateInput,
	TemplateUpdateInputSchema,
	type TemplateVersionsQuery,
	TemplateVersionsQuerySchema,
	TemplateVersionViewSchema,
} from "@openagentpack/kit-sdk/protocol";
import type { z } from "zod";
import { redactSecrets } from "../config.ts";
import type { ProviderGateway } from "../gateway/types.ts";
import type { AuditLog } from "../store/audit.ts";
import type { CatalogStore } from "../store/catalog.ts";
import type { TemplateRecord, TemplateStore } from "../store/templates.ts";
import { prepareCatalogResources } from "./catalog-resources.ts";
import type { ConfirmGate } from "./confirm-gate.ts";
import { createTemplateDeletionService } from "./template-deletion.ts";
import { catalogInputFromTemplate, createTemplateListingService } from "./template-listing.ts";

function validated<T>(schema: z.ZodType<T>, input: unknown): T {
	const result = schema.safeParse(input);
	if (!result.success) throw new KitError("invalid_request", result.error.issues[0]?.message ?? "模版参数无效");
	return result.data;
}

export function createTemplateService({
	store,
	gateway,
	audit,
	catalog,
	gate,
}: {
	store: TemplateStore;
	gateway: ProviderGateway;
	audit: AuditLog;
	catalog: CatalogStore;
	gate: ConfirmGate;
}) {
	async function prepareConfig(config: TemplateInput): Promise<TemplateRecord> {
		const [agents, environments] = await Promise.all([
			gateway.listRemoteAgents(),
			config.remote_environment_id ? gateway.listRemoteEnvironments() : Promise.resolve([]),
		]);
		const agent = agents.find((item) => item.agent_id === config.remote_agent_id);
		const environment = environments.find((item) => item.environment_id === config.remote_environment_id);
		if (!agent) throw new KitError("invalid_request", "所选智能体不存在，请返回选择配置重新选择");
		if (environment?.environment_id !== config.remote_environment_id)
			throw new KitError("invalid_request", "所选环境不存在，请返回选择配置重新选择");
		const resources = await prepareCatalogResources(gateway, config);
		const version = config.agent_version ?? agent.version;
		return {
			...resources,
			description: config.description?.trim() || undefined,
			opening_remarks: config.opening_remarks?.trim() || undefined,
			suggested_prompts: config.suggested_prompts.map((prompt) => prompt.trim()).filter(Boolean),
			remote_agent_name: agent.name || agent.agent_id,
			...(version !== undefined ? { remote_agent_version: version } : {}),
			...(environment ? { remote_environment_name: environment.name || environment.environment_id } : {}),
		};
	}
	return {
		...createTemplateListingService({ store, gateway, audit, catalog, gate }),
		...createTemplateDeletionService({ store, audit, catalog, gate }),
		get: store.get,
		versions: (templateId: string, query: TemplateVersionsQuery) =>
			store.versions(templateId, validated(TemplateVersionsQuerySchema, query)),
		version: (templateId: string, version: number) =>
			store.version(templateId, validated(TemplateVersionViewSchema.shape.version, version)),
		list: (query: TemplatesQuery) => store.list(validated(TemplatesQuerySchema, query)),
		async create(input: TemplateInput, subject: string) {
			const config = validated(TemplateInputSchema, input);
			const template = store.create(await prepareConfig(config));
			audit.append({
				subject,
				action: "templates.create",
				target: template.template_id,
				detail: { name: redactSecrets(template.name), version: template.version },
			});
			return template;
		},
		async update(templateId: string, input: TemplateUpdateInput, subject: string) {
			const { base_version: baseVersion, ...config } = validated(TemplateUpdateInputSchema, input);
			if (store.get(templateId).version !== baseVersion) {
				throw new KitError("conflict", "模版已有新版本，请刷新后重新编辑");
			}
			const prepared = await prepareConfig(config);
			const template = store.update(templateId, baseVersion, prepared, (current) => {
				if (!current.listing) return;
				const entry = catalog.get(current.listing.catalog_id);
				if (!entry) throw new KitError("conflict", "关联的上架条目已变化，请刷新后重试");
				const updated = catalog.update(
					entry.id,
					catalogInputFromTemplate(current, entry.slug, current.name.slice(0, 60).trimEnd()),
				);
				if (!updated) throw new KitError("conflict", "关联的上架条目已变化，请刷新后重试");
			});
			audit.append({
				subject,
				action: "templates.update",
				target: templateId,
				detail: { name: redactSecrets(template.name), version: template.version },
			});
			return template;
		},
	};
}
export type TemplateService = ReturnType<typeof createTemplateService>;
