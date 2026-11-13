import { basename } from "node:path";
import type { DeclarationType } from "@openagentpack/kit-sdk/protocol";
import type { ProjectRuntimeContext, ResourceExecutionResult, ResourcePlanResult } from "@openagentpack/sdk";
import { digest, sections, type YamlDraftDocument } from "./yaml-draft-document.ts";

export interface DraftPublishedResource {
	type: Exclude<DeclarationType, "skill">;
	id: string;
	remote_id: string;
	name: string;
	version?: number;
	memory?: { description: string; entries: { key: string; content: string }[] };
}
export type MockDraftPublisher = (
	resources: DraftPublishedResource[],
	rosters: { agent_id: string; version: number; multiagent: unknown }[],
) => void;
type Reference = { type: DeclarationType; id: string };

export function mockPublicationResult(planned: ResourcePlanResult): ResourceExecutionResult {
	return {
		partial: false,
		outcome: "succeeded",
		mutationStarted: true,
		results: planned.plan.actions
			.filter((action) => action.action !== "no-op")
			.map((action) => {
				const resource = planned.executionContext.state.getResource(action.address);
				return {
					action,
					status: "success",
					...(resource?.remote_id ? { resource: { remoteId: resource.remote_id, version: resource.version } } : {}),
				};
			}),
	};
}

function publishedResource(
	reference: Reference,
	remoteId: string,
	declaration: Record<string, unknown>,
): DraftPublishedResource | undefined {
	if (reference.type === "skill") return undefined;
	const resource: DraftPublishedResource = {
		type: reference.type,
		id: reference.id,
		remote_id: remoteId,
		name:
			reference.type === "file"
				? basename(String(declaration.source))
				: String(declaration.name ?? declaration.display_name ?? reference.id),
	};
	if (reference.type === "agent") resource.version = 1;
	if (reference.type === "memory_store")
		resource.memory = {
			description: String(declaration.description ?? ""),
			entries: (declaration.entries as { key: string; content: string }[]) ?? [],
		};
	return resource;
}

function remoteRoster(value: unknown, context: ProjectRuntimeContext) {
	const roster = value as { agents: (string | { agent_id?: string; type?: string })[] };
	return {
		type: "coordinator",
		agents: roster.agents.map((member) => {
			if (typeof member === "string")
				return {
					type: "agent",
					id: context.state.findResource({ provider: "bailian", type: "agent", name: member })?.remote_id,
				};
			if (member.type === "self") return { type: "self" };
			return { type: "agent", id: member.agent_id };
		}),
	};
}

/** Mock-only remote registry updates use the same declaration, scope and durable state contract. */
export async function executeMockYamlDraft(
	doc: YamlDraftDocument,
	context: ProjectRuntimeContext,
	publish: MockDraftPublisher,
	references: Reference[],
) {
	const prefixes = {
		agent: "agent",
		environment: "env",
		memory_store: "memory",
		vault: "vlt",
		file: "file",
		skill: "skill",
	};
	const { raw } = doc.snapshot();
	const resources: DraftPublishedResource[] = [];
	const rosters: Parameters<MockDraftPublisher>[1] = [];
	for (const reference of references) {
		const remoteId = `${prefixes[reference.type]}_mock_${reference.id}`;
		const declaration = raw[sections[reference.type]]![reference.id]!;
		context.state.setResource({
			address: { provider: "bailian", type: reference.type, name: reference.id },
			remote_id: remoteId,
			content_hash: digest(declaration),
			...(reference.type === "agent" || reference.type === "skill" ? { version: 1 } : {}),
		});
		await context.state.save();
		const resource = publishedResource(reference, remoteId, declaration);
		if (resource) resources.push(resource);
	}
	for (const resource of resources.filter((item) => item.type === "agent")) {
		const multiagent = raw.agents![resource.id]!.multiagent;
		if (multiagent)
			rosters.push({ agent_id: resource.remote_id, version: 1, multiagent: remoteRoster(multiagent, context) });
	}
	publish(resources, rosters);
}
