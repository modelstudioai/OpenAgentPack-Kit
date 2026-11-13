import {
	KitError,
	type RemoteSkillReference,
	RemoteSkillReferenceSchema,
	type RemoteSkillSource,
} from "@openagentpack/kit-sdk/protocol";
import type { ProviderGateway } from "../gateway/types.ts";

export function listRemoteSkillCandidates(
	gateway: Pick<ProviderGateway, "listRemoteSkills">,
	source: RemoteSkillSource,
) {
	return gateway.listRemoteSkills(source);
}

/** 仅复核精确版本元数据；本地 Skill 不走此函数，空列表不加载 SDK context 或联网。 */
export async function validateRemoteSkillReferences(
	gateway: Pick<ProviderGateway, "getRemoteSkillVersion">,
	references: readonly RemoteSkillReference[],
): Promise<void> {
	const unique = new Map<string, RemoteSkillReference>();
	for (const reference of references) {
		const parsed = RemoteSkillReferenceSchema.safeParse(reference);
		if (!parsed.success) throw new KitError("invalid_request", "Skill 引用无效，请重新选择明确版本");
		unique.set(JSON.stringify([parsed.data.type, parsed.data.skill_id, parsed.data.version]), parsed.data);
	}
	for (const reference of unique.values()) {
		const detail = await gateway.getRemoteSkillVersion(reference.skill_id, reference.version);
		if (!detail) throw new KitError("not_found", "所选 Skill 或版本不存在，请重新选择");
		if (
			detail.skill_id !== reference.skill_id ||
			detail.version !== reference.version ||
			detail.source !== reference.type
		)
			throw new KitError("invalid_request", "所选 Skill 的来源或版本不匹配，请重新选择");
		if (!detail.available) throw new KitError("invalid_request", "所选 Skill 版本尚未生效或已不可用");
	}
}
