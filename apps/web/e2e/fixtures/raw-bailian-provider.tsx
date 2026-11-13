import { useChat } from "@openagentpack/kit-sdk/chat/hooks";
import type { SendMessageResponse, ToolApprovalsResponse } from "@openagentpack/kit-sdk/protocol";
import { createBailianChatProvider } from "@openagentpack/kit-sdk/providers/bailian";
import { createRequest } from "@openagentpack/kit-sdk/request";
import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";

let source: ReadableStreamDefaultController<Uint8Array>;
let subscribeReady!: () => void;
const ready = new Promise<void>((resolve) => {
	subscribeReady = resolve;
});
const requests: { path: string; method: string; authorization: string | null }[] = [];
const writes: unknown[] = [];
let cancelled = false;
let revision = 0;
const listeners = new Set<() => void>();
const changed = () => {
	revision++;
	for (const listener of listeners) listener();
};
const watch = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};
const feed = (event: unknown) => source.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
const body = new ReadableStream<Uint8Array>({
	start(controller) {
		source = controller;
	},
	cancel() {
		cancelled = true;
		changed();
	},
});
const fetchImpl: typeof fetch = async (input, init) => {
	const url = new URL(String(input));
	requests.push({
		path: url.pathname,
		method: init?.method ?? "GET",
		authorization: new Headers(init?.headers).get("authorization"),
	});
	changed();
	if (url.pathname.endsWith("/subscribe"))
		return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
	if (url.pathname.endsWith("/history")) return Response.json({ result: { records: [] } });
	if (url.pathname.endsWith("/send")) {
		const message = JSON.parse(String(init?.body)) as { text: string; client_message_id?: string };
		writes.push(message);
		changed();
		feed({
			object: "message",
			id: "user",
			type: "message",
			role: "user",
			status: "completed",
			content: [{ type: "text", text: message.text }],
			metadata: { client_message_id: message.client_message_id },
		});
		return Response.json({ result: { session_id: "raw", accepted: true, event_ids: ["user"] } });
	}
	if (url.pathname.endsWith("/stop")) return Response.json({ result: { interrupted: true } });
	if (url.pathname.endsWith("/approvals"))
		return Response.json({ result: { requires_action: false, batch_id: null, pending_call_ids: [], requests: [] } });
	if (url.pathname.endsWith("/decision"))
		return Response.json({ result: { session_id: "raw", accepted: true, event_ids: ["decision"] } });
	throw new Error("Unexpected fixture endpoint");
};
const result = async <T,>(response: Response) => ((await response.json()) as { result: T }).result;
const provider = createBailianChatProvider({
	request: createRequest({
		baseUrl: "https://business.example/agent",
		headers: () => ({ authorization: "Bearer fixture-token" }),
		fetchImpl,
	}),
	openStream: {
		buildRequest: ({ sessionId }) => ({ path: `/${sessionId}/subscribe` }),
		mapResponse: (response) => ({ response, ready }),
	},
	listEvents: {
		buildRequest: ({ sessionId }) => ({ path: `/${sessionId}/history` }),
		mapResponse: async (response) => ({
			events: (await result<{ records: Record<string, unknown>[] }>(response)).records,
		}),
	},
	sendMessage: {
		buildRequest: ({ sessionId, body: message }) => ({
			path: `/${sessionId}/send`,
			init: { method: "POST", body: JSON.stringify(message) },
		}),
		mapResponse: result<SendMessageResponse>,
	},
	interrupt: {
		buildRequest: ({ sessionId }) => ({ path: `/${sessionId}/stop`, init: { method: "POST" } }),
		mapResponse: result<{ interrupted: boolean }>,
	},
	toolApprovals: {
		buildRequest: ({ sessionId }) => ({ path: `/${sessionId}/approvals` }),
		mapResponse: result<ToolApprovalsResponse>,
	},
	submitToolApproval: {
		buildRequest: ({ sessionId, decision }) => ({
			path: `/${sessionId}/decision`,
			init: { method: "POST", body: JSON.stringify(decision) },
		}),
		mapResponse: result<SendMessageResponse>,
	},
});

function Probe() {
	const chat = useChat({ sessionId: "raw", provider });
	const [outcome, setOutcome] = useState("");
	return (
		<section>
			<pre data-testid="raw-chat">{JSON.stringify(chat)}</pre>
			<p data-testid="raw-outcome">{outcome}</p>
			<button
				type="button"
				onClick={() =>
					void chat.send("hello").then(
						() => setOutcome("sent"),
						() => setOutcome("failed"),
					)
				}
			>
				发送
			</button>
		</section>
	);
}

function Harness() {
	useSyncExternalStore(watch, () => revision);
	const [mounted, setMounted] = useState(true);
	return (
		<main className="p-4">
			<pre data-testid="raw-network">{JSON.stringify({ requests, writes, cancelled })}</pre>
			<button type="button" onClick={() => subscribeReady()}>
				上游就绪
			</button>
			<button
				type="button"
				onClick={() => {
					feed({
						object: "message",
						id: "answer",
						type: "message",
						role: "assistant",
						status: "in_progress",
						content: [{ type: "text", text: "" }],
					});
					feed({ object: "content", msg_id: "answer", index: 0, type: "text", delta: true, text: "你好" });
					feed({ object: "content", msg_id: "answer", index: 0, type: "text", delta: true, text: " 🌟" });
				}}
			>
				原始增量
			</button>
			<button type="button" onClick={() => setMounted(false)}>
				卸载
			</button>
			{mounted ? <Probe /> : null}
		</main>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
