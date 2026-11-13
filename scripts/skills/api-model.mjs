import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { portablePath } from "./validate.mjs";

export const modules = {
	"chat-ui": {
		path: "packages/chat-ui/src/index.ts",
		name: "@openagentpack/kit-chat-ui",
	},
	chat: {
		path: "packages/sdk/src/chat/index.ts",
		name: "@openagentpack/kit-sdk/chat",
	},
	sessions: {
		path: "packages/sdk/src/sessions/index.ts",
		name: "@openagentpack/kit-sdk/sessions",
	},
	files: {
		path: "packages/sdk/src/files/index.ts",
		name: "@openagentpack/kit-sdk/files",
	},
	usage: {
		path: "packages/sdk/src/usage/index.ts",
		name: "@openagentpack/kit-sdk/usage",
	},
	auth: {
		path: "packages/sdk/src/auth/index.ts",
		name: "@openagentpack/kit-sdk/auth",
	},
	messages: {
		path: "packages/sdk/src/messages/index.ts",
		name: "@openagentpack/kit-sdk/messages",
	},
	config: {
		path: "packages/sdk/src/config/index.ts",
		name: "@openagentpack/kit-sdk/config",
	},
	state: {
		path: "packages/sdk/src/state.ts",
		name: "@openagentpack/kit-sdk/state",
	},
	request: {
		path: "packages/sdk/src/request/index.ts",
		name: "@openagentpack/kit-sdk/request",
	},
	stream: {
		path: "packages/sdk/src/stream/index.ts",
		name: "@openagentpack/kit-sdk/stream",
	},
	providers: {
		path: "packages/sdk/src/providers/index.ts",
		name: "@openagentpack/kit-sdk/providers",
	},
	"providers/kit": {
		path: "packages/sdk/src/providers/kit/index.ts",
		name: "@openagentpack/kit-sdk/providers/kit",
	},
	"providers/kit/react": {
		path: "packages/sdk/src/providers/kit/react/index.ts",
		name: "@openagentpack/kit-sdk/providers/kit/react",
	},
	"providers/session-events": {
		path: "packages/sdk/src/providers/session-events/index.ts",
		name: "@openagentpack/kit-sdk/providers/session-events",
	},
	"providers/bailian": {
		path: "packages/sdk/src/providers/bailian/index.ts",
		name: "@openagentpack/kit-sdk/providers/bailian",
	},
	protocol: {
		path: "packages/sdk/src/protocol/index.ts",
		name: "@openagentpack/kit-sdk/protocol",
	},
	hooks: {
		path: "packages/sdk/src/hooks/index.ts",
		name: "@openagentpack/kit-sdk/hooks",
	},
	"chat/hooks": {
		path: "packages/sdk/src/chat/hooks/index.ts",
		name: "@openagentpack/kit-sdk/chat/hooks",
	},
	"sessions/hooks": {
		path: "packages/sdk/src/sessions/hooks/index.ts",
		name: "@openagentpack/kit-sdk/sessions/hooks",
	},
	"files/hooks": {
		path: "packages/sdk/src/files/hooks/index.ts",
		name: "@openagentpack/kit-sdk/files/hooks",
	},
	"agents/hooks": {
		path: "packages/sdk/src/agents/hooks/index.ts",
		name: "@openagentpack/kit-sdk/agents/hooks",
	},
	"usage/hooks": {
		path: "packages/sdk/src/usage/hooks/index.ts",
		name: "@openagentpack/kit-sdk/usage/hooks",
	},
	"auth/hooks": {
		path: "packages/sdk/src/auth/hooks/index.ts",
		name: "@openagentpack/kit-sdk/auth/hooks",
	},
};

export function createApiModel(root, entries = modules) {
	const options = {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		jsx: ts.JsxEmit.ReactJSX,
		strict: true,
		skipLibCheck: true,
		noEmit: true,
		allowImportingTsExtensions: true,
		paths: Object.fromEntries(Object.values(entries).map((entry) => [entry.name, [resolve(root, entry.path)]])),
	};
	const program = ts.createProgram(
		Object.values(entries).map((entry) => resolve(root, entry.path)),
		options,
	);
	const checker = program.getTypeChecker();
	const unalias = (symbol) => (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
	const exports = new Map(
		Object.entries(entries).map(([key, entry]) => {
			const source = program.getSourceFile(resolve(root, entry.path));
			if (!source) throw new Error(`Missing public entry: ${entry.path}`);
			const symbol = checker.getSymbolAtLocation(source);
			return [key, new Map(checker.getExportsOfModule(symbol).map((item) => [item.name, unalias(item)]))];
		}),
	);
	const format = (type, node, expand = false) =>
		checker
			.typeToString(type, node, ts.TypeFormatFlags.NoTruncation | (expand ? ts.TypeFormatFlags.InTypeAlias : 0))
			.replace(/import\("[^"]+"\)\./g, "");
	const location = (symbol) => symbol.valueDeclaration ?? symbol.declarations?.[0];
	const symbolType = (symbol) =>
		symbol.flags & ts.SymbolFlags.Value
			? checker.getTypeOfSymbolAtLocation(symbol, location(symbol))
			: checker.getDeclaredTypeOfSymbol(symbol);

	function fields(type, ownPropsOnly = false) {
		const types = type.isUnion() ? type.types : [type];
		if (
			types.every((item) => item.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike))
		)
			return [];
		return checker
			.getPropertiesOfType(type)
			.filter(
				(field) =>
					!ownPropsOnly || field.declarations?.some((node) => !node.getSourceFile().fileName.includes("node_modules")),
			)
			.map((field) => ({
				name: field.name,
				optional: Boolean(field.flags & ts.SymbolFlags.Optional),
				type: format(checker.getTypeOfSymbolAtLocation(field, location(field)), location(field)),
			}));
	}

	function documentedFields(type, module, propsType) {
		if (module === "chat-ui" && propsType) return fields(propsType, true);
		const construct = type.getConstructSignatures()[0];
		return fields(construct ? checker.getReturnTypeOfSignature(construct) : type, module === "chat-ui");
	}

	function declarationNode(symbol, module, entry) {
		const node = location(symbol);
		if (node) return node;
		const diagnostics = ts.formatDiagnostics(program.getSemanticDiagnostics(), {
			getCanonicalFileName: (file) => file,
			getCurrentDirectory: () => root,
			getNewLine: () => "\n",
		});
		throw new Error(
			`Cannot resolve public declaration ${module}:${entry.export}${entry.member ? `.${entry.member}` : ""}. ` +
				`Check installed dependencies and their public exports.\n${diagnostics}`,
		);
	}

	function describe(entry) {
		const module = entry.module ?? "chat-ui";
		let symbol = exports.get(module)?.get(entry.export);
		if (!symbol) throw new Error(`Unknown public export ${module}:${entry.export}`);
		let type = symbolType(symbol);
		if (entry.member) {
			symbol = checker.getPropertyOfType(type, entry.member);
			if (!symbol) throw new Error(`Unknown public member ${entry.name}`);
			type = symbolType(symbol);
		}
		const node = declarationNode(symbol, module, entry);
		const signatures = type.getCallSignatures();
		const constructs = type.getConstructSignatures();
		const props = signatures[0]?.parameters[0];
		const propsType = props && checker.getTypeOfSymbolAtLocation(props, location(symbol));
		const renderedSignatures = signatures.map((signature) =>
			checker
				.signatureToString(signature, location(symbol), ts.TypeFormatFlags.NoTruncation)
				.replace(/import\("[^"]+"\)\./g, ""),
		);
		return {
			...entry,
			module,
			packageName: entries[module].name,
			isValue: Boolean(symbol.flags & ts.SymbolFlags.Value),
			constructSignatures: constructs.map((signature) =>
				checker.signatureToString(signature, location(symbol), ts.TypeFormatFlags.NoTruncation),
			),
			source: entries[module].path,
			sourceHash: createHash("sha256").update(readFileSync(node.getSourceFile().fileName)).digest("hex"),
			declaration: portablePath(relative(root, node.getSourceFile().fileName)).startsWith("packages/")
				? portablePath(relative(root, node.getSourceFile().fileName))
				: entries[module].path,
			signatures: renderedSignatures,
			type: format(type, location(symbol), true),
			fields: documentedFields(type, module, propsType),
		};
	}

	function chatUiCallableNames() {
		return [...exports.get("chat-ui")]
			.flatMap(([name, symbol]) => {
				if (!(symbol.flags & ts.SymbolFlags.Value)) return [];
				const type = symbolType(symbol);
				if (!type.getCallSignatures().length) return [];
				return [
					name,
					...checker
						.getPropertiesOfType(type)
						.filter((field) => /^[A-Z]/.test(field.name) && symbolType(field).getCallSignatures().length)
						.map((field) => `${name}.${field.name}`),
				];
			})
			.sort();
	}

	function publicTypeCandidates() {
		// Prefer the focused entry; reexports share one symbol, unrelated names do not.
		const priority = [
			"stream",
			"request",
			"providers/bailian",
			"protocol",
			"messages",
			"chat",
			"core",
			"react",
			"chat-ui",
		];
		const rank = (module) => (priority.includes(module) ? priority.indexOf(module) : priority.length);
		const candidates = new Map();
		for (const [module, symbols] of [...exports].sort(([a], [b]) => rank(a) - rank(b))) {
			for (const [name, symbol] of symbols) {
				if (
					symbol.flags & ts.SymbolFlags.Type &&
					!(symbol.flags & ts.SymbolFlags.Value) &&
					name !== "OpenApiPaths" &&
					!candidates.has(symbol)
				)
					candidates.set(symbol, { module, name, export: name });
			}
		}
		return candidates;
	}

	// Follow referenced public types so an extracted Skill retains its contract vocabulary.
	function supportingTypes(descriptions, includeAllChatUi = false) {
		const candidates = publicTypeCandidates();
		const used = new Set(descriptions.map((item) => exports.get(item.module)?.get(item.export)));
		const result = [];
		let text = descriptions.map((entry) => JSON.stringify(entry)).join("\n");
		while (true) {
			const pending = [...candidates].filter(
				([symbol, candidate]) =>
					!used.has(symbol) &&
					((includeAllChatUi && candidate.module === "chat-ui") || new RegExp(`\\b${candidate.name}\\b`).test(text)),
			);
			if (!pending.length) break;
			for (const [symbol, candidate] of pending) {
				const described = describe(candidate);
				result.push(described);
				used.add(symbol);
				text += JSON.stringify(described);
			}
		}
		return result.sort((a, b) => a.name.localeCompare(b.name, "en"));
	}
	return { describe, chatUiCallableNames, supportingTypes };
}

export function assertChatUiCoverage(actualNames, entries) {
	const documented = entries.map((entry) => entry.name);
	const missing = actualNames.filter((name) => !documented.includes(name));
	const removed = documented.filter((name) => !actualNames.includes(name));
	const duplicate = documented.filter((name, index) => documented.indexOf(name) !== index);
	if (missing.length || removed.length || duplicate.length)
		throw new Error(`Elements API coverage: missing=[${missing}], removed=[${removed}], duplicate=[${duplicate}]`);
}
