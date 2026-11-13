#!/usr/bin/env node
/**
 * 并行起本地开发进程，带前缀输出与统一退出。
 *
 * 用法：
 *   pnpm dev                        # server + web + console + storybook（默认）
 *   pnpm dev server web console     # 只起指定目标
 *
 * 目标：server(:8787) web(:5173) console(:5174) storybook(:3000)
 * 根 `.env` 会被读进子进程环境（server 自身也支持 --env-file-if-exists）。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (Number(process.versions.node.split(".")[0]) < 24) {
	console.error(`[dev] 需要 Node.js >=24，当前为 ${process.version}。请切换到 Node.js 24 后重试。`);
	process.exit(1);
}

const envFile = join(root, ".env");
const env = { ...process.env };
// 仓库 `.env` 是本项目凭据的权威来源：与 shell 同名变量冲突时以 `.env` 为准（空值不覆盖）。
// 只打印被覆盖的变量名，绝不打印值（AGENTS.md：凭据不进日志）。
const overridden = [];
if (existsSync(envFile)) {
	for (const line of readFileSync(envFile, "utf8").split("\n")) {
		const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
		if (!m || m[2] === "") continue;
		if (m[1] in env && env[m[1]] !== m[2]) overridden.push(m[1]);
		env[m[1]] = m[2];
	}
}
if (overridden.length) console.log(`[dev] .env 覆盖了 shell 同名变量：${overridden.join(", ")}`);

// KIT_DATA_DIR 允许写相对路径：一律相对仓库根解析，
// 否则 pnpm --filter 的 cwd 是 apps/server，数据会落到 apps/server/.data（换个启动方式就“丢数据”）。
for (const key of ["KIT_DATA_DIR"]) {
	const value = env[key];
	if (value && !value.startsWith("/")) env[key] = join(root, value);
}
// KIT_EVAL_WORKSPACES 是逗号分隔多值，逐段相对仓库根解析
if (env.KIT_EVAL_WORKSPACES) {
	env.KIT_EVAL_WORKSPACES = env.KIT_EVAL_WORKSPACES.split(",")
		.map((segment) => segment.trim())
		.filter(Boolean)
		.map((segment) => (segment.startsWith("/") ? segment : join(root, segment)))
		.join(",");
}

const ALL_TARGETS = {
	server: { args: ["--filter", "@openagentpack/kit-server", "dev"] },
	web: { args: ["--filter", "web", "dev"] },
	console: { args: ["--filter", "console", "dev"] },
	storybook: { args: ["--filter", "storybook", "dev"] },
};

const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const unknown = requested.filter((name) => !ALL_TARGETS[name]);
if (unknown.length) {
	console.error(`未知目标：${unknown.join(", ")}（可选：${Object.keys(ALL_TARGETS).join(" ")}）`);
	process.exit(1);
}
const names = requested.length ? requested : ["server", "web", "console", "storybook"];

// workspace 包的公开入口指向 dist；必须先按依赖图构建，再启动消费它们的进程。
// Turbo 缓存会恢复缺失产物，也会在源码变化时重建，不能只检查 dist 是否存在。
const buildTargets = new Set(names.map((name) => ALL_TARGETS[name].args[1]));
console.log("[dev] 先构建所选目标的工作区依赖…");
const dependencies = spawnSync(
	"pnpm",
	["exec", "turbo", "run", "build", ...[...buildTargets].map((name) => `--filter=${name}^...`)],
	{ cwd: root, env, stdio: "inherit" },
);
if (dependencies.error) console.error(`[dev] 无法启动依赖构建：${dependencies.error.message}`);
if (dependencies.status !== 0) process.exit(dependencies.status ?? 1);

const children = names.map((name) => {
	const target = ALL_TARGETS[name];
	const child = spawn("pnpm", target.args, {
		cwd: root,
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const prefix = `[${name}]`;
	const pipe = (stream) => {
		stream.setEncoding("utf8");
		stream.on("data", (chunk) => {
			for (const line of chunk.split("\n")) if (line.trim()) console.log(`${prefix} ${line}`);
		});
	};
	pipe(child.stdout);
	pipe(child.stderr);
	child.on("exit", (code) => {
		console.log(`${prefix} exited(${code})`);
		for (const other of children) other?.kill("SIGTERM");
		process.exit(code ?? 0);
	});
	return child;
});

console.log(`[dev] 已启动：${names.join(" ")}`);

process.on("SIGINT", () => {
	for (const child of children) child.kill("SIGTERM");
	process.exit(0);
});
