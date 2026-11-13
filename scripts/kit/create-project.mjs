import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REPO_ROOT } from "./paths.mjs";

const USAGE = "用法：pnpm kit:create <dir> [--kit <repo>]";

/** kit 包未发布期间：写 kit.repo.json 供 vite 别名，并把 tsconfig 的 __KIT__ 占位替换为绝对路径。 */
function writeKitRepoPointer(dest, kitRepo) {
	writeFileSync(join(dest, "kit.repo.json"), `${JSON.stringify({ path: kitRepo }, null, 2)}\n`);
	const tsconfigPath = join(dest, "tsconfig.json");
	const tsconfig = readFileSync(tsconfigPath, "utf8").replaceAll('"../../packages/', `"${kitRepo}/packages/`);
	writeFileSync(tsconfigPath, tsconfig);
}

/**
 * 让生成项目里的 Tailwind 能扫到 kit-chat-ui 的工具类：追加一条指向 kit 仓库源码的绝对路径
 * `@source`。缺了它，生成的体验页会「class 写了但 CSS 没生成」（静默无样式）。
 */
function appendChatUiSource(dest, kitRepo) {
	const stylesPath = join(dest, "src", "styles.css");
	if (!existsSync(stylesPath)) return;
	const css = readFileSync(stylesPath, "utf8");
	const marker = "/* kit-chat-ui source (pnpm kit:create) */";
	if (css.includes(marker)) return;
	const line = `${marker}\n@source "${join(kitRepo, "packages", "chat-ui", "src")}/**/*.{ts,tsx}";\n`;
	writeFileSync(stylesPath, `${css.trimEnd()}\n\n${line}`);
}

/** 生成项目继续用 `pnpm kit:add` 调用当前仓库的脚本；kit 包发布前不另造 CLI 包。 */
function writeKitAddScript(dest, kitRepo) {
	const packagePath = join(dest, "package.json");
	const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
	pkg.scripts ??= {};
	const scriptPath = join(kitRepo, "scripts", "kit", "add-component.mjs").replaceAll('"', '\\"');
	pkg.scripts["kit:add"] = `node "${scriptPath}"`;
	writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

const [targetArg, ...args] = process.argv.slice(2);
if (!targetArg || targetArg.startsWith("-")) {
	console.error(USAGE);
	process.exit(1);
}
const kitFlag = args.indexOf("--kit");
const kitRepo = kitFlag >= 0 ? resolve(args[kitFlag + 1] ?? "") : REPO_ROOT;
if (kitFlag >= 0 && !args[kitFlag + 1]) {
	console.error(USAGE);
	process.exit(1);
}
const dest = resolve(targetArg);
if (existsSync(dest)) {
	console.error(`目录已存在：${dest}`);
	process.exit(1);
}

mkdirSync(dest, { recursive: true });
cpSync(join(kitRepo, "templates/web-experience"), dest, { recursive: true });
writeKitRepoPointer(dest, kitRepo);
appendChatUiSource(dest, kitRepo);
writeKitAddScript(dest, kitRepo);
console.log(`已生成 ${dest}\n下一步：cd ${targetArg} && pnpm install && pnpm dev`);
