import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { KitError, type ProjectFileUploadInput, type ProjectSkillUploadInput } from "@openagentpack/kit-sdk/protocol";
import { validateProjectFileUploads } from "./project-file-sources.ts";
import { validateProjectSkillUploads } from "./project-skill-sources.ts";
import type { ProjectSourceFileUpload, ProjectSourceSkillUpload } from "./types.ts";
import { type DraftAsset, digest, type YamlDraftDocument } from "./yaml-draft-document.ts";

async function ordinary(path: string, directory: boolean, create = false) {
	if (create) await mkdir(path, { recursive: true, mode: 0o700 });
	const info = await lstat(path);
	if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()))
		throw new KitError("conflict", "上传暂存路径不安全");
	return info;
}

async function assetPath(root: string, path: string, create = false) {
	const destination = resolve(root, path);
	const within = relative(root, destination);
	if (!within || within.startsWith("..") || isAbsolute(within)) throw new KitError("invalid_request", "上传路径无效");
	await ordinary(dirname(root), true, create);
	await ordinary(root, true, create);
	let parent = root;
	for (const part of relative(root, dirname(destination)).split(sep).filter(Boolean)) {
		parent = resolve(parent, part);
		await ordinary(parent, true, create);
	}
	return destination;
}

/** Verify the reviewed bytes, including Skill members; the YAML itself never lives on disk. */
export async function draftAssetsHash(doc: YamlDraftDocument) {
	const { assets } = doc.snapshot();
	for (const asset of assets) {
		const path = await assetPath(doc.assetRoot, asset.path);
		const info = await ordinary(path, false);
		if (info.size !== asset.size || digest(await readFile(path)) !== asset.sha256)
			throw new KitError("conflict", "上传暂存内容已变化，请重新上传并预览");
	}
	return digest(assets);
}

async function saveAssets(doc: YamlDraftDocument, files: { path: string; bytes: Uint8Array }[]) {
	const written: string[] = [];
	const assets: DraftAsset[] = [];
	try {
		for (const file of files) {
			const path = await assetPath(doc.assetRoot, file.path, true);
			await writeFile(path, file.bytes, { flag: "wx", mode: 0o600 });
			written.push(path);
			assets.push({ path: file.path, sha256: digest(file.bytes), size: file.bytes.byteLength });
		}
	} catch (error) {
		await Promise.all(written.map((path) => rm(path, { force: true })));
		throw error;
	}
	return { assets, rollback: () => Promise.all(written.map((path) => rm(path, { force: true }))) };
}

export function createYamlDraftUploads(doc: YamlDraftDocument) {
	const keys = () =>
		new Set(
			Object.values(doc.snapshot().raw).flatMap((section) =>
				section && typeof section === "object" && !Array.isArray(section) ? Object.keys(section) : [],
			),
		);
	async function filePreview(input: ProjectFileUploadInput, uploads: ProjectSourceFileUpload[]) {
		doc.assertRevision(input.base_revision);
		const files = validateProjectFileUploads(input, uploads, keys());
		return {
			base_revision: input.base_revision,
			before: "{}",
			after: JSON.stringify(files),
			diagnostics: [],
			can_commit: true,
			file_uploads: files,
		};
	}
	async function skillPreview(input: ProjectSkillUploadInput, uploads: ProjectSourceSkillUpload[]) {
		doc.assertRevision(input.base_revision);
		const skills = await validateProjectSkillUploads(input, uploads, keys());
		return {
			base_revision: input.base_revision,
			before: "{}",
			after: JSON.stringify(skills),
			diagnostics: [],
			can_commit: true,
			skill_uploads: skills,
		};
	}
	return {
		filePreview,
		skillPreview,
		async fileCommit(input: ProjectFileUploadInput, uploads: ProjectSourceFileUpload[]) {
			const preview = await filePreview(input, uploads);
			const current = doc.snapshot();
			const saved = await saveAssets(
				doc,
				uploads.map((file) => ({ path: `${file.file_key}/${file.filename}`, bytes: file.bytes })),
			);
			try {
				current.raw.files ??= {};
				for (const file of uploads)
					current.raw.files[file.file_key] = { source: `${file.file_key}/${file.filename}`, purpose: "assistant" };
				const new_revision = await doc.commit(input.base_revision, current.raw, [...current.assets, ...saved.assets]);
				return { new_revision, files: preview.file_uploads };
			} catch (error) {
				await saved.rollback();
				throw error;
			}
		},
		async skillCommit(input: ProjectSkillUploadInput, uploads: ProjectSourceSkillUpload[]) {
			const preview = await skillPreview(input, uploads);
			const current = doc.snapshot();
			const saved = await saveAssets(
				doc,
				uploads.flatMap((skill) =>
					skill.files.map((file) => ({ path: `${skill.skill_key}/${file.path}`, bytes: file.bytes })),
				),
			);
			try {
				current.raw.skills ??= {};
				for (const skill of uploads)
					current.raw.skills[skill.skill_key] = { name: skill.name, source: skill.skill_key, origin: "custom" };
				const new_revision = await doc.commit(input.base_revision, current.raw, [...current.assets, ...saved.assets]);
				return { new_revision, skills: preview.skill_uploads };
			} catch (error) {
				await saved.rollback();
				throw error;
			}
		},
	};
}
