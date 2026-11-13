import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { assertChatUiCoverage, createApiModel } from "../api-model.mjs";
import { createArchive } from "../archive.mjs";
import {
	buildOutputs,
	filesUnder,
	repositoryRoot,
	skillNames,
	skillOutputRoot,
	skillSourceRoot,
	synchronizeOutputs,
} from "../generate.mjs";
import { packSkills } from "../pack.mjs";
import { validateElementExample, validateSkillDirectory, validateSkillMap } from "../validate.mjs";

function writeSkill(root, name, body = "# Example\n\nUse the public API.\n") {
	const directory = resolve(root, "scripts/skills/src", name);
	mkdirSync(resolve(directory, "references"), { recursive: true });
	mkdirSync(resolve(directory, "examples"), { recursive: true });
	writeFileSync(
		resolve(directory, "metadata.json"),
		JSON.stringify({
			name,
			description: "Example integration",
			displayName: "Example",
			shortDescription: "Example integration",
			defaultPrompt: `Use $${name} to integrate the example.`,
		}),
	);
	writeFileSync(resolve(directory, "skill.md"), body);
	writeFileSync(resolve(directory, "catalog.json"), "[]");
	writeFileSync(resolve(directory, "examples/fixture.ts"), "export {};\n");
}

test("public API extraction covers components, helpers and removed APIs; requiredness follows source", () => {
	const directory = mkdtempSync(resolve(tmpdir(), "kit-skills-api-"));
	const source = resolve(directory, "index.ts");
	const modules = { "chat-ui": { path: "index.ts", name: "fixture" } };
	const fixture = (optional) => `
export interface SenderProps { value${optional ? "?" : ""}: string }
export function Header(props: { title: string }) { return props.title }
export const Sender = Object.assign((props: SenderProps) => props.value, { Header });
export function isIconImageSource(icon: string | undefined) { return Boolean(icon) }
export class Failure extends Error { readonly retryable = true; }
`;
	try {
		writeFileSync(source, fixture(false));
		const before = createApiModel(directory, modules);
		assert.deepEqual(before.chatUiCallableNames(), ["Header", "Sender", "Sender.Header", "isIconImageSource"]);
		assert.throws(() => assertChatUiCoverage(before.chatUiCallableNames(), [{ name: "Sender" }]), /missing=.*Header/);
		assert.throws(() => assertChatUiCoverage(["Sender"], [{ name: "Removed" }]), /removed=.*Removed/);
		assert.throws(
			() =>
				assertChatUiCoverage(
					before.chatUiCallableNames(),
					["Header", "Sender", "Sender.Header"].map((name) => ({ name })),
				),
			/missing=.*isIconImageSource/,
		);
		assert.equal(before.describe({ export: "Sender", name: "Sender" }).fields[0].optional, false);
		const errorContract = before.describe({ export: "Failure", name: "Failure" });
		assert.ok(errorContract.fields.some((field) => field.name === "retryable"));
		assert.ok(!errorContract.fields.some((field) => field.name === "prototype"));
		writeFileSync(source, fixture(true));
		const after = createApiModel(directory, modules);
		assert.equal(after.describe({ export: "Sender", name: "Sender" }).fields[0].optional, true);
		assert.throws(() => after.describe({ export: "Removed", name: "Removed" }), /Unknown public export/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("generated callable declarations come from the public API without inventing runtime exports", () => {
	const outputs = buildOutputs(repositoryRoot);
	const api = outputs.get(resolve(skillOutputRoot(repositoryRoot, "kit-chat-provider"), "references/api.md"));
	assert.ok(api, "kit-chat-provider API reference must be generated");
	assert.match(api, /export function createSseStream\(/);
	assert.match(api, /import type \{ ChatProvider \} from "@openagentpack\/kit-sdk\/providers";/);
	assert.doesNotMatch(api, /export function ChatProvider\b/);
});

test("generated Skill links stay portable when the platform returns Windows paths", () => {
	execFileSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			String.raw`
import assert from "node:assert/strict";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
const relative = path.relative;
path.relative = (...args) => relative(...args).replaceAll("/", "\\");
syncBuiltinESMExports();
const { buildOutputs, repositoryRoot, skillOutputRoot } = await import("./scripts/skills/generate.mjs");
const outputs = buildOutputs(repositoryRoot);
const examples = outputs.get(path.resolve(skillOutputRoot(repositoryRoot, "kit-chat-provider"), "references/examples.md"));
assert.ok(examples.includes("[Source](../examples/backend-http.ts)"));
`,
		],
		{ cwd: repositoryRoot, stdio: "pipe" },
	);
});

test("chat-ui examples require component JSX or helper calls, not comments or lookalike names", () => {
	const component = { name: "Sender.Header", example: "examples/fixture.tsx" };
	const helper = { name: "isIconImageSource", kind: "helper", example: "examples/fixture.tsx" };
	validateElementExample(component, 'export const x = <Sender.Header title="Hi" />;\n');
	validateElementExample(helper, 'export const x = isIconImageSource("icon.png");\n');
	assert.throws(() => validateElementExample(component, "// <Sender.Header />\n"), /no JSX usage/);
	assert.throws(() => validateElementExample(helper, "const isIconImageSourceCopy = 1;\n"), /no call usage/);
});

test("packed Skills are reproducible and preserve source modification times", () => {
	const directory = mkdtempSync(resolve(tmpdir(), "kit-skills-pack-"));
	try {
		const first = resolve(directory, "first");
		const second = resolve(directory, "second");
		packSkills({ output: first });
		packSkills({ output: second });
		const names = skillNames(repositoryRoot);
		for (const name of [...names, "kit-skills"]) {
			const archive = resolve(first, `${name}.tgz`);
			assert.deepEqual(readFileSync(archive), readFileSync(resolve(second, `${name}.tgz`)));
			const extracted = resolve(directory, name);
			mkdirSync(extracted);
			execFileSync("tar", ["-xzf", archive, "-C", extracted]);
			const skills = name === "kit-skills" ? names : [name];
			for (const skill of skills) {
				const root = skillOutputRoot(repositoryRoot, skill);
				validateSkillDirectory(resolve(extracted, skill));
				for (const source of filesUnder(root)) {
					const file = resolve(extracted, skill, source.slice(root.length + 1));
					assert.deepEqual(readFileSync(file), readFileSync(source));
					assert.equal(statSync(file).mtimeMs, Math.floor(statSync(source).mtimeMs / 1000) * 1000);
				}
			}
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("broken references, out-of-folder dependencies, unfinished text and non-English content are rejected", () => {
	const valid = new Map([["SKILL.md", "---\nname: example\ndescription: Example integration\n---\n\n# Example\n"]]);
	assert.throws(
		() =>
			validateSkillMap("example", new Map([...valid, ["SKILL.md", `${valid.get("SKILL.md")}\n[API](missing.md)\n`]])),
		/Broken Skill reference/,
	);
	assert.throws(
		() =>
			validateSkillMap(
				"example",
				new Map([...valid, ["SKILL.md", `${valid.get("SKILL.md")}\n[API](../other/api.md)\n`]]),
			),
		/escapes/,
	);
	assert.throws(
		() => validateSkillMap("example", new Map([...valid, ["SKILL.md", `${valid.get("SKILL.md")}\n\u4e2d\u6587\n`]])),
		/must be English/,
	);
	assert.throws(
		() => validateSkillMap("example", new Map([...valid, ["SKILL.md", `${valid.get("SKILL.md")}\nTODO\n`]])),
		/Unfinished scaffold/,
	);
	assert.throws(() => createArchive([{ path: "../bad", content: "" }]), /Unsafe archive/);
});

test("API contents distinguish static subcomponents from aliases with colliding Markdown headings", () => {
	const api = readFileSync(resolve(skillOutputRoot(repositoryRoot, "kit-components"), "references/api.md"), "utf8");
	for (const [name, anchor] of [
		["Actions.Copy", "actionscopy-1"],
		["Actions.Feedback", "actionsfeedback-1"],
		["Sender.Header", "senderheader-1"],
	]) {
		assert.ok(api.includes(`- [${name}](#${anchor})`));
	}
	const skill = "---\nname: example\ndescription: Example integration\n---\n\n## ActionsCopy\n\n## Actions.Copy\n";
	assert.doesNotThrow(() =>
		validateSkillMap("example", new Map([["SKILL.md", `${skill}\n[Static member](#actionscopy-1)\n`]])),
	);
	assert.throws(
		() => validateSkillMap("example", new Map([["SKILL.md", `${skill}\n[Missing section](#actionscopy-2)\n`]])),
		/Broken Skill anchor/,
	);
});

test("stale generated output fails read-only checking and can be regenerated deterministically", () => {
	const directory = mkdtempSync(resolve(tmpdir(), "kit-skills-drift-"));
	const file = resolve(directory, "api.md");
	try {
		writeFileSync(file, "Previous API");
		const outputs = new Map([[file, "Updated API"]]);
		assert.throws(() => synchronizeOutputs(outputs), /outputs are stale/);
		assert.equal(readFileSync(file, "utf8"), "Previous API");
		assert.equal(synchronizeOutputs(outputs, { write: true }).changed, 1);
		assert.equal(synchronizeOutputs(outputs).changed, 0);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("one generation synchronizes SDK and component examples with their source files", () => {
	const directory = mkdtempSync(resolve(tmpdir(), "kit-skills-sdk-docs-"));
	try {
		for (const path of ["scripts/skills/src", "apps/storybook/content"]) {
			cpSync(resolve(repositoryRoot, path), resolve(directory, path), { recursive: true });
		}
		const examples = [
			["kit-chat-provider", "request.ts", "sdk/request.mdx"],
			["kit-components", "layout.tsx", "components/layout.mdx"],
		];
		for (const [skill, example] of examples) {
			const source = resolve(skillSourceRoot(directory, skill), "examples", example);
			writeFileSync(source, `${readFileSync(source, "utf8")}\n// Updated integration example: ${example}.\n`);
		}
		const model = createApiModel(repositoryRoot);
		const outputs = buildOutputs(directory, model);
		for (const [, example, doc] of examples) {
			const text = outputs.get(resolve(directory, "apps/storybook/content/docs", doc));
			assert.ok(text?.includes(`Updated integration example: ${example}`), `${doc} must embed its source example`);
		}
		synchronizeOutputs(outputs, { root: directory, write: true });
		assert.equal(synchronizeOutputs(buildOutputs(directory, model), { root: directory }).changed, 0);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("fixture repository generates a complete final Skill directory", () => {
	const directory = mkdtempSync(resolve(tmpdir(), "kit-skills-minimal-"));
	try {
		for (const name of ["use-kit-chat", "kit-chat-provider"]) writeSkill(directory, name);
		mkdirSync(resolve(directory, "apps/storybook/content/docs/skill"), { recursive: true });
		mkdirSync(resolve(directory, "apps/storybook/content/docs/sdk"), { recursive: true });
		mkdirSync(resolve(directory, "apps/storybook/content/docs/components"), { recursive: true });
		const outputs = buildOutputs(directory, createApiModel(repositoryRoot));
		for (const name of skillNames(directory)) {
			const root = skillOutputRoot(directory, name);
			assert.ok(outputs.has(resolve(root, "SKILL.md")));
			assert.ok(outputs.has(resolve(root, "agents/openai.yaml")));
			assert.ok(outputs.has(resolve(root, "references/api.md")));
			assert.ok(outputs.has(resolve(root, "references/examples.md")));
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
