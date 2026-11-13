import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { REPO_ROOT } from "./paths.mjs";

const script = join(REPO_ROOT, "scripts/kit/add-component.mjs");
const chatUiRoot = join(REPO_ROOT, "packages/chat-ui");

// 通过真实命令入口验证项目落盘结果，保护默认位置参数与显式目标目录两种调用方式。
for (const explicitDirectory of [false, true]) {
	test(`kit:add ${explicitDirectory ? "使用 --dir 指定项目" : "不带 --dir 使用当前项目"}`, (t) => {
		const project = mkdtempSync(join(tmpdir(), "kit-add-"));
		t.after(() => rmSync(project, { recursive: true, force: true }));
		writeFileSync(join(project, "package.json"), '{"name":"kit-add-regression","private":true}');
		const args = explicitDirectory ? ["message", "--dir", project] : ["message"];
		const result = spawnSync(process.execPath, [script, ...args], {
			cwd: explicitDirectory ? REPO_ROOT : project,
			encoding: "utf8",
			timeout: 10_000,
		});
		assert.equal(result.status, 0, `${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`);
		const target = join(project, "src/components/kit");
		for (const file of ["message/index.tsx", "message-list/index.tsx", "process/sub-agent-card/index.tsx"]) {
			assert.equal(
				readFileSync(join(target, file), "utf8"),
				readFileSync(join(chatUiRoot, "src/components", file), "utf8"),
				`组件及其依赖应复制到目标项目：${file}`,
			);
		}
		assert.equal(
			readFileSync(join(target, "theme.css"), "utf8"),
			readFileSync(join(chatUiRoot, "src/theme.css"), "utf8"),
		);
	});
}
