import { readFileSync } from "node:fs";
import {
	createSkillFromFileId,
	getRemoteSkill,
	getRemoteSkillVersion,
	listRemoteSkills,
	listRemoteSkillVersions,
	type ProjectRuntimeContext,
	uploadFile,
} from "@openagentpack/sdk";
import type { SkillIndex } from "./schema.ts";
import { parseFrontMatter, skillContentHash, zipSkillDir } from "./skillpack.ts";
import { readIndex, type WorkspacePaths, writeIndex } from "./workspace.ts";

export interface IngestResult {
	skill_id: string;
	version: string;
	name: string;
	source_hash: string;
	reused: boolean;
	review_seconds: number;
}

export class SkillIngestError extends Error {
	constructor(
		message: string,
		readonly code: "name_conflict" | "review_timeout" | "rejected" | "upload" = "upload",
	) {
		super(message);
		this.name = "SkillIngestError";
	}
}

/** 审查轮询：给了 version 就按版本状态查，否则按 skill 状态查并回填 latest_version。 */
async function waitReview(
	ctx: ProjectRuntimeContext,
	skillId: string,
	initialVersion: string,
	timeoutMs: number,
	onStatus?: (status: string, seconds: number) => void,
): Promise<{ status: string; version: string }> {
	const started = Date.now();
	let status = "";
	let version = initialVersion;
	while (Date.now() - started < timeoutMs) {
		if (version) {
			const vinfo = (await getRemoteSkillVersion(ctx, skillId, version)) as { status?: string };
			status = String(vinfo.status ?? "");
		} else {
			const info = (await getRemoteSkill(ctx, skillId)) as { status?: string; latest_version?: string };
			status = String(info.status ?? "");
			version = String(info.latest_version ?? version);
		}
		onStatus?.(status, Math.round((Date.now() - started) / 1000));
		if (status === "active") return { status, version };
		if (status === "rejected") {
			throw new SkillIngestError("skill 审查被拒（rejected），看百炼控制台审查意见", "rejected");
		}
		await new Promise((r) => setTimeout(r, 10_000));
	}
	throw new SkillIngestError(`skill 审查超时（${Math.round(timeoutMs / 1000)}s 仍 ${status}）`, "review_timeout");
}

/** 该 skill 是否已有审查中的版本（中断恢复/并发竞态用）。 */
async function checkingVersionOf(ctx: ProjectRuntimeContext, skillId: string): Promise<string | null> {
	const page = (await listRemoteSkillVersions(ctx, skillId, { limit: 5 })) as {
		data?: { version: string; status?: string }[];
	};
	return (page.data ?? []).find((v) => v.status === "checking")?.version ?? null;
}

/** 撞名迭代：找到同名 skill → POST /skills/{id}/versions 上传新版本 → 返回新版本号。 */
async function uploadNewVersion(
	ctx: ProjectRuntimeContext,
	rest: IngestRest,
	zip: Uint8Array,
	name: string,
	options: { onStatus?: (status: string, seconds: number) => void },
): Promise<{ skill_id: string; version: string }> {
	const page = (await listRemoteSkills(ctx, { limit: 100 })) as { data?: { id: string; name?: string }[] };
	const existing = (page.data ?? []).find((sk) => sk.name === name);
	if (!existing) throw new SkillIngestError(`撞名但找不到同名 skill：${name}`, "name_conflict");
	const pending = await checkingVersionOf(ctx, existing.id);
	if (pending) {
		// 上次被中断的 run 留下的审查中版本：内容同源时直接等它，避免 11300023 死锁
		options.onStatus?.(`reuse checking version ${pending}`, 0);
		return { skill_id: existing.id, version: pending };
	}
	const file = (await uploadFile(ctx, zip, `${name}.zip`)) as { id: string };
	const res = await fetch(`${rest.base}/skills/${existing.id}/versions`, {
		method: "POST",
		headers: rest.headers,
		body: JSON.stringify({ file_id: file.id }),
	});
	if (!res.ok) {
		const detail = (await res.text()).slice(0, 160);
		if (detail.includes("11300023")) {
			const racing = await checkingVersionOf(ctx, existing.id);
			if (racing) return { skill_id: existing.id, version: racing };
		}
		throw new SkillIngestError(`上传新版本失败 HTTP ${res.status}: ${detail}`);
	}
	const body = (await res.json()) as { version?: string; id?: string; data?: { version?: string } };
	let version = String(body.version ?? body.data?.version ?? "");
	if (!version) {
		// 响应形状未带 version 时回查版本列表（newest first）兜底
		const page = (await listRemoteSkillVersions(ctx, existing.id, { limit: 1 })) as {
			data?: { version: string }[];
		};
		version = String(page.data?.[0]?.version ?? "");
	}
	if (!version) throw new SkillIngestError("上传新版本成功但未返回 version（回查版本列表亦空）");
	options.onStatus?.(`version ${version} checking`, 0);
	return { skill_id: existing.id, version };
}

/** upload → create；外层重试吃文件就绪竞态（SDK 内置 4 次之外的兜底），撞名直接翻译成可执行错误。 */
async function createWithRetry(ctx: ProjectRuntimeContext, zip: Uint8Array, name: string): Promise<string> {
	let lastError = "";
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const file = (await uploadFile(ctx, zip, `${name}.zip`)) as { id: string };
			const skill = (await createSkillFromFileId(ctx, file.id)) as { id: string };
			return skill.id;
		} catch (e) {
			lastError = (e as Error).message;
			if (lastError.includes("11300025") || lastError.includes("相同SkillName")) {
				throw new SkillIngestError(
					`skill 名称撞名（百炼 11300025）：${name}。改 SKILL.md 的 name 后重跑`,
					"name_conflict",
				);
			}
			if (attempt < 2) await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
		}
	}
	throw new SkillIngestError(`skill 创建失败：${lastError.slice(0, 200)}`);
}

/**
 * ingest：内容哈希命中索引则直接复用（审查分钟级，绝不每 run 重等）；
 * 未命中则 zip → upload → create（外层再包重试吃文件就绪竞态）→ 有界轮询审查终态。
 */
export interface IngestRest {
	base: string;
	headers: Record<string, string>;
}

export async function ingestSkill(
	ctx: ProjectRuntimeContext,
	paths: WorkspacePaths,
	skillDir: string,
	options: { reviewTimeoutMs: number; rest: IngestRest; onStatus?: (status: string, seconds: number) => void },
): Promise<IngestResult> {
	const hash = skillContentHash(skillDir);
	const index: SkillIndex = readIndex(paths);
	const hit = index[hash];
	if (hit) {
		// 版本级状态为准：skill 级 status 会被其它审查中版本带成 checking（探针实测）
		const vinfo = (await getRemoteSkillVersion(ctx, hit.skill_id, hit.version)) as { status?: string };
		if (vinfo.status === "active") {
			return { ...hit, source_hash: hash, reused: true, review_seconds: 0 };
		}
	}
	const fm = parseFrontMatter(readFileSync(`${skillDir}/SKILL.md`, "utf8"));
	const zip = zipSkillDir(skillDir);
	let skillId = "";
	let version = "";
	try {
		skillId = await createWithRetry(ctx, zip, fm.normalized);
	} catch (e) {
		// 撞名 = 迭代场景：同名 skill 已存在 → 上传新版本（钉新版本号），不是错误
		if ((e as SkillIngestError).code !== "name_conflict") throw e;
		const upgraded = await uploadNewVersion(ctx, options.rest, zip, fm.normalized, options);
		skillId = upgraded.skill_id;
		version = upgraded.version;
	}
	const reviewStarted = Date.now();
	const reviewed = await waitReview(ctx, skillId, version, options.reviewTimeoutMs, options.onStatus);
	version = reviewed.version;
	const next: SkillIndex = {
		...index,
		[hash]: { skill_id: skillId, version, name: fm.normalized, uploaded_at: new Date().toISOString() },
	};
	writeIndex(paths, next);
	return {
		skill_id: skillId,
		version,
		name: fm.normalized,
		source_hash: hash,
		reused: false,
		review_seconds: Math.round((Date.now() - reviewStarted) / 1000),
	};
}
