import { createRequest } from "../../request/index.ts";
import type { BailianChatProviderOptions, BailianOperation } from "./contract.ts";

export function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

export function wire() {
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({
		start(value) {
			controller = value;
		},
		cancel() {
			cancelled = true;
		},
	});
	const bytes = (value: Uint8Array) => controller.enqueue(value);
	const text = (value: string) => bytes(new TextEncoder().encode(value));
	return {
		body,
		bytes,
		text,
		feed: (value: unknown) => text(`data: ${JSON.stringify(value)}\n\n`),
		close: () => controller.close(),
		cancelled: () => cancelled,
		response: new Response(body, {
			headers: { "Content-Type": "text/event-stream; charset=utf-8", "X-Bailian-Subscribed": "true" },
		}),
	};
}

export const jsonOperation = <Input, Output>(
	buildRequest: BailianOperation<Input, Output>["buildRequest"],
): BailianOperation<Input, Output> => ({
	buildRequest,
	mapResponse: (response) => response.json() as Promise<Output>,
});

export interface BackendFixture {
	streamResponse?: typeof fetch;
	historyResponse?: typeof fetch;
	ready?: Promise<void>;
	fetchImpl?: typeof fetch;
	options?: Partial<BailianChatProviderOptions>;
}

/** 仅替换 HTTP 响应；Provider 仍使用真正的 Request、请求构造与响应映射。 */
export function backendOptions(
	connection: ReturnType<typeof wire>,
	fixture: BackendFixture = {},
): BailianChatProviderOptions {
	const fetchImpl: typeof fetch =
		fixture.fetchImpl ??
		(async (input, init) => {
			const url = new URL(String(input));
			if (url.pathname === "/subscribe")
				return fixture.streamResponse ? fixture.streamResponse(input, init) : connection.response;
			if (url.pathname === "/history")
				return fixture.historyResponse ? fixture.historyResponse(input, init) : Response.json({ events: [] });
			if (url.pathname === "/interrupt") return Response.json({ interrupted: true });
			if (url.pathname === "/approvals")
				return Response.json({ requires_action: false, batch_id: null, pending_call_ids: [], requests: [] });
			return Response.json({ session_id: "session", accepted: true, event_ids: ["sent"] });
		});
	return {
		request: createRequest({ baseUrl: "https://own.test", fetchImpl }),
		openStream: {
			buildRequest: () => ({ path: "/subscribe" }),
			mapResponse: (response) => ({ response, ready: fixture.ready ?? Promise.resolve() }),
		},
		listEvents: jsonOperation(({ pageToken }) => ({
			path: `/history${pageToken ? `?page=${encodeURIComponent(pageToken)}` : ""}`,
		})),
		sendMessage: jsonOperation(({ body }) => ({
			path: "/send",
			init: { method: "POST", body: JSON.stringify(body) },
		})),
		interrupt: jsonOperation(() => ({ path: "/interrupt", init: { method: "POST" } })),
		toolApprovals: jsonOperation(() => ({ path: "/approvals" })),
		submitToolApproval: jsonOperation(({ decision }) => ({
			path: "/decision",
			init: { method: "POST", body: JSON.stringify(decision) },
		})),
		...fixture.options,
	};
}
