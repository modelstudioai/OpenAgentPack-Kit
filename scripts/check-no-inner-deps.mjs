#!/usr/bin/env node
/**
 * 零内网依赖守护（ADR-0002）：扫描 package.json 依赖与源码中的内网包/域名。
 * 另按 ADR-0015 校验 antd 依赖声明准入：仅 apps/console 允许声明 antd/@ant-design/*。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const FORBIDDEN_PKG = /^(@ali\/|@alife\/)/;
const ANTD_PKG = /^(antd|@ant-design\/)/;
const ANTD_ALLOWED = join("apps", "console", "package.json");
const FORBIDDEN_DOMAIN = /(alibaba-inc\.com|antfin\.com|aliyun-inc\.com|taobao\.org|dingtalk\.com)/;
const problems = [];

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (
			["node_modules", "dist", ".next", ".source", "out", ".git", ".turbo", "coverage", ".scratch", ".data"].includes(
				name,
			)
		)
			continue;
		// 文档与 README 不参与域名扫描；依赖与源码仍然严格扫描
		if (dir.endsWith("docs") || name.startsWith("README")) continue;
		const full = join(dir, name);
		const st = statSync(full);
		if (st.isDirectory()) walk(full, out);
		else if (/\.(ts|tsx|js|mjs|cjs|css|html|vue)$/.test(name)) out.push(full);
		else if (name === "package.json") out.push(full);
	}
	return out;
}

for (const file of walk(root)) {
	const rel = relative(root, file);
	const text = readFileSync(file, "utf8");
	if (file.endsWith("package.json")) {
		const pkg = JSON.parse(text);
		for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
			for (const name of Object.keys(pkg[section] ?? {})) {
				if (FORBIDDEN_PKG.test(name)) problems.push(`${rel}: 内网包依赖 ${name}`);
				if (ANTD_PKG.test(name) && rel !== ANTD_ALLOWED)
					problems.push(`${rel}: antd 仅限 apps/console 声明（ADR-0015）: ${name}`);
			}
		}
	} else if (FORBIDDEN_DOMAIN.test(text)) {
		problems.push(`${rel}: 源码中出现内网域名`);
	} else {
		for (const m of text.matchAll(/from\s+["'](@ali\/|@alife\/)[^"']+["']/g)) {
			problems.push(`${rel}: import 内网包 ${m[1]}`);
		}
	}
}

if (problems.length) {
	console.error("check:no-inner-deps 失败（ADR-0002 零内网依赖）：");
	for (const p of problems) console.error(` - ${p}`);
	process.exit(1);
}
console.log("check:no-inner-deps 通过");
