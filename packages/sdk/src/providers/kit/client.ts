import { AbortScope } from "../../internal/abort-scope.ts";
import { abortableResponse } from "../../internal/body.ts";
import { KitError } from "../../protocol/index.ts";
import type { RequestClient } from "../../request/index.ts";
import { loadSessionDirectory } from "../../sessions/load-directory.ts";
import type { ChatProvider } from "../contract.ts";
import { type BackendOperation, executeOperation } from "../http-operation.ts";
import { createLegacyKitClient, type LegacyKitClient, type LegacyKitClientOptions } from "./legacy-client.ts";

type HttpMethods = Omit<LegacyKitClient, "transport" | "auth" | "stream" | "fileDownloadUrl" | "sessionDirectory"> & {
	"auth.login": LegacyKitClient["auth"]["login"];
	"auth.me": LegacyKitClient["auth"]["me"];
	"auth.logout": LegacyKitClient["auth"]["logout"];
};
export type ClientOperation = keyof HttpMethods;
/** Input tuples match the Client method arguments. Cancellation is also available in context.signal. */
export type ClientOperations = {
	[K in ClientOperation]?: BackendOperation<Parameters<HttpMethods[K]>, Awaited<ReturnType<HttpMethods[K]>>>;
};
export interface ExplicitKitClientOptions {
	request: RequestClient;
	operations: ClientOperations;
	/** Reuse an existing ChatProvider for legacy client streaming. No default is created. */
	chatProvider?: ChatProvider;
}
export type KitClientOptions = LegacyKitClientOptions | ExplicitKitClientOptions;
export type KitClient = LegacyKitClient & { supports(operation: ClientOperation): boolean };

function unsupported(operation: string): never {
	throw new KitError("not_found", `Backend operation is not configured: ${operation}`);
}

/** Explicit mode only invokes the injected Request and configured operations. */
export function createKitClient(options: KitClientOptions): KitClient {
	if (!("request" in options)) return { ...createLegacyKitClient(options), supports: () => true };
	const { request, operations, chatProvider } = options;
	const invoke = <K extends ClientOperation>(
		key: K,
		args: Parameters<HttpMethods[K]>,
		signal?: AbortSignal,
	): Promise<Awaited<ReturnType<HttpMethods[K]>>> => {
		const operation = operations[key];
		if (!operation) unsupported(key);
		const scope = new AbortScope(signal);
		return executeOperation<typeof args, Awaited<ReturnType<HttpMethods[K]>>>(
			request,
			operation as BackendOperation<typeof args, Awaited<ReturnType<HttpMethods[K]>>>,
			args,
			scope,
		).then(
			(output) => {
				if (output instanceof Response)
					return abortableResponse(output, scope.signal, () => scope.release()) as typeof output;
				scope.release();
				return output;
			},
			(error: unknown) => {
				scope.dispose();
				throw error;
			},
		);
	};
	const methods = Object.fromEntries(
		Object.keys(operations)
			.filter((key) => !key.startsWith("auth."))
			.map((key) => [
				key,
				(...args: unknown[]) => {
					const last = args.at(-1);
					const signal =
						last instanceof AbortSignal
							? last
							: last && typeof last === "object" && "signal" in last
								? (last as { signal?: AbortSignal }).signal
								: undefined;
					return invoke(key as ClientOperation, args as never, signal);
				},
			]),
	) as unknown as HttpMethods;
	const keys: ClientOperation[] = [
		"config",
		"agents",
		"agent",
		"plaza",
		"usageLimits",
		"quota",
		"quotaRequests",
		"createQuotaRequest",
		"sessions",
		"sessionAgents",
		"createSession",
		"session",
		"renameSession",
		"sendMessage",
		"toolApprovals",
		"submitToolApproval",
		"interrupt",
		"events",
		"listThreads",
		"listThreadEvents",
		"sessionPlan",
		"archiveSession",
		"deleteSession",
		"uploadFile",
		"fileStatus",
		"downloadFile",
	];
	for (const key of keys) if (!(key in methods)) Object.assign(methods, { [key]: () => unsupported(key) });
	return {
		...methods,
		supports: (key) => Boolean(operations[key]),
		auth: {
			login: (...args) => invoke("auth.login", args, args[1]),
			me: (...args) => invoke("auth.me", args, args[0]),
			logout: (...args) => invoke("auth.logout", args, args[0]),
		},
		transport: {
			request: request.json,
			response: request.response,
			url: request.url,
			stream: () => unsupported("transport.stream"),
		},
		stream: (...args) => (chatProvider ? chatProvider.stream(...args) : unsupported("stream")),
		fileDownloadUrl: () => unsupported("fileDownloadUrl"),
		sessionDirectory: (signal) => loadSessionDirectory(methods, signal),
	};
}
