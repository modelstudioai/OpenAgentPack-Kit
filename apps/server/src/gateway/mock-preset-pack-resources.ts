import type { PresetPackAgentResources } from "@openagentpack/kit-sdk/protocol";
import { mergePresetPackResources, presetPackResource } from "./preset-pack-resources.ts";
import type { GatewayCreateSessionInput } from "./types.ts";

export interface MockInspectableSession {
	id: string;
	status: string;
	agent_id: string;
	bindings: GatewayCreateSessionInput;
	resources: Map<string, { fileId: string; mountPath: string }>;
}

export function mockPresetPackResources(
	agentId: string,
	sessions: Iterable<MockInspectableSession>,
): PresetPackAgentResources {
	return {
		agent_id: agentId,
		complete: true,
		sessions: [...sessions]
			.filter((session) => session.agent_id === agentId)
			.map((session) => {
				const references: Record<string, unknown>[] = (session.bindings.memoryStores ?? []).map((store) => ({
					type: "memory_store",
					...store,
				}));
				if (session.bindings.environmentId)
					references.push({ type: "environment", environment_id: session.bindings.environmentId });
				for (const id of session.bindings.vaultIds ?? []) references.push({ type: "vault", vault_id: id });
				return {
					session_id: session.id,
					status: session.status,
					resources: mergePresetPackResources([
						...references.map((resource) => presetPackResource(resource, "session")),
						...[...session.resources].map(([id, resource]) =>
							presetPackResource(
								{ type: "file", id, file_id: resource.fileId, mount_path: resource.mountPath },
								"runtime",
							),
						),
					]),
				};
			}),
	};
}
