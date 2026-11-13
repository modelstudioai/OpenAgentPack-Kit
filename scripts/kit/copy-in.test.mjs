import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { componentDestPath, readRegistry, resolveComponentClosure } from "./copy-in.mjs";

const chatUiRoot = join(dirname(fileURLToPath(import.meta.url)), "../..", "packages", "chat-ui");

/** 模拟 copy-in：specifier 字符串原样进入生成文件，所以相对导入必须按落点目录解析。 */
function resolveInCopiedTree(fromFile, specifier) {
	return normalize(join(dirname(componentDestPath(fromFile)), specifier));
}

test("copy-in 闭包中的每个组件都能独立复制并解析相对导入", () => {
	const registry = readRegistry(chatUiRoot);
	for (const name of Object.keys(registry.components)) {
		const closure = resolveComponentClosure(registry, name);
		assert.ok(closure, `${name} 的 registry 闭包不存在`);
		const files = [...closure].map((component) => registry.components[component].file);
		const copied = new Set(files.map(componentDestPath));
		for (const file of files) {
			const source = readFileSync(join(chatUiRoot, file), "utf8");
			const specifiers = [...source.matchAll(/(?:from|import)\s*"([^"]+)"/g)]
				.map((match) => match[1])
				.filter((specifier) => specifier.startsWith("."));
			for (const specifier of specifiers) {
				const target = resolveInCopiedTree(file, specifier);
				assert.ok(copied.has(target), `${file} -> ${specifier} 解析为 ${target}，不在生成树内`);
			}
		}
	}
});

test("组件及 process/ 子组件的落点保留独立目录层级", () => {
	assert.equal(
		componentDestPath("src/components/process/sub-agent-card/index.tsx"),
		"process/sub-agent-card/index.tsx",
	);
	assert.equal(componentDestPath("src/components/message/index.tsx"), "message/index.tsx");
});
