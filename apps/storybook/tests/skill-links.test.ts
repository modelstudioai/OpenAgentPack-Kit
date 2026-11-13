import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const contentRoot = join(process.cwd(), "content/docs");
const skillsRoot = resolve(process.cwd(), "../../assets/skills");

function mdxFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? mdxFiles(path) : entry.name.endsWith(".mdx") ? [path] : [];
	});
}

describe("Skill navigation and offline source links", () => {
	it("exposes the four SDK layers while preserving existing SDK routes", () => {
		const meta = JSON.parse(readFileSync(join(contentRoot, "sdk/meta.json"), "utf8")) as { pages: string[] };
		const layers = ["stream", "request", "custom-backend", "use-chat"];
		expect(meta.pages.filter((page) => layers.includes(page))).toEqual(layers);
		for (const page of ["index", "client", "stream", "use-chat", "use-sessions", "tool-approvals", "custom-backend"]) {
			expect(meta.pages).toContain(page);
		}
		for (const page of meta.pages) expect(existsSync(join(contentRoot, "sdk", `${page}.mdx`))).toBe(true);
	});

	it("preserves the original Skill route and resolves every linked Skill page", () => {
		expect(existsSync(join(contentRoot, "skill/index.mdx"))).toBe(true);
		const missing: string[] = [];
		for (const file of mdxFiles(contentRoot)) {
			const text = readFileSync(file, "utf8");
			for (const match of text.matchAll(/(?:\]\(|href=")(\/docs\/skill(?:\/[^)#"]*)?)/g)) {
				const route = match[1]?.replace(/\/$/, "").replace(/^\/docs\//, "");
				if (
					route &&
					!existsSync(join(contentRoot, `${route}.mdx`)) &&
					!existsSync(join(contentRoot, route, "index.mdx"))
				) {
					missing.push(`${file}: ${match[1]}`);
				}
			}
		}
		expect(missing).toEqual([]);
	});

	it("links only downloadable Skill directories, sources, and archives", () => {
		const names = readdirSync(skillsRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.filter((entry) => existsSync(join(skillsRoot, entry.name, "SKILL.md")))
			.map((entry) => entry.name);
		const archives = new Set(["kit-skills.tgz", ...names.map((name) => `${name}.tgz`)]);
		const missing: string[] = [];
		for (const file of mdxFiles(contentRoot)) {
			const text = readFileSync(file, "utf8");
			for (const match of text.matchAll(/\]\(\/skills\/([^)#]+)\)/g)) {
				const target = match[1] ?? "";
				if (!archives.has(target) && !existsSync(join(skillsRoot, target))) {
					missing.push(`${file}: /skills/${target}`);
				}
			}
		}
		expect(missing).toEqual([]);
	});
});
