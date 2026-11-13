import {
	KitError,
	type RemoteSkill,
	RemoteSkillIdSchema,
	RemoteSkillVersionIdSchema,
} from "@openagentpack/kit-sdk/protocol";
import type { ProviderGateway } from "./types.ts";

const skills: RemoteSkill[] = [
	{
		skill_id: "skill_mock_research",
		name: "资料研究",
		source: "official",
		status: "active",
		latest_version: "1.0",
		available: true,
	},
	{
		skill_id: "skill_mock_analysis",
		name: "数据分析",
		source: "custom",
		status: "active",
		latest_version: "2.0",
		available: true,
	},
	{
		skill_id: "skill_mock_checking",
		name: "扫描中的技能",
		source: "custom",
		status: "checking",
		latest_version: "1.0",
		available: false,
	},
];

export function createMockRemoteSkillGateway(): Pick<ProviderGateway, "listRemoteSkills" | "getRemoteSkillVersion"> {
	return {
		async listRemoteSkills(source) {
			return skills.filter((skill) => skill.source === source).map((skill) => ({ ...skill }));
		},
		async getRemoteSkillVersion(skillId, version) {
			if (!RemoteSkillIdSchema.safeParse(skillId).success || !RemoteSkillVersionIdSchema.safeParse(version).success)
				throw new KitError("invalid_request", "Skill ID 或版本无效");
			const skill = skills.find((entry) => entry.skill_id === skillId);
			if (!skill || !(skill.latest_version === version || (skillId === "skill_mock_analysis" && version === "1.0")))
				return null;
			return { skill_id: skillId, version, name: skill.name, source: skill.source, available: skill.available };
		},
	};
}
