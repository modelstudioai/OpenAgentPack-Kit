import { ProjectEnvironmentNetworkingSchema, type RemoteEnvironmentDetail } from "@openagentpack/kit-sdk/protocol";
import type { CloudEnvironment } from "@openagentpack/sdk";
import { redactRemoteDetailText } from "./remote-detail-redaction.ts";

const sensitiveMetadataKey =
	/(?:token|secret|password|credential|api[_-]?key|access[_-]?key|private[_-]?key|cookie|authorization|authentication|(?:^|[_-])auth(?:$|[_-])|signature|headers?)/i;

function object(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
	return typeof value === "string" ? redactRemoteDetailText(value) : undefined;
}

function strings(value: unknown): string[] | undefined {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string").map(redactRemoteDetailText)
		: undefined;
}

function metadata(value: unknown): Record<string, string> {
	return Object.fromEntries(
		Object.entries(object(value))
			.filter((entry): entry is [string, string] => typeof entry[1] === "string")
			.map(([key, entry]) => [
				redactRemoteDetailText(key),
				sensitiveMetadataKey.test(key) ? "[redacted]" : redactRemoteDetailText(entry),
			]),
	);
}

function packageProjectionChanged(source: unknown, projected: RemoteEnvironmentDetail["configuration"]["packages"]) {
	return Object.entries(object(source)).some(
		([key, value]) =>
			!["apt", "pip", "npm", "go", "cargo", "gem"].includes(key) ||
			!Array.isArray(value) ||
			value.some((item) => typeof item !== "string") ||
			JSON.stringify(value) !== JSON.stringify(projected?.[key as keyof NonNullable<typeof projected>]),
	);
}

function networkingProjectionChanged(
	source: unknown,
	projected: RemoteEnvironmentDetail["configuration"]["networking"],
) {
	if (source == null) return false;
	// Provider 用 null 表示未设置；SDK 声明省略这些可选字段，不能据此判断为配置丢失。
	const normalized = Object.fromEntries(Object.entries(object(source)).filter(([, value]) => value != null));
	const original = ProjectEnvironmentNetworkingSchema.safeParse(normalized);
	const visible = ProjectEnvironmentNetworkingSchema.safeParse(projected);
	return !original.success || !visible.success || JSON.stringify(original.data) !== JSON.stringify(visible.data);
}

function copyRestrictedFields(environment: CloudEnvironment, detail: RemoteEnvironmentDetail) {
	const config = object(environment.config);
	const restricted = new Set<NonNullable<RemoteEnvironmentDetail["copy_restricted_fields"]>[number]>();
	// 展示投影可能移除 URL 查询等内容，必须由原值标记损失，不能让页面仅靠占位符推断。
	if (environment.name && detail.name !== environment.name) restricted.add("name");
	if (environment.description != null && detail.description !== environment.description) restricted.add("description");
	if (JSON.stringify(detail.metadata) !== JSON.stringify(environment.metadata)) restricted.add("metadata");
	if (config.type && config.type !== "cloud") restricted.add("configuration.type");
	const supported = new Set(["type", "packages", "networking"]);
	const paths = {
		environment_variables: "configuration.environment_variables",
		setup_script: "configuration.setup_script",
	} as const;
	for (const key of Object.keys(config)) {
		if (supported.has(key) || config[key] == null || config[key] === "") continue;
		restricted.add(Object.hasOwn(paths, key) ? paths[key as keyof typeof paths] : "configuration");
	}
	if (packageProjectionChanged(config.packages, detail.configuration.packages))
		restricted.add("configuration.packages");
	if (networkingProjectionChanged(config.networking, detail.configuration.networking))
		restricted.add("configuration.networking");
	return [...restricted];
}

/** 每层白名单投影；metadata 逐项脱敏，attributes 只允许补充已知包构建状态。 */
export function environmentDetail(environment: CloudEnvironment): RemoteEnvironmentDetail {
	const config = object(environment.config);
	const networking = object(config.networking);
	const packages = object(config.packages);
	const variables = object(config.environment_variables);
	// 当前 SDK 未将此字段提升到 CloudEnvironment；其公开 attributes 中保留 Provider 响应。
	const packageStatus = environment.attributes?.package_status;
	const detail: RemoteEnvironmentDetail = {
		environment_id: environment.id,
		name: text(environment.name) || environment.id,
		description: text(environment.description),
		metadata: environment.metadata ? metadata(environment.metadata) : undefined,
		package_status: packageStatus === "building" || packageStatus === "ready" ? packageStatus : undefined,
		scope: text(environment.scope),
		version:
			typeof environment.version === "number" && Number.isSafeInteger(environment.version) && environment.version > 0
				? environment.version
				: undefined,
		type: text(environment.type),
		created_at: text(environment.created_at),
		updated_at: text(environment.updated_at),
		configuration: {
			type: text(config.type),
			networking: config.networking
				? {
						type: text(networking.type),
						allow_mcp_servers:
							typeof networking.allow_mcp_servers === "boolean" ? networking.allow_mcp_servers : undefined,
						allow_package_managers:
							typeof networking.allow_package_managers === "boolean" ? networking.allow_package_managers : undefined,
						allowed_hosts: strings(networking.allowed_hosts),
					}
				: undefined,
			packages: config.packages
				? {
						apt: strings(packages.apt),
						pip: strings(packages.pip),
						npm: strings(packages.npm),
						go: strings(packages.go),
						cargo: strings(packages.cargo),
						gem: strings(packages.gem),
					}
				: undefined,
			environment_variables: config.environment_variables
				? Object.fromEntries(
						Object.keys(variables)
							.filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
							.map((key) => [key, "[redacted]" as const]),
					)
				: undefined,
			setup_script: typeof config.setup_script === "string" && config.setup_script ? "[redacted]" : undefined,
		},
	};
	detail.copy_restricted_fields = copyRestrictedFields(environment, detail);
	return detail;
}
