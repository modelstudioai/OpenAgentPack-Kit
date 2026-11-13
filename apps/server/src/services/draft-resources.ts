import { randomUUID } from "node:crypto";
import {
	type DeclarationPreviewInput,
	KitError,
	type ProjectAgentCreateInput,
	ProjectAgentCreateInputSchema,
	type ProjectEnvironmentCreateInput,
	ProjectEnvironmentCreateInputSchema,
	type ProjectFileUploadInput,
	type ProjectMemoryStoreCreateInput,
	ProjectMemoryStoreCreateInputSchema,
	type ProjectResourceBindingInput,
	ProjectResourceBindingInputSchema,
	type ProjectSkillUploadInput,
	type ProjectVaultCreateInput,
	ProjectVaultCreateInputSchema,
} from "@openagentpack/kit-sdk/protocol";
import type { ProjectExecutionPlan, ProviderGateway, ResourceDraftGateway } from "../gateway/types.ts";
import type { AuditLog } from "../store/audit.ts";
import type { ConfirmGate } from "./confirm-gate.ts";
import type { OperationRunner } from "./operations.ts";
import { createProjectFileUploads } from "./project-file-uploads.ts";
import { createProjectSkillUploads } from "./project-skill-uploads.ts";
import { validateRemoteSkillReferences } from "./remote-skills.ts";

export function createDraftResourceService({
	id,
	gateway,
	remote,
	gate,
	runner,
	audit,
	uploadMaxBytes,
}: {
	id: string;
	gateway: ResourceDraftGateway;
	remote: ProviderGateway;
	gate: ConfirmGate;
	runner: OperationRunner;
	audit: AuditLog;
	uploadMaxBytes: number;
}) {
	const plans = new Map<string, { subject: string; expiresAt: number; expected: ProjectExecutionPlan }>();
	const uploads = createProjectFileUploads(uploadMaxBytes);
	const skillUploads = createProjectSkillUploads(uploadMaxBytes);
	let activeMutation: string | null = null;
	let mutationRevision = 0;
	function requireDraft(name: string) {
		if (name !== id) throw new KitError("not_found", "资源批次不存在");
		return id;
	}
	function reserve(action: string) {
		if (activeMutation) throw new KitError("conflict", "批次正在修改或发布，请稍后重试");
		activeMutation = action;
		mutationRevision++;
		return () => {
			activeMutation = null;
		};
	}
	function invalidate() {
		plans.clear();
	}
	async function mutate<T>(action: string, execute: () => Promise<T>): Promise<T> {
		const release = reserve(action);
		try {
			const result = await execute();
			invalidate();
			return result;
		} finally {
			release();
		}
	}
	async function assertRevision(expected: string) {
		if ((await gateway.overview()).project_revision !== expected)
			throw new KitError("conflict", "批次配置已变化，请重新预览计划");
	}
	return {
		clearTransientState() {
			invalidate();
			uploads.clear();
			skillUploads.clear();
		},
		async overview(_name: string) {
			return { ...(await gateway.overview()), active_mutation: activeMutation };
		},
		declarations: (_name: string) => gateway.declarations(),
		async resourceBindings(_name: string) {
			if (activeMutation) throw new KitError("conflict", "批次正在修改，请完成后重新读取资源绑定");
			const revision = mutationRevision;
			const result = await gateway.resourceBindings();
			if (activeMutation || revision !== mutationRevision)
				throw new KitError("conflict", "批次已修改，请重新读取资源绑定");
			return result;
		},
		resolveResourceBindings(_name: string, input: ProjectResourceBindingInput) {
			const parsed = ProjectResourceBindingInputSchema.safeParse(input);
			if (!parsed.success) throw new KitError("invalid_request", "资源绑定查询参数无效");
			if (activeMutation) throw new KitError("conflict", "批次正在修改，请完成后重新读取资源绑定");
			return gateway.resolveResourceBindings(parsed.data);
		},
		agentOptions: (_name: string) => gateway.agentOptions(),
		createAgent(name: string, input: ProjectAgentCreateInput, subject: string) {
			const parsed = ProjectAgentCreateInputSchema.safeParse(input);
			if (!parsed.success) throw new KitError("invalid_request", parsed.error.issues[0]?.message ?? "智能体配置无效");
			requireDraft(name);
			return mutate("agent", async () => {
				await assertRevision(parsed.data.base_revision);
				await validateRemoteSkillReferences(
					remote,
					(parsed.data.skills ?? []).filter((skill) => typeof skill !== "string"),
				);
				const result = await gateway.createAgent(parsed.data);
				audit.append({ subject, action: "resourceDraft.agents.create", target: `${name}/${result.agent.id}` });
				return result;
			});
		},
		async memoryStoreConfiguration(_name: string, id: string) {
			if (activeMutation) throw new KitError("conflict", "批次正在修改，请稍后读取记忆库");
			const revision = mutationRevision;
			const result = await gateway.memoryStoreConfiguration(id);
			if (activeMutation || mutationRevision !== revision)
				throw new KitError("conflict", "批次已修改，请重新读取记忆库");
			return result;
		},
		createMemoryStore(name: string, input: ProjectMemoryStoreCreateInput, subject: string) {
			const parsed = ProjectMemoryStoreCreateInputSchema.safeParse(input);
			if (!parsed.success) throw new KitError("invalid_request", parsed.error.issues[0]?.message ?? "记忆库配置无效");
			requireDraft(name);
			return mutate("memory_store", async () => {
				const result = await gateway.createMemoryStore(parsed.data);
				audit.append({
					subject,
					action: "resourceDraft.memoryStores.create",
					target: `${name}/${result.memory_store.id}`,
				});
				return result;
			});
		},
		createVault(name: string, input: ProjectVaultCreateInput, subject: string) {
			const parsed = ProjectVaultCreateInputSchema.safeParse(input);
			if (!parsed.success) throw new KitError("invalid_request", parsed.error.issues[0]?.message ?? "密钥库配置无效");
			requireDraft(name);
			return mutate("vault", async () => {
				const result = await gateway.createVault(parsed.data);
				audit.append({ subject, action: "resourceDraft.vaults.create", target: `${name}/${result.vault.id}` });
				return result;
			});
		},
		createEnvironment(name: string, input: ProjectEnvironmentCreateInput, subject: string) {
			const parsed = ProjectEnvironmentCreateInputSchema.safeParse(input);
			if (!parsed.success) throw new KitError("invalid_request", parsed.error.issues[0]?.message ?? "环境配置无效");
			requireDraft(name);
			return mutate("environment", async () => {
				const result = await gateway.createEnvironment(parsed.data);
				audit.append({
					subject,
					action: "resourceDraft.environments.create",
					target: `${name}/${result.environment.id}`,
				});
				return result;
			});
		},
		declaration: (_name: string, type: string, id: string) => gateway.declaration(type, id),
		declarationPreview(_name: string, type: string, id: string, input: DeclarationPreviewInput) {
			return gateway.declarationPreview(type, id, input);
		},
		async stageFileUpload(
			name: string,
			baseRevision: string,
			subject: string,
			input: { filename: string; bytes: Uint8Array },
		) {
			requireDraft(name);
			await assertRevision(baseRevision);
			const result = uploads.stage({ name, baseRevision, subject }, input.filename, input.bytes);
			audit.append({
				subject,
				action: "resourceDraft.file.stage",
				target: name,
				detail: { upload_id: result.upload_id, filename: result.filename, size: result.size },
			});
			return result;
		},
		cancelFileUpload(name: string, uploadId: string, subject: string) {
			requireDraft(name);
			return uploads.cancel({ name, subject }, uploadId);
		},
		previewFileUploads(name: string, input: ProjectFileUploadInput, subject: string) {
			requireDraft(name);
			const files = uploads.resolve({ subject, name, baseRevision: input.base_revision }, input.upload_ids);
			return gateway.previewFileUploads(input, files);
		},
		commitFileUploads(name: string, input: ProjectFileUploadInput, subject: string) {
			requireDraft(name);
			return mutate("files", async () => {
				const claim = uploads.claim({ subject, name, baseRevision: input.base_revision }, input.upload_ids);
				let committed = false;
				try {
					const result = await gateway.commitFileUploads(input, claim.uploads);
					committed = true;
					invalidate();
					audit.append({
						subject,
						action: "resourceDraft.files.commit",
						target: name,
						detail: { revision: result.new_revision, file_keys: result.files.map((file) => file.file_key) },
					});
					return result;
				} finally {
					claim.finish(committed);
				}
			});
		},
		async stageSkillUpload(
			name: string,
			baseRevision: string,
			subject: string,
			input: { filename: string; bytes: Uint8Array },
		) {
			requireDraft(name);
			await assertRevision(baseRevision);
			const result = await skillUploads.stage({ name, baseRevision, subject }, input.filename, input.bytes);
			try {
				await assertRevision(baseRevision);
			} catch (error) {
				skillUploads.cancel({ name, subject }, result.upload_id);
				throw error;
			}
			audit.append({
				subject,
				action: "resourceDraft.skill.stage",
				target: name,
				detail: { upload_id: result.upload_id, filename: result.filename, size: result.size },
			});
			return result;
		},
		cancelSkillUpload(name: string, uploadId: string, subject: string) {
			requireDraft(name);
			return skillUploads.cancel({ name, subject }, uploadId);
		},
		previewSkillUploads(name: string, input: ProjectSkillUploadInput, subject: string) {
			requireDraft(name);
			const skills = skillUploads.resolve({ subject, name, baseRevision: input.base_revision }, input.upload_ids);
			return gateway.previewSkillUploads(input, skills);
		},
		commitSkillUploads(name: string, input: ProjectSkillUploadInput, subject: string) {
			requireDraft(name);
			return mutate("skills", async () => {
				const claim = skillUploads.claim({ subject, name, baseRevision: input.base_revision }, input.upload_ids);
				let committed = false;
				try {
					const result = await gateway.commitSkillUploads(input, claim.uploads);
					committed = true;
					invalidate();
					audit.append({
						subject,
						action: "resourceDraft.skills.commit",
						target: name,
						detail: { revision: result.new_revision, skill_keys: result.skills.map((skill) => skill.skill_key) },
					});
					return result;
				} finally {
					claim.finish(committed);
				}
			});
		},
		declarationPut(
			name: string,
			type: string,
			id: string,
			input: { base_revision: string; declaration: Record<string, unknown> },
			subject: string,
		) {
			requireDraft(name);
			return mutate("declaration", async () => {
				const result = await gateway.putDeclaration(type, id, input);
				audit.append({
					subject,
					action: `resourceDraft.declaration.put:${type}`,
					target: `${name}/${id}`,
					detail: { revision: result.new_revision },
				});
				return result;
			});
		},
		declarationDelete(name: string, type: string, id: string, baseRevision: string, subject: string) {
			requireDraft(name);
			return mutate("declaration", async () => {
				const result = await gateway.deleteDeclaration(type, id, baseRevision);
				audit.append({
					subject,
					action: `resourceDraft.declaration.delete:${type}`,
					target: `${name}/${id}`,
					detail: { revision: result.new_revision },
				});
				return result;
			});
		},
		validate: (_name: string) => gateway.validate(),
		async plan(name: string, subject: string) {
			requireDraft(name);
			if (activeMutation) throw new KitError("conflict", "批次有正在执行的操作，请完成后重新预览");
			const expected = await gateway.plan();
			for (const [key, record] of plans) if (record.expiresAt <= Date.now()) plans.delete(key);
			const planId = `plan_${randomUUID()}`;
			const { confirmToken, expiresAt } = await gate.issue({ planId, action: "resourceDraft.publish", subject });
			plans.set(planId, { subject, expiresAt, expected });
			return {
				plan_id: planId,
				confirm_token: confirmToken,
				expires_at: expiresAt,
				destructive: expected.diff.some((entry) => entry.destructive),
				...expected,
			};
		},
		async execute(name: string, body: { plan_id: string; confirm_token: string }, subject: string) {
			requireDraft(name);
			const record = plans.get(body.plan_id);
			if (!record || record.subject !== subject || record.expiresAt <= Date.now())
				throw new KitError("confirmation_required", "发布计划不存在、已过期或与管理员不匹配");
			const release = reserve("publish");
			try {
				await assertRevision(record.expected.project_revision);
				await gate.consume({
					planId: body.plan_id,
					action: "resourceDraft.publish",
					subject,
					token: body.confirm_token,
				});
				plans.delete(body.plan_id);
				const operationId = await runner.run({
					kind: "resourceDraft.publish",
					subject,
					fn: async (logger) => {
						try {
							logger.progress(0.1, "executing");
							const result = await gateway.execute(record.expected, logger);
							invalidate();
							return result;
						} finally {
							release();
						}
					},
				});
				return { operation_id: operationId };
			} catch (error) {
				release();
				throw error;
			}
		},
	};
}
export type DraftResourceService = ReturnType<typeof createDraftResourceService>;
