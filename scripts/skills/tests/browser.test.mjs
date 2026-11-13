import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { modules } from "../api-model.mjs";
import { filesUnder, repositoryRoot, skillOutputRoot } from "../generate.mjs";

async function browserBundle(entryPoints) {
	return build({
		entryPoints,
		bundle: true,
		write: false,
		metafile: true,
		platform: "browser",
		format: "esm",
		outdir: "dist/browser-check",
		logLevel: "silent",
	});
}

test("SDK data entries bundle without React, React adapters, admin leakage or upstream SDK", async () => {
	const entries = Object.entries(modules)
		.filter(
			([name]) =>
				name !== "chat-ui" &&
				name !== "hooks" &&
				name !== "providers/kit/react" &&
				!name.endsWith("/hooks") &&
				name !== "providers/bailian" &&
				name !== "protocol",
		)
		.map(([, entry]) => resolve(repositoryRoot, entry.path));
	for (const entry of entries) {
		const result = await browserBundle([entry]);
		const inputs = Object.keys(result.metafile.inputs);
		const name = entry.slice(entry.indexOf("/packages/sdk/src/") + 1);
		assert.ok(!inputs.some((file) => /(?:^|\/)(?:react|react-dom)\//.test(file)), `${name} imported React`);
		assert.ok(
			!inputs.some((file) =>
				/sdk\/src\/(?:hooks|providers\/kit\/react|(?:chat|sessions|files|agents|usage|auth)\/hooks)\//.test(file),
			),
			`${name} imported React adapter`,
		);
		assert.ok(!inputs.some((file) => /@openagentpack[+/]sdk(?:@|\/)/.test(file)), `${name} imported upstream SDK`);
		assert.ok(!result.outputFiles.some((file) => /from ["']node:/.test(file.text)), `${name} imported Node runtime`);
		assert.ok(!inputs.some((file) => /apps\/console\/|sdk\/src\/admin\//.test(file)), `${name} imported admin data`);
		assert.ok(!result.outputFiles.some((file) => file.text.includes("/api/admin/")), `${name} contains admin routes`);
	}
});

test("Stream, Request, message conversion and SDK Controller independently bundle without React or upstream SDK", async () => {
	for (const [skill, filename] of [
		["kit-chat-provider", "sse-stream.ts"],
		["kit-chat-provider", "request.ts"],
		["kit-chat-provider", "message-transform.ts"],
		["kit-chat-provider", "protocol-frames.ts"],
		["use-kit-chat", "controller.ts"],
		["use-kit-chat", "call-state.ts"],
	]) {
		const result = await browserBundle([resolve(skillOutputRoot(repositoryRoot, skill), "examples", filename)]);
		const inputs = Object.keys(result.metafile.inputs);
		assert.ok(!inputs.some((file) => /(?:^|\/)(?:react|react-dom)\//.test(file)), `${filename} imported React`);
		assert.ok(!inputs.some((file) => /@openagentpack[+/]sdk(?:@|\/)/.test(file)), `${filename} imported upstream SDK`);
		assert.ok(!result.outputFiles.some((file) => /from ["']node:/.test(file.text)), "No Node runtime imports");
	}
});

test("raw Provider bundles for browsers through the public SDK session-events entry", async () => {
	const result = await browserBundle([
		resolve(skillOutputRoot(repositoryRoot, "kit-chat-provider"), "examples/raw-bailian-provider.ts"),
	]);
	const inputs = Object.keys(result.metafile.inputs);
	const upstreamSdkInputs = inputs.filter((file) => /@openagentpack[+/]sdk(?:@|\/)/.test(file));
	assert.ok(
		upstreamSdkInputs.some((file) => file.endsWith("/session-events.js")),
		"Raw SSE example must reach the SDK normalizer",
	);
	assert.ok(
		!upstreamSdkInputs.some((file) => /\/internal\/|dist\/index\.js/.test(file)),
		"Upstream SDK main/internal runtime must stay out",
	);
	assert.ok(!result.outputFiles.some((file) => /from ["']node:/.test(file.text)), "No Node runtime imports");
});

test("React and normalized integration examples bundle through public package entries", async () => {
	const entryPoints = ["use-kit-chat", "kit-chat-provider"].flatMap((name) =>
		filesUnder(resolve(skillOutputRoot(repositoryRoot, name), "examples"))
			.filter((path) => /\.tsx?$/.test(path))
			.filter((path) => !path.endsWith("/raw-bailian-provider.ts")),
	);
	const result = await browserBundle(entryPoints);
	assert.ok(
		!Object.keys(result.metafile.inputs).some(
			(file) => /@openagentpack[+/]sdk(?:@|\/)/.test(file) && /\/internal\/|dist\/index\.js/.test(file),
		),
		"Upstream SDK runtime must stay out",
	);
});

test("functional SDK entries resolve and removed aggregate entries are unavailable", () => {
	const require = createRequire(import.meta.url);
	for (const [name, entry] of Object.entries(modules)) {
		if (name !== "chat-ui") assert.ok(require.resolve(entry.name));
	}
	for (const entry of [
		"@openagentpack/kit-sdk",
		"@openagentpack/kit-sdk/adapters/react",
		"@openagentpack/kit-sdk/react",
		"@openagentpack/kit-sdk/request/stream",
		"@openagentpack/kit-sdk/bailian",
		"@openagentpack/kit-sdk/chat/react",
		"@openagentpack/kit-sdk/sessions/react",
		"@openagentpack/kit-sdk/files/react",
		"@openagentpack/kit-sdk/agents/react",
		"@openagentpack/kit-sdk/usage/react",
		"@openagentpack/kit-sdk/auth/react",
	]) {
		assert.throws(() => require.resolve(entry), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
	}
});

test("shared hooks entry bundles without Kit or feature workflows", async () => {
	const result = await browserBundle([resolve(repositoryRoot, modules.hooks.path)]);
	const inputs = Object.keys(result.metafile.inputs);
	assert.ok(Object.values(result.metafile.outputs).some((output) => output.exports.includes("useIsMobile")));
	assert.ok(
		!inputs.some((file) => /sdk\/src\/(?:providers|chat|sessions|files|agents|usage|auth)\//.test(file)),
		"Shared hooks must remain independent of backend providers and feature workflows",
	);
});
