import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { zipSync } from "fflate";

export interface SkillFrontMatter {
	name: string;
	description: string;
	normalized: string;
	renamed: boolean;
}

/** 百炼规范：name 仅小写字母/数字/连字符 ≤64；不合规时给出规范化名（ingest 用规范化名上传）。 */
export function normalizeSkillName(name: string): { normalized: string; renamed: boolean } {
	const normalized = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
	return { normalized, renamed: normalized !== name };
}

export function parseFrontMatter(skillMd: string): SkillFrontMatter {
	const match = skillMd.match(/^---\n([\s\S]*?)\n---/);
	if (!match) throw new Error("SKILL.md 缺少 YAML front matter（百炼审查必拒）");
	const block = match[1] as string;
	const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim();
	const description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim();
	if (!name || !description) throw new Error("SKILL.md front matter 缺 name 或 description");
	if (description.includes("<") || description.includes(">")) {
		throw new Error("description 含尖括号（百炼规范禁止）");
	}
	const { normalized, renamed } = normalizeSkillName(name);
	return { name, description, normalized, renamed };
}

function walk(dir: string, base: string, out: string[]): void {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, base, out);
		else out.push(relative(base, full));
	}
}

/** 打 zip：根目录直接是文件（百炼要求 zip 根含 SKILL.md）。 */
export function zipSkillDir(dir: string): Uint8Array {
	const root = resolve(dir);
	const files: string[] = [];
	walk(root, root, files);
	if (!files.includes("SKILL.md")) throw new Error(`skill 包根目录缺 SKILL.md：${root}`);
	const entries: Record<string, Uint8Array> = {};
	for (const rel of files.sort()) entries[rel] = new Uint8Array(readFileSync(join(root, rel)));
	return zipSync(entries, { level: 6 });
}

/** skill 内容哈希：排序后的「相对路径+内容」sha256，作为上传复用索引的键。 */
export function skillContentHash(dir: string): string {
	const root = resolve(dir);
	const files: string[] = [];
	walk(root, root, files);
	const hash = createHash("sha256");
	for (const rel of files.sort()) {
		hash.update(rel);
		hash.update("\0");
		hash.update(readFileSync(join(root, rel)));
		hash.update("\0");
	}
	return hash.digest("hex").slice(0, 16);
}
