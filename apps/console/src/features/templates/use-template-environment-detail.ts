import { ProjectEnvironmentNetworkingSchema, type RemoteEnvironmentDetail } from "@openagentpack/kit-sdk/protocol";
import { useMemo } from "react";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import type { TemplateEnvironmentSelection } from "./template-local-resources.tsx";

const object = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function localPackages(value: unknown) {
	const supported: NonNullable<RemoteEnvironmentDetail["configuration"]["packages"]> = {};
	let restricted = false;
	for (const [key, items] of Object.entries(object(value))) {
		if (
			!["apt", "pip", "npm", "go", "cargo", "gem"].includes(key) ||
			!Array.isArray(items) ||
			!items.every((item) => typeof item === "string")
		)
			restricted = true;
		else supported[key as keyof typeof supported] = items;
	}
	return { supported, restricted };
}

function localDetail(
	environment: TemplateEnvironmentSelection,
	value: Record<string, unknown>,
): RemoteEnvironmentDetail {
	const config = object(value.config);
	const packages = localPackages(config.packages);
	const networking = ProjectEnvironmentNetworkingSchema.safeParse(config.networking);
	const restricted = new Set<NonNullable<RemoteEnvironmentDetail["copy_restricted_fields"]>[number]>();
	if (Object.keys(value).some((key) => !["id", "name", "description", "config", "metadata", "provider"].includes(key)))
		restricted.add("configuration");
	if (Object.keys(config).some((key) => !["type", "packages", "networking"].includes(key)))
		restricted.add("configuration");
	if (config.networking != null && !networking.success) restricted.add("configuration.networking");
	if (packages.restricted) restricted.add("configuration.packages");
	const metadata = Object.entries(object(value.metadata));
	if (metadata.some(([, item]) => typeof item !== "string")) restricted.add("metadata");
	return {
		environment_id: environment.environment_id,
		name: typeof value.name === "string" ? value.name : environment.name,
		description: typeof value.description === "string" ? value.description : undefined,
		metadata: Object.fromEntries(metadata.filter((entry): entry is [string, string] => typeof entry[1] === "string")),
		configuration: {
			type: typeof config.type === "string" ? config.type : undefined,
			packages: packages.supported,
			...(networking.success ? { networking: networking.data } : {}),
		},
		copy_restricted_fields: [...restricted],
	};
}

/** 未覆盖的声明字段保留为只读，避免复制时丢失。 */
export function useTemplateEnvironmentDetail(environment: TemplateEnvironmentSelection | null, revision = 0) {
	const client = useMemo(getAdminClient, []);
	return useAdminQuery<RemoteEnvironmentDetail>(
		`templates:environment-form:${environment?.environment_id}:${revision}`,
		async (signal) => {
			if (!environment) throw new Error("请选择环境");
			if (!environment.local) return client.remoteEnvironment(environment.environment_id, signal);
			const source = await client.draftResources.declaration(
				environment.local.projectName,
				"environment",
				environment.local.id,
				signal,
			);
			return localDetail(environment, source.declaration);
		},
		{ enabled: Boolean(environment) },
	);
}
