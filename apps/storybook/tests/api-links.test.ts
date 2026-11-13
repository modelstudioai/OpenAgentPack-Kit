import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { operationFileName } from "../lib/openapi.ts";

/**
 * 手写文档里指向「生成接口页」的链接必须真实存在。
 * 生成页的 URL 规则 = baseDir(api) + tag 目录 + operationFileName(path, method)，
 * 这里用同一份规则从 openapi.json 反推合法 URL 集合，避免文档改链接后留下死链。
 */
const TAG_OF_PATH: [RegExp, string][] = [
	[/^\/api\/kit\//, "kit"],
	[/^\/api\/admin\/resource-drafts(?:\/|$)/, "admin-resource-draft"],
	[/^\/api\/admin\//, "admin"],
	[/^\/api\/|^\/healthz/, "meta"],
];

function expectedUrls(): Set<string> {
	const spec = JSON.parse(readFileSync(join(process.cwd(), "openapi.json"), "utf8")) as {
		paths: Record<string, Record<string, { tags?: string[] }>>;
	};
	const urls = new Set<string>();
	for (const [path, methods] of Object.entries(spec.paths)) {
		for (const [method, operation] of Object.entries(methods)) {
			const tag = operation.tags?.[0] ?? TAG_OF_PATH.find(([re]) => re.test(path))?.[1] ?? "meta";
			urls.add(`/docs/api/${tag}/${operationFileName({ item: { path, method } } as never)}`);
		}
	}
	return urls;
}

function mdxFiles(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) mdxFiles(full, out);
		else if (name.endsWith(".mdx")) out.push(full);
	}
	return out;
}

describe("手写文档 → 生成接口页 的链接", () => {
	it("全部命中（无死链）", () => {
		const urls = expectedUrls();
		const broken: string[] = [];
		for (const file of mdxFiles(join(process.cwd(), "content/docs"))) {
			const text = readFileSync(file, "utf8");
			for (const match of text.matchAll(/\]\((\/docs\/api\/[^)#]+)\)/g)) {
				const link = match[1] as string;
				if (!urls.has(link.endsWith("/") ? link.slice(0, -1) : link)) broken.push(`${file}: ${link}`);
			}
		}
		expect(broken).toEqual([]);
	});

	it("URL 规则不产生重复前缀（tag 目录 + 路由前缀只出现一次）", () => {
		for (const url of expectedUrls()) {
			expect(url).not.toMatch(/\/api\/(kit|admin)\/api\//);
		}
	});
});
