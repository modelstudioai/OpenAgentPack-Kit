import {
	KitError,
	type RemoteSkill,
	RemoteSkillIdSchema,
	type RemoteSkillSource,
	RemoteSkillSourceSchema,
	RemoteSkillVersionIdSchema,
} from "@openagentpack/kit-sdk/protocol";
import {
	ApiError,
	getRemoteSkill,
	getRemoteSkillVersion,
	listRemoteSkills,
	type ProjectRuntimeContext,
	type ProviderSkillInfo,
	type SkillPage,
	type SkillVersionInfo,
} from "@openagentpack/sdk";
import { redactRemoteDetailText as safeText } from "./remote-detail-redaction.ts";
import type { ProviderGateway } from "./types.ts";

function skillMetadata(info: ProviderSkillInfo): RemoteSkill {
	if (!RemoteSkillIdSchema.safeParse(info.id).success || !RemoteSkillSourceSchema.safeParse(info.source).success)
		throw new KitError("provider_error", "Skill 元数据信息无效，请稍后重试");
	const knownStatus = ["checking", "active", "rejected", "deleted"].includes(info.status);
	const status = knownStatus ? info.status : "checking";
	const version = RemoteSkillVersionIdSchema.safeParse(info.latest_version);
	const name = typeof info.name === "string" && info.name.trim() ? safeText(info.name) : info.id;
	return {
		skill_id: info.id,
		name,
		source: info.source,
		status,
		...(typeof info.description === "string" ? { description: safeText(info.description) } : {}),
		...(version.success ? { latest_version: version.data } : {}),
		available: status === "active" && version.success,
	};
}

function nextSkillPage(page: SkillPage, seenPages: Set<string>) {
	const cursor = page.next_page;
	if (page.has_more && !cursor) throw new KitError("provider_error", "Skill 列表缺少下一页游标，请重试");
	if (cursor && seenPages.has(cursor)) throw new KitError("provider_error", "Skill 列表分页游标重复，请重试");
	if (cursor) seenPages.add(cursor);
	return cursor;
}

function skillVersion(raw: ProviderSkillInfo, detail: SkillVersionInfo, skillId: string, version: string) {
	const metadata = skillMetadata(raw);
	if (metadata.skill_id !== skillId || detail.skill_id !== skillId || detail.version !== version)
		throw new KitError("provider_error", "Skill 版本信息不一致，请稍后重试");
	return {
		skill_id: skillId,
		version,
		source: metadata.source,
		name: typeof detail.name === "string" && detail.name.trim() ? safeText(detail.name) : metadata.name,
		available: metadata.status === "active" && detail.status === "active",
	};
}

async function collectSkills(context: ProjectRuntimeContext, source: RemoteSkillSource): Promise<RemoteSkill[]> {
	const skills = new Map<string, RemoteSkill>();
	const seenPages = new Set<string>();
	let cursor: string | undefined;
	let pages = 0;
	do {
		if (++pages > 1000) throw new KitError("provider_error", "Skill 列表分页过多，请稍后重试");
		const page = await listRemoteSkills(context, { source, limit: 100, ...(cursor ? { page: cursor } : {}) });
		for (const raw of page.data) {
			const skill = skillMetadata(raw);
			if (skill.source !== source) throw new KitError("provider_error", "Skill 列表来源不一致，请稍后重试");
			if (!skills.has(skill.skill_id)) skills.set(skill.skill_id, skill);
		}
		cursor = nextSkillPage(page, seenPages);
	} while (cursor);
	return [...skills.values()];
}

/** 公开 SDK 只读元数据接口；不下载 Skill 正文，不触发创建、扫描或发布。 */
export function createSdkRemoteSkillGateway(
	context: () => Promise<ProjectRuntimeContext>,
): Pick<ProviderGateway, "listRemoteSkills" | "getRemoteSkillVersion"> {
	return {
		async listRemoteSkills(source) {
			if (!RemoteSkillSourceSchema.safeParse(source).success) throw new KitError("invalid_request", "Skill 来源无效");
			try {
				return await collectSkills(await context(), source);
			} catch (error) {
				if (error instanceof KitError) throw error;
				throw new KitError("provider_error", "Skill 列表查询失败，请稍后重试", { retryable: true });
			}
		},
		async getRemoteSkillVersion(skillId, version) {
			if (!RemoteSkillIdSchema.safeParse(skillId).success || !RemoteSkillVersionIdSchema.safeParse(version).success)
				throw new KitError("invalid_request", "Skill ID 或版本无效");
			try {
				const ctx = await context();
				const [raw, detail] = await Promise.all([
					getRemoteSkill(ctx, skillId),
					getRemoteSkillVersion(ctx, skillId, version),
				]);
				return skillVersion(raw, detail, skillId, version);
			} catch (error) {
				if (ApiError.isNotFound(error)) return null;
				if (error instanceof KitError) throw error;
				throw new KitError("provider_error", "Skill 版本查询失败，请稍后重试", { retryable: true });
			}
		},
	};
}
