import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createArchive } from "./archive.mjs";
import { filesUnder, repositoryRoot, skillNames, skillOutputRoot, syncSkills } from "./generate.mjs";

export function packSkills({ root = repositoryRoot, output = resolve(root, "assets/skills/dist"), docs = false } = {}) {
	syncSkills({ root });
	mkdirSync(output, { recursive: true });
	const names = skillNames(root);
	const allFiles = [];
	for (const name of names) {
		const directory = skillOutputRoot(root, name);
		const files = filesUnder(directory).map((file) => ({
			path: `${name}/${relative(directory, file)}`,
			content: readFileSync(file),
			mtimeMs: statSync(file).mtimeMs,
		}));
		allFiles.push(...files);
		writeFileSync(resolve(output, `${name}.tgz`), createArchive(files));
	}
	writeFileSync(resolve(output, "kit-skills.tgz"), createArchive(allFiles));
	if (docs) {
		const publicDirectory = resolve(root, "apps/storybook/public/skills");
		rmSync(publicDirectory, { recursive: true, force: true });
		mkdirSync(publicDirectory, { recursive: true });
		for (const name of names)
			cpSync(skillOutputRoot(root, name), resolve(publicDirectory, name), {
				recursive: true,
				preserveTimestamps: true,
			});
		for (const name of [...names, "kit-skills"])
			cpSync(resolve(output, `${name}.tgz`), resolve(publicDirectory, `${name}.tgz`));
	}
	return { skills: names.length, output };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const result = packSkills({ docs: process.argv.includes("--docs") });
		process.stdout.write(`Packed ${result.skills} Skills into ${relative(repositoryRoot, result.output)}.\n`);
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		process.exitCode = 1;
	}
}
