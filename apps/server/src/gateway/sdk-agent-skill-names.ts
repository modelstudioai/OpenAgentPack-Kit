import { type CloudAgent, getRemoteSkill, getRemoteSkillVersion, type ProjectRuntimeContext } from "@openagentpack/sdk";
import { redactRemoteDetailText as safeText } from "./remote-detail-redaction.ts";

interface SkillReference {
	id: string;
	version?: string;
	key: string;
}

interface SkillDisplayMeta {
	name?: string;
	description?: string;
}

function object(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function nonempty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function reference(value: unknown): SkillReference | undefined {
	const skill = object(value);
	// Kit 的纯字符串是声明名称，不是远端 ID；SDK 将 ID 直接拼进请求路径。
	const id = skill.skill_id ?? skill.skillId ?? skill.id;
	if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) return;
	const rawVersion = skill.version;
	if (rawVersion == null) return { id, key: JSON.stringify([id]) };
	const version =
		typeof rawVersion === "string"
			? rawVersion
			: typeof rawVersion === "number" && Number.isFinite(rawVersion) && rawVersion > 0
				? String(rawVersion)
				: undefined;
	// 具体版本不得退化成 latest；拒绝点路径，避免 URL 规范化变成其它查询。
	if (!version || version === "latest" || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version)) return;
	return { id, version, key: JSON.stringify([id, version]) };
}

async function readMeta(
	context: Promise<ProjectRuntimeContext>,
	ref: SkillReference,
): Promise<SkillDisplayMeta | undefined> {
	try {
		if (ref.version !== undefined) {
			const detail = await getRemoteSkillVersion(await context, ref.id, ref.version);
			if (detail.skill_id !== ref.id || String(detail.version) !== ref.version) return;
			return {
				...(nonempty(detail.name) ? { name: safeText(detail.name) } : {}),
				...(nonempty(detail.description) ? { description: safeText(detail.description) } : {}),
			};
		}
		const detail = await getRemoteSkill(await context, ref.id);
		if (detail.id !== ref.id) return;
		return {
			...(nonempty(detail.name) ? { name: safeText(detail.name) } : {}),
			...(nonempty(detail.description) ? { description: safeText(detail.description) } : {}),
		};
	} catch {
		// 元数据补全失败不阻断详情投影，不查询最新版替代明确绑定的 Skill 版本。
		return;
	}
}

/** 补缺失的 Skill 展示名；成员侧资源投影（descriptions）另补脱敏后的描述供选择器展示，
 *  管理端历史配置保持只补名称（不从补全请求复制描述）。输出仍须进入原有脱敏投影。 */
export async function withAgentSkillDisplayMeta(
	agent: CloudAgent,
	context: () => Promise<ProjectRuntimeContext>,
	options?: { descriptions?: boolean },
): Promise<CloudAgent> {
	const withDescriptions = options?.descriptions === true;
	const skills = agent.skills ?? object(agent.attributes?.config).skills;
	if (!Array.isArray(skills)) return agent;
	const entries = skills.map((skill) => {
		const ref = reference(skill);
		if (!ref) return null;
		const record = object(skill);
		const hasName = [record.name, record.skill_name, record.skillName].some(
			(name) => nonempty(name) && name.trim() !== ref.id,
		);
		const hasDescription = nonempty(record.description);
		return (hasName ? withDescriptions && !hasDescription : true) ? { ref, hasName, hasDescription } : null;
	});
	const requests = [
		...new Map(entries.filter((entry) => entry !== null).map((entry) => [entry.ref.key, entry.ref])).values(),
	];
	if (!requests.length) return agent;
	const metas = new Map<string, SkillDisplayMeta>();
	const ctx = context();
	// 同次详情请求内按 ID/version 去重，最多同时读取四个 Skill 元数据。
	for (let start = 0; start < requests.length; start += 4) {
		await Promise.all(
			requests.slice(start, start + 4).map(async (ref) => {
				const meta = await readMeta(ctx, ref);
				if (meta && (meta.name || meta.description)) metas.set(ref.key, meta);
			}),
		);
	}
	if (!metas.size) return agent;
	return {
		...agent,
		skills: skills.map((skill, index) => {
			const entry = entries[index];
			const meta = entry && metas.get(entry.ref.key);
			if (!meta) return skill;
			return {
				...object(skill),
				...(!entry.hasName && meta.name ? { name: meta.name } : {}),
				...(withDescriptions && !entry.hasDescription && meta.description ? { description: meta.description } : {}),
			};
		}),
	};
}
