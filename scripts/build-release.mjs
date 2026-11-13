#!/usr/bin/env node
/** 生成可独立上传的运行产物；不读取 .env，不复制本地数据库或示例项目。 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (Number(process.versions.node.split(".")[0]) < 24) {
	console.error(`[release] 需要 Node.js >=24，当前为 ${process.version}`);
	process.exit(1);
}

function run(command, args) {
	const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
	if (result.error) throw new Error(`[release] 无法运行 ${command}：${result.error.message}`);
	if (result.status !== 0) throw new Error(`[release] ${command} 失败，退出码 ${result.status ?? "unknown"}`);
}

try {
	run("pnpm", [
		"exec",
		"turbo",
		"run",
		"build",
		"--filter=@openagentpack/kit-server",
		"--filter=web",
		"--filter=console",
	]);
	// storybook 的 prebuild 会重建 chat-ui，等其他消费者构建完再运行，避免并发清理 dist。
	// 独立发布使用 Next 内置 Webpack，不依赖 Turbopack 编译进程的临时监听端口。
	run("pnpm", ["--filter", "storybook", "prebuild"]);
	run("pnpm", ["--filter", "storybook", "exec", "next", "build", "--webpack"]);
	run("pnpm", ["--filter", "storybook", "exec", "node", "scripts/copy-search-index.mjs"]);

	const outputs = [
		["web", "apps/web/dist", "index.html"],
		["console", "apps/console/dist", "index.html"],
		["storybook", "apps/storybook/out", "api/search.json"],
	];
	for (const [, path, entry] of outputs) {
		if (!existsSync(join(root, path, entry))) throw new Error(`[release] 构建产物缺失：${path}/${entry}`);
	}
	const releases = join(root, ".scratch", "releases");
	mkdirSync(releases, { recursive: true });
	const output = mkdtempSync(join(releases, "kit-"));
	run("pnpm", ["--filter", "@openagentpack/kit-server", "deploy", "--prod", join(output, "server")]);
	if (!existsSync(join(output, "server", "dist", "bin.js"))) throw new Error("[release] 后端启动产物缺失");
	for (const [name, path] of outputs) cpSync(join(root, path), join(output, "sites", name), { recursive: true });
	const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
	const status = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
	writeFileSync(
		join(output, "release.json"),
		`${JSON.stringify(
			{
				formatVersion: 1,
				createdAt: new Date().toISOString(),
				revision: revision.status === 0 ? revision.stdout.trim() : null,
				workingTree: status.status === 0 ? (status.stdout.trim() ? "modified" : "clean") : "unknown",
				nodeMajor: 24,
				serverEntry: "server/dist/bin.js",
				sites: ["web", "console", "storybook"],
			},
			null,
			2,
		)}\n`,
	);
	const temporaryArchive = `${output}.tgz`;
	run("tar", ["-czf", temporaryArchive, "-C", output, "."]);
	const archive = join(root, ".scratch", "kit-release.tgz");
	renameSync(temporaryArchive, archive);
	console.log(`[release] 已生成 ${output}`);
	console.log(`[release] 发布压缩包 ${archive}`);
	console.log("[release] 此目录包含后端生产依赖与三个静态站点；运行凭据和持久化目录由部署环境提供。");
} catch (error) {
	console.error(error instanceof Error ? error.message : "[release] 构建失败");
	process.exitCode = 1;
}
