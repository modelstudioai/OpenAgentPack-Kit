import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function readRegistry(elementsRoot) {
	return JSON.parse(readFileSync(join(elementsRoot, "registry.json"), "utf8"));
}

/** 解析组件及其传递依赖的闭包；未知组件返回 null。 */
export function resolveComponentClosure(registry, name) {
	const wanted = [name];
	const seen = new Set();
	while (wanted.length) {
		const current = wanted.pop();
		if (seen.has(current)) continue;
		seen.add(current);
		const entry = registry.components[current];
		if (!entry) return null;
		wanted.push(...entry.deps);
	}
	return seen;
}

/** 落点保留 src/components/ 下的子目录层级：组件间的相对导入依赖它。 */
export function componentDestPath(entryFile) {
	return entryFile.replace(/^src\/components\//, "");
}

export function copyComponentSource(elementsRoot, entryFile, targetDir) {
	const to = join(targetDir, componentDestPath(entryFile));
	mkdirSync(dirname(to), { recursive: true });
	cpSync(join(elementsRoot, entryFile), to);
	return to;
}
