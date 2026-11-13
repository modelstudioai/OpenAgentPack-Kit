import {
	type ProjectEnvironmentCreateInput,
	ProjectEnvironmentCreateInputSchema,
	ProjectEnvironmentNetworkingSchema,
	type RemoteEnvironmentDetail,
} from "@openagentpack/kit-sdk/protocol";

export const ENVIRONMENT_PACKAGE_MANAGERS = ["apt", "npm", "pip", "go", "cargo", "gem"] as const;
export interface EnvironmentCreateDraft {
	name: string;
	description: string;
	networking?: ProjectEnvironmentCreateInput["networking"];
	/** 主机编辑框原文，提交时转换，避免换行/空格被即时过滤影响输入。 */
	networkingHosts?: string;
	packages: { id: string; manager: (typeof ENVIRONMENT_PACKAGE_MANAGERS)[number]; value: string }[];
	metadata: { id: string; key: string; value: string }[];
}

export function createEnvironmentDraft(detail?: RemoteEnvironmentDetail): EnvironmentCreateDraft {
	const packages = ENVIRONMENT_PACKAGE_MANAGERS.flatMap((manager) =>
		(detail?.configuration.packages?.[manager] ?? []).map((value) => ({ id: crypto.randomUUID(), manager, value })),
	);
	const metadata = Object.entries(detail?.metadata ?? {}).map(([key, value]) => ({
		id: crypto.randomUUID(),
		key,
		value,
	}));
	const networking = ProjectEnvironmentNetworkingSchema.safeParse(detail?.configuration.networking);
	return {
		name: detail?.name ?? "",
		description: detail?.description ?? "",
		...(networking.success ? { networking: networking.data } : {}),
		packages: packages.length ? packages : [{ id: crypto.randomUUID(), manager: "apt", value: "" }],
		metadata: metadata.length ? metadata : [{ id: crypto.randomUUID(), key: "", value: "" }],
	};
}

function metadataInput(rows: EnvironmentCreateDraft["metadata"]) {
	const metadata = new Map<string, string>();
	for (const row of rows) {
		const key = row.key.trim();
		if (!key && !row.value.trim()) continue;
		if (!key) throw new Error("请填写元数据键");
		if (metadata.has(key)) throw new Error("元数据键不可重复");
		metadata.set(key, row.value.trim());
	}
	return metadata;
}

function networkingInput(draft: EnvironmentCreateDraft) {
	if (!draft.networking || draft.networkingHosts === undefined) return draft.networking;
	const allowed_hosts = draft.networkingHosts
		.split(/[\n,，]/)
		.map((host) => host.trim())
		.filter(Boolean);
	const { allowed_hosts: originalHosts, ...networking } = draft.networking;
	return allowed_hosts.length || originalHosts !== undefined ? { ...networking, allowed_hosts } : networking;
}

export function environmentFormInput(draft: EnvironmentCreateDraft, revision: string): ProjectEnvironmentCreateInput {
	const packages: NonNullable<ProjectEnvironmentCreateInput["packages"]> = {};
	for (const row of draft.packages) {
		if (!row.value.trim()) continue;
		packages[row.manager] ??= [];
		packages[row.manager]?.push(...row.value.trim().split(/\s+/));
	}
	const metadata = metadataInput(draft.metadata);
	const networking = networkingInput(draft);
	const parsed = ProjectEnvironmentCreateInputSchema.safeParse({
		base_revision: revision,
		name: draft.name,
		...(networking ? { networking } : {}),
		...(draft.description.trim() ? { description: draft.description.trim() } : {}),
		...(Object.keys(packages).length ? { packages } : {}),
		...(metadata.size ? { metadata: Object.fromEntries(metadata) } : {}),
	});
	if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "请检查环境配置");
	return parsed.data;
}

export function environmentValidationError(draft: EnvironmentCreateDraft): string | undefined {
	try {
		environmentFormInput(draft, "draft");
	} catch (error) {
		return error instanceof Error ? error.message : "请检查环境配置";
	}
}

/** 排除空行、行 ID 和行顺序；还原原配置后继续复用原环境。 */
export function environmentDraftFingerprint(draft: EnvironmentCreateDraft) {
	const networking = networkingInput(draft);
	const parsed = ProjectEnvironmentNetworkingSchema.safeParse(networking);
	return JSON.stringify({
		name: draft.name.trim(),
		description: draft.description.trim(),
		networking: parsed.success ? parsed.data : networking,
		packages: ENVIRONMENT_PACKAGE_MANAGERS.map((manager) => [
			manager,
			draft.packages
				.filter((row) => row.manager === manager)
				.flatMap((row) => row.value.trim().split(/\s+/))
				.filter(Boolean)
				.sort(),
		]),
		metadata: draft.metadata
			.filter((row) => row.key.trim() || row.value.trim())
			.map((row) => [row.key.trim(), row.value.trim()])
			.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
	});
}

export function environmentCopyIssues(detail: RemoteEnvironmentDetail): string[] {
	const issues = new Set<string>(detail.copy_restricted_fields ?? []);
	const config = detail.configuration;
	if (config.type && config.type !== "cloud") issues.add("configuration.type");
	if (config.networking && !ProjectEnvironmentNetworkingSchema.safeParse(config.networking).success)
		issues.add("configuration.networking");
	if (Object.keys(config.environment_variables ?? {}).length) issues.add("configuration.environment_variables");
	if (config.setup_script) issues.add("configuration.setup_script");
	for (const [field, value] of Object.entries({
		name: detail.name,
		description: detail.description,
		metadata: detail.metadata,
		packages: config.packages,
		networking: config.networking,
	})) {
		if (JSON.stringify(value)?.includes("[redacted]"))
			issues.add(["packages", "networking"].includes(field) ? `configuration.${field}` : field);
	}
	return [...issues];
}

export function environmentFormDeclaration(input: ProjectEnvironmentCreateInput, source: Record<string, unknown>) {
	const { base_revision: _, packages, networking, ...fields } = input;
	const next = { ...source };
	delete next.description;
	delete next.metadata;
	return {
		...next,
		...fields,
		config: { type: "cloud", ...(packages ? { packages } : {}), ...(networking ? { networking } : {}) },
	};
}
