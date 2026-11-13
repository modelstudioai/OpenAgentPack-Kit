import { randomUUID } from "node:crypto";
import {
	type DeclarationType,
	DeclarationTypeSchema,
	KitError,
	ProjectAgentCreateInputSchema,
	ProjectEnvironmentCreateInputSchema,
	ProjectMemoryStoreCreateInputSchema,
	type ProjectResourceBinding,
	ProjectVaultCreateInputSchema,
} from "@openagentpack/kit-sdk/protocol";
import type { BailianCredentials } from "../config.ts";
import { agentSkillOption, projectMcpCandidates } from "./draft-agent-options.ts";
import { assertSafeDraftDeclaration } from "./draft-declaration-security.ts";
import { memoryStoreConfiguration } from "./memory-store-configuration.ts";
import type { MockDraftPublisher } from "./mock-yaml-draft.ts";
import { buildProjectAgentSelection } from "./sdk-project-agent-selection.ts";
import type { ResourceDraftGateway } from "./types.ts";
import { createYamlDraftUploads } from "./yaml-draft-assets.ts";
import { createYamlDraftDocument, digest, sections, type YamlDraftStorage } from "./yaml-draft-document.ts";
import { createYamlDraftPublisher, draftReferences } from "./yaml-draft-publish.ts";

const editable: Record<DeclarationType, readonly string[]> = {
	agent: [
		"name",
		"description",
		"model",
		"instructions",
		"environment",
		"tools",
		"mcp_servers",
		"skills",
		"multiagent",
	],
	environment: ["name", "description", "config", "metadata"],
	memory_store: ["name", "description", "entries", "entries_mode", "metadata"],
	vault: ["display_name", "credentials"],
	file: ["name", "source", "purpose"],
	skill: ["name", "source", "origin", "description", "version"],
};

function restoreProtectedField(
	type: DeclarationType,
	key: string,
	previous: Record<string, unknown>,
	next: Record<string, unknown>,
	safe: Record<string, unknown>,
) {
	if (!editable[type].includes(key)) throw new KitError("invalid_request", "声明包含不可编辑字段");
	if (!["source", "credentials", "entries_mode"].includes(key)) return;
	if (digest(next[key]) === digest(previous[key])) return;
	if (key === "credentials" && digest(next[key]) === digest(safe[key])) {
		next[key] = previous[key];
		return;
	}
	throw new KitError("invalid_request", "声明包含不可编辑字段");
}

/** Adapter for the existing application operations; no SDK directory workspace is created. */
export function createYamlDraftGateway(options: {
	id: string;
	assetRoot: string;
	storage: YamlDraftStorage;
	credentials?: BailianCredentials;
	publishMock?: MockDraftPublisher;
}): ResourceDraftGateway {
	const doc = createYamlDraftDocument(options.id, options.assetRoot, options.storage, options.credentials);
	const uploads = createYamlDraftUploads(doc);
	const publication = createYamlDraftPublisher(doc, options.publishMock);
	const typeOf = (type: string) => {
		const parsed = DeclarationTypeSchema.safeParse(type);
		if (!parsed.success) throw new KitError("invalid_request", "资源类型无效");
		return parsed.data;
	};
	async function agentOptions() {
		const current = doc.snapshot();
		return {
			base_revision: current.revision,
			skills: Object.entries(current.raw.skills ?? {}).map(([id, value]) => agentSkillOption(id, value)),
			mcp_servers: projectMcpCandidates(Object.values(current.raw.agents ?? {})).map((name) => ({ name })),
		};
	}
	async function add(type: DeclarationType, expected: string, declaration: Record<string, unknown>) {
		const current = doc.snapshot();
		const id = `${type === "environment" ? "env" : type === "memory_store" ? "memory" : type}_${randomUUID().replaceAll("-", "")}`;
		current.raw[sections[type]] = { ...current.raw[sections[type]], [id]: declaration };
		const new_revision = await doc.commit(expected, current.raw);
		return { new_revision, id };
	}
	function changes(
		type: DeclarationType,
		id: string,
		input: { base_revision: string; declaration: Record<string, unknown> },
	) {
		doc.assertRevision(input.base_revision);
		doc.declaration(type, id);
		const current = doc.snapshot();
		const previous = current.raw[sections[type]]![id]!;
		const next = structuredClone(input.declaration);
		const safe = doc.declaration(type, id).declaration;
		for (const key of Object.keys(next)) restoreProtectedField(type, key, previous, next, safe);
		for (const key of ["source", "credentials", "entries_mode"])
			if (previous[key] !== undefined && next[key] === undefined)
				throw new KitError("invalid_request", "不能移除受保护的声明字段");
		assertSafeDraftDeclaration(type, next);
		current.raw[sections[type]]![id] = next;
		return current.raw;
	}
	async function validate() {
		const diagnostics = await doc.diagnostics();
		const raw = doc.snapshot().raw;
		const unreferenced = Object.keys(raw.skills ?? {}).some(
			(id) => !Object.values(raw.agents ?? {}).some((agent) => (agent.skills as unknown[] | undefined)?.includes(id)),
		);
		return {
			diagnostics: [
				...diagnostics.filter((item) => item.severity === "error").map((item) => item.code),
				...(unreferenced ? ["请先将本批次上传的 Skill 加入智能体，再发布本批次"] : []),
			],
			warnings: diagnostics.filter((item) => item.severity !== "error").map((item) => item.code),
		};
	}
	const gateway: ResourceDraftGateway = {
		clearSecrets: () => doc.secrets.clear(),
		async overview() {
			const current = doc.snapshot();
			return {
				name: doc.id,
				project_revision: current.revision,
				aligned: true,
				drift: [],
				environments: Object.entries(current.raw.environments ?? {}).map(([id, value]) => ({
					id,
					name: String(value.name ?? id),
				})),
				agents: Object.entries(current.raw.agents ?? {}).map(([id, value]) => ({
					id,
					name: String(value.name ?? id),
					...(typeof value.model === "string" ? { model: value.model } : {}),
				})),
			};
		},
		async declarations() {
			return draftReferences(doc).map(({ type, id }) => doc.declaration(type, id));
		},
		async declaration(type, id) {
			return doc.declaration(typeOf(type), id);
		},
		async declarationPreview(type, id, input) {
			const kind = typeOf(type);
			const before = doc.declaration(kind, id);
			let raw = doc.snapshot().raw;
			if (input.action === "delete") {
				doc.assertRevision(input.base_revision);
				delete raw[sections[kind]]![id];
			} else {
				if (!input.declaration) throw new KitError("invalid_request", "缺少资源声明");
				raw = changes(kind, id, { base_revision: input.base_revision, declaration: input.declaration });
			}
			const errors = (await doc.diagnostics(raw)).filter((item) => item.severity === "error").map((item) => item.code);
			return {
				type: kind,
				id,
				action: input.action,
				references: before.references,
				base_revision: input.base_revision,
				before: JSON.stringify(before.declaration),
				after: JSON.stringify(input.declaration ?? null),
				diagnostics: errors,
				can_commit: !errors.length,
			};
		},
		async putDeclaration(type, id, input) {
			return { new_revision: await doc.commit(input.base_revision, changes(typeOf(type), id, input)) };
		},
		async deleteDeclaration(type, id, expected) {
			const raw = doc.snapshot().raw;
			doc.declaration(typeOf(type), id);
			delete raw[sections[typeOf(type)]]![id];
			return { new_revision: await doc.commit(expected, raw) };
		},
		async agentOptions() {
			return agentOptions();
		},
		async createAgent(input) {
			const parsed = ProjectAgentCreateInputSchema.parse(input);
			const choices = await agentOptions();
			const { metadata } = buildProjectAgentSelection(parsed, {
				localSkills: new Set(choices.skills.map((item) => item.id)),
				mcpNames: choices.mcp_servers.map((item) => item.name),
			});
			const result = await add("agent", parsed.base_revision, { ...metadata, instructions: parsed.instructions ?? "" });
			return { new_revision: result.new_revision, agent: { id: result.id, name: parsed.name } };
		},
		async createEnvironment(input) {
			const value = ProjectEnvironmentCreateInputSchema.parse(input);
			const result = await add("environment", value.base_revision, {
				name: value.name,
				description: value.description ?? "",
				config: {
					type: "cloud",
					...(value.packages ? { packages: value.packages } : {}),
					...(value.networking ? { networking: value.networking } : {}),
				},
				...(value.metadata ? { metadata: value.metadata } : {}),
			});
			return { new_revision: result.new_revision, environment: { id: result.id, name: value.name } };
		},
		async createMemoryStore(input) {
			const value = ProjectMemoryStoreCreateInputSchema.parse(input);
			const result = await add("memory_store", value.base_revision, {
				name: value.name,
				description: value.description ?? "",
				entries: value.entries ?? [],
				entries_mode: "initialize",
			});
			return { new_revision: result.new_revision, memory_store: { id: result.id, name: value.name } };
		},
		async memoryStoreConfiguration(id) {
			const value = doc.declaration("memory_store", id).declaration;
			return memoryStoreConfiguration(
				id,
				String(value.name ?? id),
				String(value.description ?? ""),
				(value.entries as { key: string; content: string }[]) ?? [],
			);
		},
		async createVault(input) {
			const value = ProjectVaultCreateInputSchema.parse(input);
			const pending = new Map<string, string>();
			const credentials = (value.credentials ?? []).map((item) => {
				const ref = `\${KIT_VAULT_${randomUUID().replaceAll("-", "").toUpperCase()}}`;
				pending.set(ref, item.secret_value);
				return {
					name: item.name,
					secret_name: item.secret_name,
					secret_value: ref,
					type: "environment_variable",
					networking: { allowed_hosts: item.allowed_hosts },
					injection_location: { header: true, body: false },
				};
			});
			const result = await add("vault", value.base_revision, { display_name: value.display_name, credentials });
			for (const [key, secret] of pending) doc.secrets.set(key, secret);
			return {
				new_revision: result.new_revision,
				vault: { id: result.id, display_name: value.display_name },
			};
		},
		previewFileUploads: (input, files) => uploads.filePreview(input, files),
		commitFileUploads: (input, files) => uploads.fileCommit(input, files),
		previewSkillUploads: (input, files) => uploads.skillPreview(input, files),
		commitSkillUploads: (input, files) => uploads.skillCommit(input, files),
		validate: validate,
		async plan() {
			const result = await validate();
			if (result.diagnostics.length) throw new KitError("invalid_request", result.diagnostics.join("；"));
			return publication.plan();
		},
		execute: (expected, feedback) => publication.execute(expected, feedback),
		publicationBindings: () => publication.bindings(true),
		async resourceBindings() {
			return { resources: (await publication.bindings(false)).filter((item) => item.type !== "skill") };
		},
		async resolveResourceBindings(input) {
			const resources = await publication.bindings(true, input.resources);
			return {
				resources: resources.filter((item): item is ProjectResourceBinding => item.type !== "skill"),
			};
		},
	};
	return gateway;
}
