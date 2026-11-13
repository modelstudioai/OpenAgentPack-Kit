# Compiled examples

Generated from the adjacent source files. Adapt the callbacks and runtime configuration to your application.

## backend-data.ts

[Source](../examples/backend-data.ts)

```ts
import { type ClientOperations, createKitClient } from "@openagentpack/kit-sdk/providers/kit";
import type { RequestClient } from "@openagentpack/kit-sdk/request";

// Configure only the features your backend supports. Missing operations never call Kit routes.
export function createDataClient(request: RequestClient) {
	const result = async <T>(response: Response): Promise<T> => (await response.json()).result;
	const json = (value: unknown) => ({
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(value),
	});
	const operations: ClientOperations = {
		agents: { buildRequest: () => ({ path: "/catalog" }), mapResponse: result },
		agent: { buildRequest: ([slug]) => ({ path: `/catalog/${encodeURIComponent(slug)}` }), mapResponse: result },
		sessionAgents: { buildRequest: () => ({ path: "/conversation-groups" }), mapResponse: result },
		sessions: {
			buildRequest: ([query]) => ({ path: "/conversations/search", init: json(query ?? {}) }),
			mapResponse: result,
		},
		session: { buildRequest: ([id]) => ({ path: `/conversations/${encodeURIComponent(id)}` }), mapResponse: result },
		createSession: { buildRequest: ([input]) => ({ path: "/conversations", init: json(input) }), mapResponse: result },
		renameSession: {
			buildRequest: ([id, title]) => ({
				path: `/conversations/${encodeURIComponent(id)}/title`,
				init: json({ title }),
			}),
			mapResponse: result,
		},
		sessionPlan: {
			buildRequest: ([id, action]) => ({
				path: `/conversations/${encodeURIComponent(id)}/preview`,
				init: json({ action }),
			}),
			mapResponse: result,
		},
		archiveSession: {
			buildRequest: ([id, confirmation]) => ({
				path: `/conversations/${encodeURIComponent(id)}/archive`,
				init: json(confirmation),
			}),
			mapResponse: result,
		},
		deleteSession: {
			buildRequest: ([id, confirmation]) => ({
				path: `/conversations/${encodeURIComponent(id)}/remove`,
				init: json(confirmation),
			}),
			mapResponse: result,
		},
		uploadFile: {
			buildRequest: ([file]) => {
				const form = new FormData();
				form.append("attachment", new Blob([file.bytes as BlobPart], { type: file.mimeType }), file.name);
				return { path: "/attachments", init: { method: "POST", body: form } };
			},
			mapResponse: result,
		},
		fileStatus: {
			buildRequest: ([id]) => ({ path: `/attachments/${encodeURIComponent(id)}/status` }),
			mapResponse: result,
		},
		downloadFile: {
			buildRequest: ([id, input]) => ({
				path: `/attachments/${encodeURIComponent(id)}/content?conversation=${encodeURIComponent(input?.sessionId ?? "")}`,
			}),
			mapResponse: (response) => response,
		},
		usageLimits: { buildRequest: () => ({ path: "/account/limits" }), mapResponse: result },
	};
	return createKitClient({ request, operations });
}
```

## backend-http.ts

[Source](../examples/backend-http.ts)

```ts
import { KitError, SendMessageResponseSchema, ToolApprovalsResponseSchema } from "@openagentpack/kit-sdk/protocol";
import type { SessionEventChatProviderOptions } from "@openagentpack/kit-sdk/providers/session-events";
import { createRequest } from "@openagentpack/kit-sdk/request";

export interface BackendConfig {
	// Explicit runtime configuration; may be cross-origin.
	baseUrl: string;
	// Application identity only. Never supply a provider credential.
	getAppToken: () => Promise<string>;
}

export function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new KitError("provider_error", "The backend returned an invalid object.");
	return value as Record<string, unknown>;
}

export async function readJson(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		throw new KitError("provider_error", "The backend returned invalid JSON.");
	}
}

async function result(response: Response): Promise<unknown> {
	const envelope = record(await readJson(response));
	if (!("result" in envelope)) throw new KitError("provider_error", "The backend response has no result.");
	return envelope.result;
}

// These routes and the { result } wrapper belong to this sample business backend.
export function createBackendHttp(config: BackendConfig) {
	const request = createRequest({
		baseUrl: config.baseUrl,
		headers: async () => ({ Authorization: `Bearer ${await config.getAppToken()}` }),
	});
	const sessionPath = (id: string) => `/sessions/${encodeURIComponent(id)}`;
	const operations: Pick<
		SessionEventChatProviderOptions,
		"sendMessage" | "interrupt" | "toolApprovals" | "submitToolApproval"
	> = {
		sendMessage: {
			buildRequest({ sessionId, body }) {
				if (body.attachments?.length)
					throw new KitError("invalid_request", "Mount uploaded files when creating a session.");
				return {
					path: `${sessionPath(sessionId)}/messages`,
					init: {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ input: body.text, request_id: body.client_message_id }),
					},
				};
			},
			async mapResponse(response) {
				const parsed = SendMessageResponseSchema.safeParse(await result(response));
				if (!parsed.success) throw new KitError("provider_error", "The backend returned an invalid send result.");
				return parsed.data;
			},
		},
		interrupt: {
			buildRequest: ({ sessionId }) => ({ path: `${sessionPath(sessionId)}/interrupt`, init: { method: "POST" } }),
			async mapResponse(response) {
				const value = record(await result(response));
				if (typeof value.interrupted !== "boolean")
					throw new KitError("provider_error", "The backend returned an invalid interruption result.");
				return { interrupted: value.interrupted };
			},
		},
		toolApprovals: {
			buildRequest: ({ sessionId }) => ({ path: `${sessionPath(sessionId)}/approvals` }),
			async mapResponse(response) {
				const parsed = ToolApprovalsResponseSchema.safeParse(await result(response));
				if (!parsed.success) throw new KitError("provider_error", "The backend returned invalid tool approvals.");
				return parsed.data;
			},
		},
		submitToolApproval: {
			buildRequest: ({ sessionId, decision }) => ({
				path: `${sessionPath(sessionId)}/approvals`,
				init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(decision) },
			}),
			async mapResponse(response) {
				const parsed = SendMessageResponseSchema.safeParse(await result(response));
				if (!parsed.success) throw new KitError("provider_error", "The backend returned an invalid approval result.");
				return parsed.data;
			},
		},
	};

	return { request, sessionPath, operations };
}
```

## kit-client-provider.ts

[Source](../examples/kit-client-provider.ts)

```ts
import type { ChatProvider } from "@openagentpack/kit-sdk/providers";
import { createKitChatProvider, type KitClient } from "@openagentpack/kit-sdk/providers/kit";

// Compatibility for applications that already own a complete KitClient.
export function wrapExistingKitClient(client: KitClient): ChatProvider {
	return createKitChatProvider(client);
}
```

## message-transform.ts

[Source](../examples/message-transform.ts)

```ts
import { type MessageTransformer, transformSessionEvent } from "@openagentpack/kit-sdk/messages";
import type { ChatProvider } from "@openagentpack/kit-sdk/providers";

// A display-only label replacement. Reapplying it is safe when later events
// rebuild the same thread. The original SessionEvent and lifecycle stay intact.
const replaceDisplayLabel: MessageTransformer = (input) => {
	const result = transformSessionEvent(input);
	return {
		...result,
		messages: result.messages.map((message) => ({
			...message,
			parts: message.parts.map((part) =>
				part.type === "text" ? { ...part, text: part.text.replaceAll("[[agent-name]]", "Support assistant") } : part,
			),
		})),
	};
};

// Construct this wrapper once with the backend binding, not on every render.
// Chat owns returned messages; this shared Provider stores no Session messages.
export function withDisplayLabel(provider: ChatProvider): ChatProvider {
	// Forward calls on the original instance, including class prototype methods.
	return {
		transformMessage: replaceDisplayLabel,
		stream: (sessionId, options) => provider.stream(sessionId, options),
		sendMessage: (sessionId, body) => provider.sendMessage(sessionId, body),
		interrupt: (sessionId) => provider.interrupt(sessionId),
		toolApprovals: (sessionId) => provider.toolApprovals(sessionId),
		submitToolApproval: (sessionId, decision) => provider.submitToolApproval(sessionId, decision),
	};
}
```

## multi-agent.tsx

[Source](../examples/multi-agent.tsx)

```tsx
import { Chat } from "@openagentpack/kit-chat-ui";
import { useChat } from "@openagentpack/kit-sdk/chat/hooks";
import type { ChatProvider } from "@openagentpack/kit-sdk/providers";
import {
	type BailianChatProviderOptions,
	createBailianChatProvider,
	createBailianThreadOperations,
} from "@openagentpack/kit-sdk/providers/bailian";
import { useState } from "react";

// Normalized backends implement these two optional operations using public DTOs.
// Event pages must be oldest-to-newest; next_page_token points to older history.
export function withNormalizedThreads(
	provider: ChatProvider,
	queries: Required<Pick<ChatProvider, "listThreads" | "listThreadEvents">>,
): ChatProvider {
	return { ...provider, ...queries };
}

// The backend proxies the two standard Bailian REST paths and { data, next_page }.
// Application authentication stays in options.request; provider secrets stay server-side.
export function withBailianThreads(options: BailianChatProviderOptions) {
	return createBailianChatProvider({
		...options,
		...createBailianThreadOperations({ basePath: "/api/v1/agentstudio" }),
	});
}

// Both Provider variants use the same native Chat, without KitProvider or Kit Server.
// Supply one stable provider instance; errors from writes remain visible to the caller.
export function MultiAgentChat({ sessionId, provider }: { sessionId: string; provider: ChatProvider }) {
	const chat = useChat({ sessionId, provider });
	const [error, setError] = useState<string | null>(null);
	return (
		<>
			{(error || chat.streamError) && <p role="alert">{error ?? chat.streamError?.message}</p>}
			<Chat
				messages={chat.messages}
				multiAgent={chat.multiAgent}
				scrollKey={sessionId}
				turnRunning={chat.turnRunning}
				canSend={chat.canSend}
				onSend={async (text) => {
					setError(null);
					try {
						await chat.send(text);
					} catch (cause) {
						setError(cause instanceof Error ? cause.message : "Sending failed. Your draft was kept.");
						throw cause;
					}
				}}
				onStop={chat.stop}
			/>
		</>
	);
}
```

## normalized-provider.ts

[Source](../examples/normalized-provider.ts)

```ts
import { PROTOCOL_VERSION, PROTOCOL_VERSION_HEADER } from "@openagentpack/kit-sdk/protocol";
import type { ChatProvider } from "@openagentpack/kit-sdk/providers";
import { createSessionEventChatProvider } from "@openagentpack/kit-sdk/providers/session-events";
import { type BackendConfig, createBackendHttp } from "./backend-http.ts";

// The Web app uses the same public factory with its own paths and { data } mapping.
// This independent backend instead uses /sessions, { result } and application auth.
// It adopts the documented SessionEvent/control-frame wire contract.
export function createNormalizedProvider(config: BackendConfig): ChatProvider {
	const backend = createBackendHttp(config);
	return createSessionEventChatProvider({
		request: backend.request,
		...backend.operations,
		stream: {
			buildRequest({ sessionId, after }) {
				const query = new URLSearchParams();
				if (after) query.set("after", after);
				const suffix = query.size ? `?${query}` : "";
				return {
					path: `${backend.sessionPath(sessionId)}/events/stream${suffix}`,
					init: {
						headers: {
							Accept: "text/event-stream",
							[PROTOCOL_VERSION_HEADER]: PROTOCOL_VERSION,
						},
					},
				};
			},
		},
	});
}
```

## protocol-frames.ts

[Source](../examples/protocol-frames.ts)

```ts
import type { SseFrame } from "@openagentpack/kit-sdk/protocol";
import { streamProtocolFrames } from "@openagentpack/kit-sdk/providers/kit";
import type { RequestClient } from "@openagentpack/kit-sdk/request";

/** The request already owns the backend base URL and any required identity/version headers. */
export async function observeProtocolFrames(
	request: RequestClient,
	path: string,
	signal: AbortSignal,
	onFrame: (frame: SseFrame) => void,
) {
	await streamProtocolFrames(request, path, {
		signal,
		onFrame,
		init: { method: "GET" },
		idleTimeoutMs: 45_000,
	});
	// done ended this subscription. It does not establish Agent execution completion.
	// Unexpected EOF, protocol error frames, and idle timeouts reject instead.
}
```

## raw-bailian-provider.ts

[Source](../examples/raw-bailian-provider.ts)

```ts
import { KitError } from "@openagentpack/kit-sdk/protocol";
import { createBailianChatProvider } from "@openagentpack/kit-sdk/providers/bailian";
import { type BackendConfig, createBackendHttp, readJson, record } from "./backend-http.ts";

export function createRawBailianProvider(config: BackendConfig) {
	const backend = createBackendHttp(config);
	return createBailianChatProvider({
		request: backend.request,
		...backend.operations,
		openStream: {
			buildRequest: ({ sessionId }) => ({
				path: `${backend.sessionPath(sessionId)}/stream`,
				init: { headers: { Accept: "text/event-stream" } },
			}),
			mapResponse(response) {
				// Backend contract: subscribe upstream FIRST, then flush this header.
				// Cross-origin backends must expose it through Access-Control-Expose-Headers.
				if (response.headers.get("x-upstream-ready") !== "true")
					throw new KitError("conflict", "The backend did not confirm upstream subscription readiness.");
				// Do not consume body or await a separate readiness promise here.
				return { response, ready: Promise.resolve() };
			},
		},
		listEvents: {
			buildRequest({ sessionId, pageToken }) {
				const query = new URLSearchParams({ order: "asc" });
				if (pageToken) query.set("page_token", pageToken);
				return { path: `${backend.sessionPath(sessionId)}/events?${query}` };
			},
			async mapResponse(response) {
				const page = record(await readJson(response));
				if (!Array.isArray(page.data))
					throw new KitError("provider_error", "The backend returned an invalid history page.");
				const next = page.next_page_token;
				if (next !== undefined && next !== null && typeof next !== "string")
					throw new KitError("provider_error", "The backend returned an invalid history cursor.");
				return {
					// Keep complete raw objects, including identity and execution state.
					events: page.data.map(record),
					nextPageToken: next,
				};
			},
		},
	});
}
```

## request.ts

[Source](../examples/request.ts)

```ts
import { createRequest, type RequestClient } from "@openagentpack/kit-sdk/request";
import type { RawSseMessage } from "@openagentpack/kit-sdk/stream";

export function createApplicationRequest(baseUrl: string, getAppToken: () => Promise<string>): RequestClient {
	return createRequest({
		baseUrl,
		headers: async () => ({ Authorization: `Bearer ${await getAppToken()}` }),
	});
}

// Sample business routes, not fixed Bailian endpoints.
export async function readStatus(request: RequestClient, signal: AbortSignal) {
	return request.json<{ available: boolean }>("/status", { signal });
}

export async function observeUpdates(
	request: RequestClient,
	signal: AbortSignal,
	onFrame: (frame: RawSseMessage) => void,
) {
	for await (const frame of request.stream(
		"/updates",
		{ signal, headers: { Accept: "text/event-stream" } },
		{ utf8Fatal: true },
	)) {
		onFrame(frame);
	}
}
```

## sse-stream.ts

[Source](../examples/sse-stream.ts)

```ts
import { createSseStream, type RawSseMessage } from "@openagentpack/kit-sdk/stream";

// The caller already owns a response body; no network request is made here.
export async function consumeSse(
	body: ReadableStream<Uint8Array>,
	signal: AbortSignal,
	onFrame: (frame: RawSseMessage) => void,
) {
	for await (const frame of createSseStream(body, { signal, utf8Fatal: true, maxFrameChars: 1024 * 1024 })) {
		// data remains a string. The Provider validates JSON and business semantics.
		onFrame(frame);
	}
	// EOF ends this iterator; it does not establish Agent execution completion.
}
```
