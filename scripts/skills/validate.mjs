import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { posix, relative, resolve } from "node:path";
import ts from "typescript";

export const portablePath = (path) => path.replaceAll("\\", "/");

export function filesUnder(directory) {
	return readdirSync(directory)
		.sort()
		.flatMap((name) => {
			const path = resolve(directory, name);
			const stat = lstatSync(path);
			if (stat.isSymbolicLink()) throw new Error(`Skill files must not be symbolic links: ${path}`);
			return stat.isDirectory() ? filesUnder(path) : [path];
		});
}

export function headingSlugs(headings) {
	const used = new Set();
	return headings.map((heading) => {
		const base = heading
			.toLowerCase()
			.replaceAll("`", "")
			.replace(/[^\p{L}\p{N}\s_-]/gu, "")
			.replaceAll(" ", "-");
		let slug = base;
		let suffix = 0;
		while (used.has(slug)) slug = `${base}-${++suffix}`;
		used.add(slug);
		return slug;
	});
}

function validateAnchor(text, anchor, file, href) {
	const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, "");
	const headings = headingSlugs([...prose.matchAll(/^#+ (.+)$/gm)].map((heading) => heading[1]));
	if (!headings.includes(anchor)) throw new Error(`Broken Skill anchor in ${file}: ${href}`);
}

function validateMarkdownLinks({ text, file, files, read }) {
	for (const match of text.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
		const href = match[1];
		if (/^(?:https?:|mailto:|tel:)/.test(href)) continue;
		const [pathPart, anchor] = href.split("#");
		let target = file;
		if (pathPart) {
			target = posix.normalize(posix.join(posix.dirname(file), pathPart));
			if (target === ".." || target.startsWith("../"))
				throw new Error(`Reference escapes its independent Skill: ${href}`);
		}
		if (!files.has(target)) throw new Error(`Broken Skill reference in ${file}: ${href}`);
		if (anchor && target.endsWith(".md")) validateAnchor(read(target), anchor, file, href);
	}
}

/** Validate an in-memory final Skill directory keyed by POSIX relative paths. */
export function validateSkillMap(name, entries) {
	const files = new Set(entries.keys());
	const read = (file) => {
		const text = entries.get(file);
		if (text === undefined) throw new Error(`Missing Skill file: ${file}`);
		return text;
	};
	const skill = read("SKILL.md");
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	if (!new RegExp(`^---\\r?\\nname: ${escaped}\\r?\\n`).test(skill) || !/^description: .+/m.test(skill))
		throw new Error(`Invalid Skill frontmatter: ${name}`);
	for (const file of files) {
		const text = read(file);
		if (/\p{Script=Han}/u.test(text)) throw new Error(`Skill content must be English: ${file}`);
		if (/\b(TODO|TBD|FIXME)\b/.test(text)) throw new Error(`Unfinished scaffold: ${file}`);
		if (file.endsWith(".md")) validateMarkdownLinks({ text, file, files, read });
	}
}

export function validateSkillDirectory(directory) {
	const entries = new Map();
	for (const file of filesUnder(directory)) {
		const path = portablePath(relative(directory, file));
		entries.set(path, readFileSync(file, "utf8"));
	}
	const name = portablePath(directory).split("/").at(-1);
	validateSkillMap(name, entries);
}

export function validateElementExample(entry, text) {
	const kind = entry.kind ?? "component";
	if (kind !== "component" && kind !== "helper") throw new Error(`Unknown chat-ui API kind: ${entry.kind}`);
	const source = ts.createSourceFile(entry.example, text, ts.ScriptTarget.Latest, true);
	let found = false;
	function visit(node) {
		const expression =
			kind === "helper"
				? ts.isCallExpression(node) && node.expression
				: (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName;
		if (expression && expression.getText(source) === entry.name) found = true;
		ts.forEachChild(node, visit);
	}
	visit(source);
	if (!found)
		throw new Error(
			`${kind === "helper" ? "Helper" : "Component"} ${entry.name} has no ${kind === "helper" ? "call" : "JSX"} usage in ${entry.example}`,
		);
}
