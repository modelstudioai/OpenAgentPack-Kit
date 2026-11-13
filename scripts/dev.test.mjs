import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

// 通过真实启动入口保护冷启动顺序与失败隔离；替身只替代构建器/服务，不加载用户 .env。
function runDev(t, targets = [], { buildExit = 0, nodeVersion } = {}) {
	const root = mkdtempSync(join(tmpdir(), "kit-dev-test-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, "scripts"));
	mkdirSync(join(root, "bin"));
	copyFileSync(new URL("./dev.mjs", import.meta.url), join(root, "scripts/dev.mjs"));
	const executable = join(root, "bin/pnpm");
	writeFileSync(
		executable,
		`#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const record = (stage, target) => appendFileSync("trace.jsonl", JSON.stringify({ stage, target }) + "\\n");
if (args[0] === "exec") {
  record("build-start");
  if (process.env.TEST_BUILD_EXIT !== "0") process.exit(Number(process.env.TEST_BUILD_EXIT));
  writeFileSync("dependencies-ready", "");
  record("build-ready");
} else {
  if (!existsSync("dependencies-ready")) process.exit(91);
  record("dev", args[1]);
  const timer = setInterval(() => {
    const started = readFileSync("trace.jsonl", "utf8").trim().split("\\n")
      .map((line) => JSON.parse(line)).filter((entry) => entry.stage === "dev");
    if (started.length === Number(process.env.TEST_TARGET_COUNT)) {
      clearInterval(timer);
      process.exit(0);
    }
  }, 10);
  setTimeout(() => process.exit(93), 3000).unref();
}
`,
	);
	chmodSync(executable, 0o755);
	// 无扩展名的可执行 fixture 使用 ESM，不依赖宿主目录的 package.json。
	writeFileSync(join(root, "bin/package.json"), '{"type":"module"}');
	const args = [];
	if (nodeVersion) {
		const preload = join(root, "node-version.cjs");
		writeFileSync(
			preload,
			`Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(nodeVersion)} });
Object.defineProperty(process, "version", { value: ${JSON.stringify(`v${nodeVersion}`)} });`,
		);
		args.push("--require", preload);
	}
	const result = spawnSync(process.execPath, [...args, join(root, "scripts/dev.mjs"), ...targets], {
		cwd: root,
		env: {
			PATH: `${join(root, "bin")}:${dirname(process.execPath)}:${process.env.PATH}`,
			TEST_BUILD_EXIT: String(buildExit),
			TEST_TARGET_COUNT: String(targets.length || 4),
		},
		encoding: "utf8",
		timeout: 10_000,
	});
	assert.ifError(result.error);
	let trace = [];
	try {
		trace = readFileSync(join(root, "trace.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	return { ...result, trace };
}

test("冷启动先完成依赖构建，再启动默认四个服务", (t) => {
	const result = runDev(t);
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(
		result.trace.slice(0, 2).map((entry) => entry.stage),
		["build-start", "build-ready"],
	);
	assert.deepEqual(
		result.trace
			.slice(2)
			.map((entry) => entry.target)
			.sort(),
		["@openagentpack/kit-server", "console", "storybook", "web"],
	);
});

test("依赖构建失败时保留退出码，不启动任何服务", (t) => {
	const result = runDev(t, [], { buildExit: 17 });
	assert.equal(result.status, 17);
	assert.deepEqual(result.trace, [{ stage: "build-start" }]);
});

test("指定 server 和 web 时，只启动所选应用", (t) => {
	const result = runDev(t, ["server", "web"]);
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(
		result.trace
			.slice(2)
			.map((entry) => entry.target)
			.sort(),
		["@openagentpack/kit-server", "web"],
	);
});

test("Node 23 在启动构建和服务前返回可执行提示", (t) => {
	const result = runDev(t, [], { nodeVersion: "23.11.1" });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /需要 Node\.js >=24，当前为 v23\.11\.1/);
	assert.deepEqual(result.trace, []);
});
