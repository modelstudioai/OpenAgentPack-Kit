import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
	EvalConfigSchema,
	type EvalsJson,
	EvalsJsonSchema,
	type KitJson,
	KitJsonSchema,
	type SkillIndex,
	SkillIndexSchema,
} from "./schema.ts";

/** 社区同构：workspace 放在 skill 包旁边 `<skill-dir>-workspace/`（不进 git）。 */
export function workspaceDirFor(skillDir: string): string {
	return `${resolve(skillDir).replace(/\/+$/, "")}-workspace`;
}

export interface WorkspacePaths {
	root: string;
	evalsJson: string;
	kitJson: string;
	configYml: string;
	filesDir: string;
	indexJson: string;
	runsDir: string;
	skillSnapshot: string;
}

export function workspacePaths(root: string): WorkspacePaths {
	return {
		root,
		evalsJson: join(root, "evals", "evals.json"),
		kitJson: join(root, "evals", "kit.json"),
		configYml: join(root, "evals", "config.yml"),
		filesDir: join(root, "evals", "files"),
		indexJson: join(root, "index.json"),
		runsDir: join(root, "runs"),
		skillSnapshot: join(root, "skill-snapshot"),
	};
}

export function ensureWorkspace(root: string): WorkspacePaths {
	const paths = workspacePaths(root);
	mkdirSync(paths.filesDir, { recursive: true });
	mkdirSync(paths.runsDir, { recursive: true });
	mkdirSync(paths.skillSnapshot, { recursive: true });
	return paths;
}

export function readEvals(paths: WorkspacePaths): EvalsJson {
	return EvalsJsonSchema.parse(JSON.parse(readFileSync(paths.evalsJson, "utf8")));
}
export function writeEvals(paths: WorkspacePaths, evals: EvalsJson): void {
	writeFileSync(paths.evalsJson, `${JSON.stringify(evals, null, 2)}\n`);
}
export function readKit(paths: WorkspacePaths): KitJson {
	return KitJsonSchema.parse(JSON.parse(readFileSync(paths.kitJson, "utf8")));
}
export function writeKit(paths: WorkspacePaths, kit: KitJson): void {
	writeFileSync(paths.kitJson, `${JSON.stringify(kit, null, 2)}\n`);
}
export function readConfig(paths: WorkspacePaths) {
	const raw = existsSync(paths.configYml) ? parseYaml(readFileSync(paths.configYml, "utf8")) : {};
	return EvalConfigSchema.parse(raw ?? {});
}
export function writeConfig(paths: WorkspacePaths, config: unknown): void {
	writeFileSync(paths.configYml, stringifyYaml(config as Record<string, unknown>));
}
export function readIndex(paths: WorkspacePaths): SkillIndex {
	if (!existsSync(paths.indexJson)) return {};
	return SkillIndexSchema.parse(JSON.parse(readFileSync(paths.indexJson, "utf8")));
}
export function writeIndex(paths: WorkspacePaths, index: SkillIndex): void {
	writeFileSync(paths.indexJson, `${JSON.stringify(index, null, 2)}\n`);
}

/** case 集哈希：evals.json + kit.json 的稳定序列化，run manifest 用它锁可比性。 */
export function casesHash(evals: EvalsJson, kit: KitJson): string {
	const stable = JSON.stringify([evals, kit]);
	return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

export function newRunId(): string {
	return `run-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
}

export function runDir(paths: WorkspacePaths, runId: string): string {
	return join(paths.runsDir, runId);
}
