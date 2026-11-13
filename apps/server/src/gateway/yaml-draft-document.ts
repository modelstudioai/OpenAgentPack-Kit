import { createHash } from "node:crypto";
import { join } from "node:path";
import { type DeclarationType, KitError, type ResourceDraftDeclaration } from "@openagentpack/kit-sdk/protocol";
import {
	type BackendRuntimeInput,
	InMemoryStateManager,
	resolveProjectConfigFromObject,
	type StateFile,
	validateProjectConfig,
} from "@openagentpack/sdk";
import { parse, stringify } from "yaml";
import type { BailianCredentials } from "../config.ts";
import { workspaceBaseUrl } from "./bailian-rest.ts";
import { assertSafeDraftDeclaration, redactDraftDeclaration } from "./draft-declaration-security.ts";

export const sections = {
	agent: "agents",
	environment: "environments",
	memory_store: "memory_stores",
	vault: "vaults",
	skill: "skills",
	file: "files",
} as const;
export type DraftConfig = Record<string, unknown> &
	Partial<Record<(typeof sections)[DeclarationType], Record<string, Record<string, unknown>>>>;
export interface DraftAsset {
	path: string;
	sha256: string;
	size: number;
}
export interface YamlDraftStorage {
	read(): { revision: number; yaml: string; sdk_state_json: string; assets_json: string };
	write(expected: string, yaml: string, assets?: string): string;
	writeState(state: string): void;
}
export function digest(value: unknown): string {
	return createHash("sha256")
		.update(typeof value === "string" || value instanceof Uint8Array ? value : (JSON.stringify(value) ?? "null"))
		.digest("hex");
}
export const initialDraftYaml = stringify({ version: "1", providers: { bailian: {} }, agents: {} });

function materializeVaultSecrets(config: DraftConfig, resolveSecret: (reference: string) => string | undefined) {
	const entries = Object.values(config.vaults ?? {}).flatMap(
		(vault) => (vault.credentials ?? []) as { secret_value?: string }[],
	);
	for (const entry of entries) {
		if (!entry.secret_value) continue;
		const value = resolveSecret(entry.secret_value);
		if (value === undefined) throw new KitError("invalid_request", "未发布密钥已失效，请重新创建密钥库并添加密钥");
		entry.secret_value = value;
	}
}

function safeDeclaration(type: DeclarationType, value: Record<string, unknown>, readOnly: string[][]) {
	const safe = redactDraftDeclaration(type, value, readOnly) as Record<string, unknown>;
	if (type !== "vault") return safe;
	for (const credential of (safe.credentials ?? []) as Record<string, unknown>[]) {
		if (credential.secret_value !== undefined) credential.secret_value = "[redacted]";
	}
	return safe;
}

export interface YamlDraftDocument {
	id: string;
	assetRoot: string;
	secrets: Map<string, string>;
	stateBackend: BackendRuntimeInput["stateBackend"];
	snapshot(): {
		revision: string;
		yaml: string;
		sdk_state_json: string;
		assets_json: string;
		raw: DraftConfig;
		assets: DraftAsset[];
	};
	assertRevision(expected: string): void;
	resolve(raw?: DraftConfig, materialize?: boolean): ReturnType<typeof resolveProjectConfigFromObject>;
	diagnostics(raw?: DraftConfig): Promise<ReturnType<typeof validateProjectConfig>>;
	commit(expected: string, raw: DraftConfig, assets?: DraftAsset[]): Promise<string>;
	declaration(type: DeclarationType, key: string): ResourceDraftDeclaration;
	runtime(materialize?: boolean): Promise<BackendRuntimeInput>;
}

/** SDK owns the schema and state semantics; this object only hosts the current batch document. */
export function createYamlDraftDocument(
	id: string,
	assetRoot: string,
	storage: YamlDraftStorage,
	credentials?: BailianCredentials,
): YamlDraftDocument {
	const secrets = new Map<string, string>();
	function snapshot() {
		const row = storage.read();
		return {
			...row,
			revision: String(row.revision),
			raw: parse(row.yaml) as DraftConfig,
			assets: JSON.parse(row.assets_json) as DraftAsset[],
		};
	}
	function assertRevision(expected: string) {
		if (snapshot().revision !== expected) throw new KitError("conflict", "批次配置已变化，请重新加载并预览");
	}
	async function resolve(raw = snapshot().raw, materialize = false): ReturnType<typeof resolveProjectConfigFromObject> {
		const config = structuredClone(raw);
		config.providers = {
			bailian: credentials
				? { api_key: credentials.apiKey, base_url: workspaceBaseUrl(credentials) }
				: { api_key: "kit-mock", base_url: "http://127.0.0.1:1" },
		};
		if (materialize) materializeVaultSecrets(config, (reference) => secrets.get(reference));
		try {
			return await resolveProjectConfigFromObject(config, {
				projectName: id,
				basePath: assetRoot,
				resolveEnv: false,
				textFileReferences: "literal",
			});
		} catch {
			throw new KitError("invalid_request", "批次声明不符合 SDK 契约，请检查资源配置");
		}
	}
	async function diagnostics(raw = snapshot().raw): Promise<ReturnType<typeof validateProjectConfig>> {
		for (const type of Object.keys(sections) as DeclarationType[])
			for (const declaration of Object.values(raw[sections[type]] ?? {})) assertSafeDraftDeclaration(type, declaration);
		const loaded = await resolve(raw);
		return validateProjectConfig(loaded.config);
	}
	async function commit(expected: string, raw: DraftConfig, assets?: DraftAsset[]) {
		assertRevision(expected);
		const errors = (await diagnostics(raw)).filter((item) => item.severity === "error");
		if (errors.length) throw new KitError("invalid_request", "资源声明或引用未通过 SDK 校验，请检查配置");
		return storage.write(expected, stringify(raw), assets ? JSON.stringify(assets) : undefined);
	}
	function declaration(type: DeclarationType, key: string): ResourceDraftDeclaration {
		const current = snapshot();
		const resources = current.raw[sections[type]] ?? {};
		if (!Object.hasOwn(resources, key)) throw new KitError("not_found", "批次声明不存在");
		const readOnly: string[][] = type === "vault" ? [["credentials"]] : [];
		const safe = safeDeclaration(type, resources[key]!, readOnly);
		return {
			type,
			id: key,
			base_revision: current.revision,
			name: String(safe.name ?? safe.display_name ?? key),
			...(type === "agent" && typeof safe.model === "string" ? { model: safe.model } : {}),
			declaration: safe,
			read_only_paths: readOnly,
			references: [],
		};
	}
	const stateBackend: BackendRuntimeInput["stateBackend"] = {
		async read(scope, fn) {
			if (scope.projectId !== id) throw new KitError("not_found", "发布批次不存在");
			return fn(InMemoryStateManager.fromJSON(JSON.parse(storage.read().sdk_state_json) as StateFile));
		},
		async write(scope, fn) {
			if (scope.projectId !== id) throw new KitError("not_found", "发布批次不存在");
			const state = InMemoryStateManager.fromJSON(JSON.parse(storage.read().sdk_state_json) as StateFile, (snapshot) =>
				storage.writeState(JSON.stringify(snapshot)),
			);
			try {
				return await fn(state);
			} finally {
				await state.save();
			}
		},
	};
	return {
		id,
		assetRoot,
		snapshot,
		assertRevision,
		resolve,
		diagnostics,
		commit,
		declaration,
		secrets,
		stateBackend,
		async runtime(materialize = false): Promise<BackendRuntimeInput> {
			return {
				projectName: id,
				config: (await resolve(undefined, materialize)).config,
				configPath: join(assetRoot, "__draft__.yaml"),
				providers: {
					bailian: credentials
						? { api_key: credentials.apiKey, base_url: workspaceBaseUrl(credentials) }
						: { api_key: "kit-mock", base_url: "http://127.0.0.1:1" },
				},
				stateScope: { projectId: id },
				stateBackend,
			};
		},
	};
}
