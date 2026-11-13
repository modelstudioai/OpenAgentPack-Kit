import { cpSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { copyComponentSource, readRegistry, resolveComponentClosure } from "./copy-in.mjs";
import { REPO_ROOT } from "./paths.mjs";

const USAGE = "用法：pnpm kit:add <component> [--dir <project>]";
const args = process.argv.slice(2);
const dirFlag = args.indexOf("--dir");
const projectDir = dirFlag >= 0 ? resolve(args[dirFlag + 1] ?? ".") : process.cwd();
const name = args.find((arg, index) => !arg.startsWith("--") && (dirFlag < 0 || index !== dirFlag + 1));

if (!name || (dirFlag >= 0 && !args[dirFlag + 1])) {
	console.error(USAGE);
	process.exit(1);
}
if (dirFlag < 0 && resolve(projectDir) === REPO_ROOT) {
	console.error("请在生成项目目录执行 pnpm kit:add，或传入 --dir <project>。");
	process.exit(1);
}
if (!existsSync(join(projectDir, "package.json"))) {
	console.error(`目标不是项目目录：${projectDir}`);
	process.exit(1);
}

const chatUiRoot = join(REPO_ROOT, "packages/chat-ui");
const registry = readRegistry(chatUiRoot);
const closure = resolveComponentClosure(registry, name);
if (!closure) {
	console.error(`未知组件：${name}（可选：${Object.keys(registry.components).join(", ")}）`);
	process.exit(1);
}

const targetDir = resolve(projectDir, "src/components/kit");
for (const component of closure) {
	const entry = registry.components[component];
	const to = copyComponentSource(chatUiRoot, entry.file, targetDir);
	console.log(`+ ${to}`);
}
const themeTo = resolve(projectDir, "src/components/kit/theme.css");
if (!existsSync(themeTo)) {
	cpSync(join(chatUiRoot, registry.theme), themeTo);
}
console.log("组件已复制进你的项目，可自由修改；升级时按 docs 的 diff 指引合并。");
