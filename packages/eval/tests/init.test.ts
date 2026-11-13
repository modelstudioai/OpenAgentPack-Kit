import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { initWorkspace } from "../src/init.ts";
import { EvalConfigSchema, EvalsJsonSchema, KitJsonSchema } from "../src/schema.ts";
import { normalizeSkillName, parseFrontMatter, skillContentHash, zipSkillDir } from "../src/skillpack.ts";
import { casesHash, readConfig, workspaceDirFor, workspacePaths } from "../src/workspace.ts";

const SKILL_MD = `---
name: PRD to Prototype
description: 从产品需求到可交互原型。当用户说'我想做一个商城'或"帮我设计一个记账 app"时触发；不适用于代码评审。
---

# 正文
`;

function makeSkillDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "kit-eval-skill-"));
	writeFileSync(join(dir, "SKILL.md"), SKILL_MD);
	return dir;
}

describe("eval init", () => {
	it("在 <skill-dir>-workspace 铺社区同构骨架并规范化 skill_name", () => {
		const skillDir = makeSkillDir();
		const root = initWorkspace(skillDir);
		expect(root).toBe(workspaceDirFor(skillDir));
		const paths = workspacePaths(root);
		const evals = EvalsJsonSchema.parse(JSON.parse(readFileSync(paths.evalsJson, "utf8")));
		expect(evals.skill_name).toBe("prd-to-prototype");
		expect(evals.evals).toHaveLength(2);
		// description 引号示例被抽成正例 prompt 草稿
		expect(evals.evals[0]?.prompt).toContain("我想做一个商城");
		const kit = KitJsonSchema.parse(JSON.parse(readFileSync(paths.kitJson, "utf8")));
		expect(kit.cases["2"]?.kind).toBe("trigger_neg");
		expect(kit.cases["1"]?.draft).toBe(true);
		const config = EvalConfigSchema.parse(parseYaml(readFileSync(paths.configYml, "utf8")));
		expect(config.baseline_without_skill).toBe(false);
	});

	it("重复 init 拒绝覆盖，--force 放行", () => {
		const skillDir = makeSkillDir();
		initWorkspace(skillDir);
		expect(() => initWorkspace(skillDir)).toThrow(/workspace 已存在/);
		expect(() => initWorkspace(skillDir, { force: true })).not.toThrow();
	});

	it("readConfig 对空 workspace 回落默认值", () => {
		const dir = mkdtempSync(join(tmpdir(), "kit-eval-ws-"));
		const config = readConfig(workspacePaths(dir));
		expect(config.concurrency).toBe(2);
		expect(config.review_timeout_ms).toBe(600_000);
	});
});

describe("skillpack", () => {
	it("zip 根目录即 SKILL.md；缺 SKILL.md 报错", () => {
		const skillDir = makeSkillDir();
		const zip = zipSkillDir(skillDir);
		const entries = Object.keys(unzipSync(zip));
		expect(entries).toContain("SKILL.md");
		const empty = mkdtempSync(join(tmpdir(), "kit-eval-empty-"));
		mkdirSync(join(empty, "sub"));
		expect(() => zipSkillDir(empty)).toThrow(/SKILL\.md/);
	});

	it("name 规范化：大写/空格 → 小写连字符", () => {
		expect(normalizeSkillName("PRD to Prototype").normalized).toBe("prd-to-prototype");
		expect(normalizeSkillName("prd-to-prototype").renamed).toBe(false);
	});

	it("front matter 缺失与 description 尖括号都拒绝", () => {
		expect(() => parseFrontMatter("# 无 front matter")).toThrow(/front matter/);
		expect(() => parseFrontMatter("---\nname: a-b\ndescription: 含 <tag> 的描述\n---\n")).toThrow(/尖括号/);
	});

	it("内容哈希对文件集合稳定、对内容敏感", () => {
		const a = makeSkillDir();
		const b = makeSkillDir();
		expect(skillContentHash(a)).toBe(skillContentHash(b));
		writeFileSync(join(a, "SKILL.md"), `${SKILL_MD}\n改动\n`);
		expect(skillContentHash(a)).not.toBe(skillContentHash(b));
	});

	it("casesHash 锁 evals+kit 的稳定序列化", () => {
		const e = EvalsJsonSchema.parse({ skill_name: "s", evals: [{ id: 1, prompt: "p", expected_output: "e" }] });
		const k = KitJsonSchema.parse({ cases: {} });
		expect(casesHash(e, k)).toBe(casesHash(e, k));
		expect(casesHash(e, KitJsonSchema.parse({ cases: { "1": { kind: "task" } } }))).not.toBe(casesHash(e, k));
	});
});
