import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { KitError, type ProjectSkillUpload, type ProjectSkillUploadInput } from "@openagentpack/kit-sdk/protocol";
import { inspectSkillSource } from "@openagentpack/sdk";
import JSZip from "jszip";
import { assertProjectFileName } from "./project-file-sources.ts";
import { inspectSkillZipDirectory } from "./project-skill-zip.ts";
import type { ProjectSourceSkillUpload } from "./types.ts";

type SourceFile = { path: string; bytes: Uint8Array };
const maxFileBytes = 8 * 1024 * 1024;
const maxExpandedBytes = 32 * 1024 * 1024;
const invalid = (message: string) => new KitError("invalid_request", message);

/** 通过公开 ZIP 流接口限量解包；在 SDK 检查前就限制路径、文件类型和实际解压量。 */
export async function prepareProjectSkillUpload(filename: string, bytes: Uint8Array) {
	assertProjectFileName(filename);
	if (!bytes.length || bytes.length > maxExpandedBytes) throw invalid("Skill 上传文件为空或超过 32 MiB");
	let files: SourceFile[];
	if (filename.toLowerCase() === "skill.md") {
		if (bytes.length > maxFileBytes) throw invalid("SKILL.md 不能超过 8 MiB");
		files = [{ path: "SKILL.md", bytes: new Uint8Array(bytes) }];
	} else if (filename.toLowerCase().endsWith(".zip")) {
		files = await unpackSkill(bytes);
	} else throw invalid("请上传 ZIP 压缩包或单个 SKILL.md");
	const temporary = await mkdtemp(resolve(tmpdir(), "kit-skill-source-"));
	try {
		await writeSkillFiles(temporary, files);
		let name: string;
		try {
			name = (await inspectSkillSource(temporary)).name;
		} catch {
			throw invalid("SKILL.md 必须包含有效 YAML 头部和非空 name");
		}
		if (name.includes("${") || Buffer.byteLength(name, "utf8") > 240 || /\p{Cc}/u.test(name))
			throw invalid("Skill 名称无效，请检查 SKILL.md 的 name");
		return { name, files };
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

async function unpackSkill(bytes: Uint8Array): Promise<SourceFile[]> {
	const originalPaths = inspectSkillZipDirectory(bytes);
	let zip: JSZip;
	try {
		// checkCRC32 会先无界解压，因此仅使用下面有字节上限的流读取。
		zip = await JSZip.loadAsync(bytes, { createFolders: false });
	} catch {
		throw invalid("ZIP 格式无效或不受支持");
	}
	const entries = Object.values(zip.files);
	if (
		entries.length !== originalPaths.size ||
		entries.some((entry) => !originalPaths.has(entry.unsafeOriginalName ?? entry.name))
	)
		throw invalid("ZIP 文件路径解析不一致");
	if (entries.length > 1000) throw invalid("ZIP 目录项过多");
	const files: SourceFile[] = [];
	let total = 0;
	const paths = new Set<string>();
	for (const entry of entries) {
		assertZipEntry(entry);
		if (entry.dir) continue;
		if (files.length >= 200) throw invalid("每个 Skill 最多包含 200 个文件");
		const folded = entry.name.normalize("NFC").toLowerCase();
		if (paths.has(folded)) throw invalid("ZIP 含重复文件路径");
		paths.add(folded);
		const content = await readZipEntry(entry, Math.min(maxFileBytes, maxExpandedBytes - total));
		total += content.length;
		files.push({ path: entry.name, bytes: content });
	}
	return normalizeRoot(files);
}

function assertZipEntry(entry: JSZip.JSZipObject) {
	const original = entry.unsafeOriginalName ?? entry.name;
	assertSkillPath(original.replace(/\/$/, ""));
	if (original !== entry.name) throw invalid("ZIP 含不安全路径");
	const permissions =
		typeof entry.unixPermissions === "string" ? Number.parseInt(entry.unixPermissions, 8) : entry.unixPermissions;
	const kind = (permissions ?? 0) & 0o170000;
	if (kind && kind !== (entry.dir ? 0o040000 : 0o100000)) throw invalid("ZIP 仅支持普通文件和目录，不能包含符号链接");
}

async function readZipEntry(entry: JSZip.JSZipObject, limit: number): Promise<Buffer> {
	const stream = new Readable().wrap(entry.nodeStream("nodebuffer"));
	const chunks: Buffer[] = [];
	let size = 0;
	try {
		for await (const chunk of stream) {
			const buffer = Buffer.from(chunk);
			size += buffer.length;
			if (size > limit) {
				stream.destroy();
				throw invalid("Skill 解压后单文件不能超过 8 MiB，总大小不能超过 32 MiB");
			}
			chunks.push(buffer);
		}
	} catch (error) {
		if (error instanceof KitError) throw error;
		throw invalid("ZIP 文件内容无效");
	}
	return Buffer.concat(chunks);
}

function assertSkillPath(path: string) {
	if (!path || path.includes(":") || Buffer.byteLength(path, "utf8") > 1024 || path.split("/").length > 16)
		throw invalid("ZIP 文件路径无效");
	for (const part of path.split("/")) assertProjectFileName(part);
}

function normalizeRoot(files: SourceFile[]): SourceFile[] {
	const prefix = files.some((file) => file.path === "SKILL.md") ? "" : `${files[0]?.path.split("/")[0]}/`;
	if (!files.some((file) => file.path === `${prefix}SKILL.md`) || files.some((file) => !file.path.startsWith(prefix)))
		throw invalid("每个 ZIP 必须包含一个 Skill：SKILL.md 位于根目录或单层包装目录");
	const normalized = files.map((file) => ({ ...file, path: file.path.slice(prefix.length) }));
	if (normalized.some((file) => file.path.toLowerCase() === "skill.json"))
		throw invalid("ZIP 不能包含根目录 skill.json；资源声明由项目生成");
	if (normalized.some((file) => file.path !== "SKILL.md" && file.path.endsWith("/SKILL.md")))
		throw invalid("每个 ZIP 只能包含一个 Skill");
	const paths = new Set(normalized.map((file) => file.path.normalize("NFC").toLowerCase()));
	for (const file of normalized) {
		const parts = file.path.normalize("NFC").toLowerCase().split("/");
		for (let index = 1; index < parts.length; index++)
			if (paths.has(parts.slice(0, index).join("/"))) throw invalid("ZIP 文件与目录路径冲突");
	}
	return normalized.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

/** 原始包和归一化文件都属于暂存合同；每次预览/提交复验，不能跨层替换其一。 */
export async function validateProjectSkillUploads(
	input: ProjectSkillUploadInput,
	uploads: ProjectSourceSkillUpload[],
	existingKeys: Set<string>,
) {
	if (
		!input.upload_ids.length ||
		input.upload_ids.length > 20 ||
		new Set(input.upload_ids).size !== input.upload_ids.length ||
		uploads.length !== input.upload_ids.length
	)
		throw invalid("暂存 Skill 列表无效");
	const ids = new Set<string>();
	const keys = new Set<string>();
	for (const upload of uploads) {
		if (
			!input.upload_ids.includes(upload.upload_id) ||
			ids.has(upload.upload_id) ||
			!upload.upload_id ||
			upload.upload_id.length > 128
		)
			throw invalid("暂存 Skill 与提交列表不一致");
		ids.add(upload.upload_id);
		if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(upload.skill_key) || keys.has(upload.skill_key))
			throw invalid("Skill 声明标识无效");
		keys.add(upload.skill_key);
		if (existingKeys.has(upload.skill_key)) throw new KitError("conflict", "资源声明标识已存在，请重新上传");
		await validateSkillUploadContent(upload);
	}
	return uploads.map(({ upload_id, skill_key, filename, name, size, sha256, file_count, expanded_size }) => ({
		upload_id,
		skill_key,
		filename,
		name,
		size,
		sha256,
		file_count,
		expanded_size,
	}));
}

async function validateSkillUploadContent(upload: ProjectSourceSkillUpload) {
	if (
		upload.size !== upload.bytes.byteLength ||
		createHash("sha256").update(upload.bytes).digest("hex") !== upload.sha256
	)
		throw invalid("暂存 Skill 内容校验失败，请重新上传");
	const parsed = await prepareProjectSkillUpload(upload.filename, upload.bytes);
	if (
		parsed.name !== upload.name ||
		parsed.files.length !== upload.file_count ||
		parsed.files.length !== upload.files.length ||
		parsed.files.reduce((sum, file) => sum + file.bytes.length, 0) !== upload.expanded_size ||
		parsed.files.some(
			(file, index) =>
				file.path !== upload.files[index]?.path || !Buffer.from(file.bytes).equals(upload.files[index]!.bytes),
		)
	)
		throw invalid("暂存 Skill 内容校验失败，请重新上传");
}

export function projectSkillMetadata(upload: ProjectSkillUpload) {
	return { id: upload.skill_key, name: upload.name, origin: "custom" as const };
}

export async function assertProjectSkillStorage(root: string) {
	for (const part of [".openagentpack", "skills"]) {
		const details = await lstat(resolve(root, part)).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return null;
			throw error;
		});
		if (details && (!details.isDirectory() || details.isSymbolicLink()))
			throw invalid("Skill 目标必须是项目内普通目录");
	}
}

async function writeSkillFiles(directory: string, files: SourceFile[]) {
	for (const file of files) {
		const path = resolve(directory, file.path);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, file.bytes, { mode: 0o600, flag: "wx" });
	}
}

/** SDK 锁内创建共享 Skill；仅回滚本批新目录，不覆盖已有源码或 Agent。 */
export async function writeProjectSkillSources(root: string, uploads: ProjectSourceSkillUpload[]) {
	await assertProjectSkillStorage(root);
	await mkdir(resolve(root, ".openagentpack"), { recursive: true });
	await mkdir(resolve(root, "skills"), { recursive: true });
	const staging = await mkdtemp(resolve(root, ".openagentpack", `kit-skill-write-${randomUUID()}-`));
	const destinations: string[] = [];
	const rollback = async () => {
		const results = await Promise.allSettled(destinations.map((path) => rm(path, { recursive: true, force: true })));
		if (results.some((result) => result.status === "rejected"))
			throw new KitError("internal", "Skill 保存失败且恢复未完成，请检查项目源码后重试");
	};
	try {
		for (const upload of uploads) {
			const temporary = resolve(staging, upload.skill_key);
			await writeSkillFiles(temporary, upload.files);
			await writeFile(resolve(temporary, "skill.json"), `${JSON.stringify(projectSkillMetadata(upload), null, 2)}\n`, {
				mode: 0o600,
				flag: "wx",
			});
			const destination = resolve(root, "skills", upload.skill_key);
			await mkdir(destination).catch((error: NodeJS.ErrnoException) => {
				if (error.code === "EEXIST") throw new KitError("conflict", "Skill 目标已存在，请重新上传");
				throw error;
			});
			destinations.push(destination);
			await rename(temporary, destination);
		}
		return rollback;
	} catch (error) {
		await rollback();
		throw error;
	} finally {
		await rm(staging, { recursive: true, force: true }).catch(() => undefined);
	}
}
