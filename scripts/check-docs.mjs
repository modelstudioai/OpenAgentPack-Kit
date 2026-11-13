#!/usr/bin/env node
/**
 * 文档防腐：
 * 1) 抽取 md 中 `pnpm <script>`，校验根脚本真实存在；仓库内命令不再伪装成独立 CLI；
 * 2) 校验每个 workspace 包都有 AGENTS.md。
 * 见 AGENTS.md「文档与工作记录」。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { syncSkills } from "./skills/generate.mjs";

const root = process.cwd();
const problems = [];

const rootScripts = new Set(Object.keys(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {}));
const PNPM_VERBS = new Set([
	"install",
	"i",
	"exec",
	"dlx",
	"add",
	"remove",
	"why",
	"list",
	"run",
	"deploy",
	"--filter",
	"--parallel",
	"-w",
	"--recursive",
]);

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (
			[
				"node_modules",
				"dist",
				".git",
				".turbo",
				"coverage",
				".scratch",
				".data",
				".next",
				".source",
				"out",
				"public",
			].includes(name)
		)
			continue;
		const full = join(dir, name);
		const st = statSync(full);
		if (st.isDirectory()) walk(full, out);
		else if (/\.mdx?$/.test(name)) out.push(full);
	}
	return out;
}

for (const file of walk(root)) {
	const text = readFileSync(file, "utf8");
	const historical = file.includes(`${sep}docs${sep}adr${sep}`) || file.endsWith(`${sep}CHANGELOG.md`);
	for (const m of text.matchAll(/pnpm\s+([a-zA-Z][\w:.-]*)/g)) {
		const word = m[1];
		if (PNPM_VERBS.has(word)) continue;
		if (word.includes("xxx") || word.includes("<")) continue; // 文档占位符
		// 历史记录保留当时的命令原文；只校验活跃文档引用的脚本仍然存在。
		if (!historical && !rootScripts.has(word)) problems.push(`${file}: 引用了不存在的脚本 \`pnpm ${word}\``);
	}
	if (!historical) {
		for (const m of text.matchAll(/\bagents-kit\s+([a-z-]+)/g)) {
			problems.push(`${file}: 独立的 agents-kit CLI 已移除，请改用根 pnpm 脚本（原命令：agents-kit ${m[1]}）`);
		}
		if (/packages\/cli\b/.test(text)) {
			problems.push(`${file}: 已移除 packages/cli，请更新命令或路径引用`);
		}
	}
}

/**
 * 3) `docs/interfaces.md` 的 op 对照表 ↔ `apps/server/openapi.json` 双向一致。
 *    只比路径（文档里的方法是简写，容易误判）：
 *    - 标 ✅ 的行：路径必须真在 openapi.json 里，否则是「文档冒充可用」；
 *    - openapi.json 的每条路径：必须被某个 ✅ 行覆盖，否则是「新增路由忘了登记」。
 *    支持文档简写：`[/x[/y]]` 可选段、`{a,b}` 备选段、`:param` → `{param}`。
 */
function expandBrackets(path) {
	const m = path.match(/\[([^[\]]*)\]/);
	if (!m) return [path];
	const without = path.replace(m[0], "");
	const inner = path.replace(m[0], m[1]);
	return [...new Set([...expandBrackets(without), ...expandBrackets(inner)])];
}

function expandBraces(path) {
	const m = path.match(/\{([^{}]*)\}/);
	if (!m) return [path];
	return m[1].split(",").flatMap((option) => expandBraces(path.replace(m[0], option.trim())));
}

function pathVariants(raw) {
	return expandBrackets(raw)
		.flatMap(expandBraces)
		.map((v) => v.replace(/:([A-Za-z_]\w*)/g, "{$1}"));
}

const METHOD_PREFIX =
	/^(?:(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\/\s*)*(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S+)$/;

/** 从「方法与路径」单元格里取出所有路径变体（支持 `·` 分隔与简写展开）。 */
function pathsFromCell(cell) {
	const out = [];
	for (const token of cell.matchAll(/`([^`]+)`/g)) {
		for (const part of token[1].split("·")) {
			const m = part.trim().match(METHOD_PREFIX);
			if (m) out.push(...pathVariants(m[1]));
		}
	}
	return out;
}

/** 表格行 → 路径集合；只有状态列标 ✅ 的行才算「文档声明已实现」。 */
function pathsFromRow(line) {
	if (!line.startsWith("|")) return [];
	// 单元格内允许转义竖线（`\|`），不能当分隔符切
	const cells = line.split(/(?<!\\)\|/).map((cell) => cell.replaceAll("\\|", "|").trim());
	if (cells.length < 5 || !cells[4].includes("✅")) return [];
	return pathsFromCell(cells[2]);
}

function documentedPaths(text) {
	const out = new Set();
	for (const line of text.split("\n")) {
		for (const path of pathsFromRow(line)) out.add(path);
	}
	return out;
}

const openapiPath = join(root, "apps/server/openapi.json");
const interfacesPath = join(root, "docs/interfaces.md");
try {
	const spec = JSON.parse(readFileSync(openapiPath, "utf8"));
	const implemented = new Set(Object.keys(spec.paths ?? {}));
	const documented = documentedPaths(readFileSync(interfacesPath, "utf8"));
	for (const route of implemented) {
		if (!documented.has(route))
			problems.push(`docs/interfaces.md: 路由 ${route} 已实现但没有 ✅ 登记（op 对照表是唯一真相）`);
	}
	for (const route of documented) {
		if (!implemented.has(route))
			problems.push(`docs/interfaces.md: 标 ✅ 的 ${route} 在 openapi.json 里不存在（文档冒充可用）`);
	}
} catch (error) {
	problems.push(`op 对照表一致性检查失败：${error.message}`);
}

for (const dir of ["packages", "apps"]) {
	for (const name of readdirSync(join(root, dir))) {
		const pkgPath = join(root, dir, name, "package.json");
		let pkgExists = false;
		try {
			statSync(pkgPath);
			pkgExists = true;
		} catch {}
		if (!pkgExists) continue;
		try {
			statSync(join(root, dir, name, "AGENTS.md"));
		} catch {
			problems.push(`${dir}/${name}: 缺少 AGENTS.md`);
		}
	}
}

try {
	syncSkills({ root });
} catch (error) {
	problems.push(`Skill 同步检查失败：${error.message}`);
}

if (problems.length) {
	console.error("check:docs 失败：");
	for (const p of problems) console.error(` - ${p}`);
	process.exit(1);
}
console.log("check:docs 通过");
