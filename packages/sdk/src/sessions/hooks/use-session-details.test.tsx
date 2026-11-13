/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MessageFileAssociation } from "../../protocol/index.ts";
import { createKitClient } from "../../providers/kit/index.ts";
import { createRequest } from "../../request/index.ts";
import { useSessionDetails } from "./index.ts";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

function pendingResponse() {
	let resolve: (response: Response) => void = () => {};
	const promise = new Promise<Response>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
const files: MessageFileAssociation[] = [
	{ event_ids: ["message"], files: [{ file_id: "file", filename: "a.txt", size: 1 }] },
];
const detail = (id: string) =>
	Response.json({ session_id: id, agent_slug: "demo", created_at: "2026-11-12T00:00:00Z", message_files: files });
const clientFor = (fetchImpl: typeof fetch) =>
	createKitClient({
		request: createRequest({ baseUrl: "https://external.example", fetchImpl }),
		operations: {
			session: { buildRequest: ([id]) => ({ path: `/detail/${id}` }), mapResponse: (response) => response.json() },
		},
	});

it("an inline file callback does not restart the details request and receives its latest binding", async () => {
	const response = pendingResponse();
	const fetchImpl = vi.fn<typeof fetch>(async () => response.promise);
	const client = clientFor(fetchImpl);
	const received = vi.fn();
	function View({ label }: { label: string }) {
		const state = useSessionDetails({
			client,
			sessionId: "current",
			setMessageFiles: (entries) => received(label, entries),
		});
		return <output>{state.data?.session_id ?? "loading"}</output>;
	}
	await act(async () => root.render(<View label="initial" />));
	expect(fetchImpl).toHaveBeenCalledOnce();
	await act(async () => root.render(<View label="updated" />));
	expect(fetchImpl).toHaveBeenCalledOnce();
	expect(received).not.toHaveBeenCalled();
	await act(async () => response.resolve(detail("current")));
	expect(container.textContent).toBe("current");
	expect(received).toHaveBeenCalledExactlyOnceWith("updated", files);
	await act(async () => root.render(<View label="after-load" />));
	expect(fetchImpl).toHaveBeenCalledOnce();
});

it("switching sessions still cancels the previous details request and ignores its late result", async () => {
	const previous = pendingResponse();
	const current = pendingResponse();
	let oldSignal: AbortSignal | null | undefined;
	const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
		if (String(url).endsWith("/previous")) {
			oldSignal = init?.signal;
			return previous.promise;
		}
		return current.promise;
	});
	const client = clientFor(fetchImpl);
	const received = vi.fn();
	function View({ sessionId }: { sessionId: string }) {
		const state = useSessionDetails({
			client,
			sessionId,
			setMessageFiles: (entries) => received(sessionId, entries),
		});
		return <output>{state.data?.session_id ?? "loading"}</output>;
	}
	await act(async () => root.render(<View sessionId="previous" />));
	expect(fetchImpl).toHaveBeenCalledOnce();
	await act(async () => root.render(<View sessionId="current" />));
	expect(oldSignal?.aborted).toBe(true);
	expect(fetchImpl).toHaveBeenCalledTimes(2);
	await act(async () => {
		current.resolve(detail("current"));
		previous.resolve(detail("previous"));
	});
	expect(container.textContent).toBe("current");
	expect(received).toHaveBeenCalledExactlyOnceWith("current", files);
});
