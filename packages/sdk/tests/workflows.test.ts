import { afterEach, expect, it, vi } from "vitest";
import { createMemberAuthController } from "../src/auth/index.ts";
import { createComposer } from "../src/chat/index.ts";
import { createArtifactActions, createAttachments } from "../src/files/index.ts";
import { KitError, type MemberView, type SessionDetail, type SessionSummary } from "../src/protocol/index.ts";
import { type ClientOperations, createKitClient } from "../src/providers/kit/index.ts";
import { createRequest } from "../src/request/index.ts";
import { createSessionActions, createSessionDirectory, createSessionSearch } from "../src/sessions/index.ts";
import { createQuotaRecovery } from "../src/usage/index.ts";

const row = (id: string): SessionSummary => ({
	session_id: id,
	agent_slug: "demo",
	created_at: "2026-11-12T00:00:00Z",
	status: "idle",
});
const detail = { ...row("created"), agent_id: "agent", environment_id: "env" } as SessionDetail;
const payload = (value: unknown) =>
	new Response(JSON.stringify({ result: value }), { headers: { "Content-Type": "application/json" } });
const result = async <T>(response: Response): Promise<T> => (await response.json()).result;
const request = (fetchImpl: typeof fetch) => createRequest({ baseUrl: "https://external.example/prefix", fetchImpl });
const controllers: { dispose(): void }[] = [];
const own = <T extends { dispose(): void }>(controller: T): T => {
	controllers.push(controller);
	return controller;
};
afterEach(() => {
	for (const controller of controllers.splice(0)) controller.dispose();
	vi.useRealTimers();
});

it("explicit Client maps paths/methods/envelopes and never falls back to Kit routes or headers", async () => {
	let completedSignal: AbortSignal | null | undefined;
	const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
		completedSignal = init?.signal;
		expect(String(url)).toBe("https://external.example/prefix/conversations/search");
		expect(init?.method).toBe("POST");
		expect(new Headers(init?.headers).has("x-kit-protocol-version")).toBe(false);
		expect(JSON.parse(String(init?.body))).toEqual({ keyword: "hello" });
		return payload({ rows: [row("one")], cursor: null });
	});
	const client = createKitClient({
		request: request(fetchImpl),
		operations: {
			sessions: {
				buildRequest: ([input]) => ({
					path: "/conversations/search",
					init: { method: "POST", body: JSON.stringify({ keyword: input?.q }) },
				}),
				mapResponse: async (response) => {
					const value = await result<{ rows: SessionSummary[]; cursor: string | null }>(response);
					return { sessions: value.rows, nextPageToken: value.cursor };
				},
			},
		},
	});
	expect((await client.sessions({ q: "hello" })).sessions[0]?.session_id).toBe("one");
	expect(client.supports("sessions")).toBe(true);
	expect(client.supports("uploadFile")).toBe(false);
	expect(() => client.uploadFile({ name: "x", bytes: new Uint8Array() })).toThrow("not configured");
	expect(fetchImpl).toHaveBeenCalledTimes(1);
	expect(completedSignal?.aborted).toBe(false);
});

it("download response stays readable after mapping and cancellation still owns its body", async () => {
	const client = createKitClient({
		request: request(async () => new Response("hello")),
		operations: { downloadFile: { buildRequest: () => ({ path: "/bytes" }), mapResponse: (response) => response } },
	});
	expect(await (await client.downloadFile("file")).text()).toBe("hello");
	const controller = new AbortController();
	const response = await client.downloadFile("file", { signal: controller.signal });
	controller.abort();
	await expect(response.text()).rejects.toMatchObject({ name: "AbortError" });
});

it("auth factory restores opaque tokens and permanently cancels the previous Client identity", async () => {
	const expires_at = new Date(Date.now() + 60_000).toISOString();
	let stored: { access_token: string; expires_at: string } | null = { access_token: "external-a", expires_at };
	const member: MemberView = {
		member_id: "a",
		username: "a",
		display_name: "A",
		auth_type: "local",
		status: "active",
		created_at: expires_at,
		updated_at: expires_at,
	};
	const identities: string[] = [];
	let pendingSignal: AbortSignal | undefined;
	const auth = own(
		createMemberAuthController({
			baseUrl: "https://external.example",
			mode: "member",
			storage: {
				load: () => stored,
				save: (value) => {
					stored = value;
				},
			},
			fetchImpl: async (url, init) => {
				identities.push(new Headers(init?.headers).get("authorization") ?? "public");
				if (String(url).endsWith("/who")) return payload({ identity: { subjectId: "a" }, member, expires_at });
				if (String(url).endsWith("/enter"))
					return payload({ access_token: "external-b", expires_at, token_type: "Bearer", member });
				if (String(url).endsWith("/leave")) {
					// Some browsers expose an empty stream for a bodyless status; wrapping it in new Response is invalid.
					const response = new Response("");
					Object.defineProperty(response, "status", { value: 204 });
					return response;
				}
				pendingSignal = init?.signal ?? undefined;
				return new Promise(() => {});
			},
			createClient: (bound) =>
				createKitClient({
					request: bound,
					operations: {
						"auth.login": { buildRequest: () => ({ path: "/enter", init: { method: "POST" } }), mapResponse: result },
						"auth.me": { buildRequest: () => ({ path: "/who" }), mapResponse: result },
						"auth.logout": {
							buildRequest: () => ({ path: "/leave", init: { method: "POST" } }),
							mapResponse: () => undefined,
						},
						agents: { buildRequest: () => ({ path: "/catalog" }), mapResponse: result },
					},
				}),
		}),
	);
	await auth.start();
	expect(auth.getSnapshot().status).toBe("signed-in");
	const previous = auth.getSnapshot().client;
	if (!previous) throw new Error("client missing");
	const stale = previous.agents().catch((error: unknown) => error);
	await vi.waitFor(() => expect(pendingSignal).toBeDefined());
	await auth.logout();
	expect(pendingSignal?.aborted).toBe(true);
	expect(await stale).toMatchObject({ name: "AbortError" });
	await auth.login({ username: "b", password: "test" });
	expect(auth.getSnapshot().client).not.toBe(previous);
	const count = identities.length;
	await expect(previous.agents()).rejects.toMatchObject({ name: "AbortError" });
	expect(identities).toHaveLength(count);
	expect(identities).toEqual(["Bearer external-a", "Bearer external-a", "Bearer external-a", "public"]);
});

it("directory shares paging/cache logic and retries a failed next page without losing loaded rows", async () => {
	let fail = true;
	const fetchImpl = vi.fn<typeof fetch>(async (url) => {
		if (String(url).endsWith("/groups")) return payload(["demo"]);
		if (String(url).includes("cursor=next")) {
			if (fail) {
				fail = false;
				return new Response("bad", { status: 503 });
			}
			return payload({ sessions: [row("two")], nextPageToken: null });
		}
		return payload({ sessions: [row("one")], nextPageToken: "next" });
	});
	const client = createKitClient({
		request: request(fetchImpl),
		operations: {
			sessionAgents: { buildRequest: () => ({ path: "/groups" }), mapResponse: result },
			sessions: {
				buildRequest: ([input]) => ({ path: `/search?cursor=${input?.pageToken ?? ""}` }),
				mapResponse: result,
			},
		},
	});
	const directory = own(createSessionDirectory(client));
	directory.start();
	await vi.waitFor(() => expect(directory.getSnapshot().groups).toHaveLength(1));
	directory.getSnapshot().groups[0]?.load();
	await vi.waitFor(() => expect(directory.getSnapshot().groups[0]?.initialized).toBe(true));
	directory.getSnapshot().groups[0]?.loadMore();
	await vi.waitFor(() => expect(directory.getSnapshot().groups[0]?.error).toBeTruthy());
	expect(directory.getSnapshot().groups[0]?.sessions).toHaveLength(1);
	directory.getSnapshot().groups[0]?.retry();
	await vi.waitFor(() =>
		expect(directory.getSnapshot().groups[0]?.sessions.map((item) => item.session_id)).toEqual(["one", "two"]),
	);
});

it("search cancels stale requests while input is debouncing and ignores late responses", async () => {
	let release: ((response: Response) => void) | undefined;
	let oldSignal: AbortSignal | undefined;
	const client = createKitClient({
		request: request(async (url, init) => {
			if (String(url).endsWith("/old")) {
				oldSignal = init?.signal ?? undefined;
				return new Promise((resolve) => {
					release = resolve;
				});
			}
			return payload({ sessions: [row("new")], nextPageToken: null });
		}),
		operations: { sessions: { buildRequest: ([input]) => ({ path: `/${input?.q}` }), mapResponse: result } },
	});
	const search = own(createSessionSearch(client, 1));
	search.setQuery("old");
	await vi.waitFor(() => expect(release).toBeDefined());
	search.setQuery("new");
	expect(oldSignal?.aborted).toBe(true);
	expect(search.getSnapshot().sessions).toEqual([]);
	release?.(payload({ sessions: [row("old")], nextPageToken: null }));
	await vi.waitFor(() => expect(search.getSnapshot().sessions[0]?.session_id).toBe("new"));
});

it("Composer creates once, rejects duplicate sends and failures, and consumes only accepted file IDs", async () => {
	let release: (() => void) | undefined;
	const fetchImpl = vi.fn<typeof fetch>(async () => payload(detail));
	const client = createKitClient({
		request: request(fetchImpl),
		operations: {
			createSession: { buildRequest: () => ({ path: "/create", init: { method: "POST" } }), mapResponse: result },
		},
	});
	const composer = own(createComposer(client));
	composer.setTarget("demo", null);
	const accepted = vi.fn();
	const created = vi.fn((id: string) => composer.setTarget("demo", id));
	const send = vi
		.fn()
		.mockRejectedValueOnce(new Error("send failed"))
		.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
	const binding = {
		agentSlug: "demo",
		sessionId: null,
		files: [{ file_id: "file", filename: "a.txt", size: 1 }],
		send,
		onSessionCreated: created,
		onAccepted: accepted,
	};
	await expect(composer.send("draft", binding)).rejects.toThrow("send failed");
	expect(accepted).not.toHaveBeenCalled();
	expect(binding.files).toHaveLength(1);
	const retry = composer.send("draft", binding);
	await vi.waitFor(() => expect(release).toBeDefined());
	await expect(composer.send("duplicate", binding)).rejects.toMatchObject({ code: "conflict" });
	release?.();
	await retry;
	expect(accepted).toHaveBeenCalledWith(["file"]);
	expect(fetchImpl).toHaveBeenCalledTimes(1);
	expect(created).toHaveBeenCalledTimes(1);
});

it("Composer cancels a pending first session when the user selects an existing session", async () => {
	let release: (response: Response) => void = () => {};
	let signal: AbortSignal | null | undefined;
	const response = new Promise<Response>((resolve) => {
		release = resolve;
	});
	const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
		signal = init?.signal;
		return response;
	});
	const client = createKitClient({
		request: request(fetchImpl),
		operations: { createSession: { buildRequest: () => ({ path: "/create" }), mapResponse: result } },
	});
	const composer = own(createComposer(client));
	composer.setTarget("demo", null);
	const send = vi.fn(async () => {});
	const onSessionCreated = vi.fn();
	const onAccepted = vi.fn();
	const sending = composer.send("first message", {
		agentSlug: "demo",
		sessionId: null,
		files: [],
		send,
		onSessionCreated,
		onAccepted,
	});
	const cancelled = expect(sending).rejects.toMatchObject({ name: "AbortError" });
	await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
	composer.setTarget("demo", "existing");
	const aborted = signal?.aborted;
	// The backend may finish creating the session even after the frontend has cancelled its request.
	release(payload(detail));
	await cancelled;
	expect(aborted).toBe(true);
	expect(onSessionCreated).not.toHaveBeenCalled();
	expect(send).not.toHaveBeenCalled();
	expect(onAccepted).not.toHaveBeenCalled();
	expect(composer.getSnapshot()).toMatchObject({ pending: false, error: null });
	await composer.send("message for the selected session", {
		agentSlug: "demo",
		sessionId: "existing",
		files: [],
		send,
	});
	expect(send).toHaveBeenCalledExactlyOnceWith("message for the selected session", {
		sessionId: "existing",
		attachments: [],
		skills: undefined,
	});
});

it("attachment removal aborts upload/scan and scan rejection becomes a removable failure", async () => {
	let sequence = 0;
	let scanSignal: AbortSignal | undefined;
	const client = createKitClient({
		request: request(async (url, init) => {
			if (String(url).endsWith("/upload")) return payload({ file_id: `f${++sequence}`, filename: "a.txt", size: 1 });
			if (String(url).endsWith("/f1")) return payload({ file_id: "f1", status: "rejected", available: false });
			scanSignal = init?.signal ?? undefined;
			return new Promise(() => {});
		}),
		operations: {
			uploadFile: { buildRequest: () => ({ path: "/upload", init: { method: "POST" } }), mapResponse: result },
			fileStatus: { buildRequest: ([id]) => ({ path: `/${id}` }), mapResponse: result },
		},
	});
	const attachments = own(createAttachments(client, { pollIntervalMs: 1, scanTimeoutMs: 1000 }));
	const source = { name: "a.txt", size: 1, arrayBuffer: async () => new ArrayBuffer(1) };
	await attachments.upload([source]);
	await vi.waitFor(() => expect(attachments.getSnapshot().failures[0]?.message).toContain("安全审核"));
	await attachments.upload([source]);
	await vi.waitFor(() => expect(scanSignal).toBeDefined());
	attachments.remove("f2");
	expect(scanSignal?.aborted).toBe(true);
	expect(attachments.getSnapshot().files).toEqual([]);
});

it("session execution needs a prepared plan; failed confirmation is never reused", async () => {
	let plans = 0;
	let executes = 0;
	const tokens: unknown[] = [];
	const operations: ClientOperations = {
		sessionPlan: { buildRequest: () => ({ path: "/plan", init: { method: "POST" } }), mapResponse: result },
		deleteSession: {
			buildRequest: ([, confirmation]) => {
				tokens.push(confirmation);
				return { path: "/delete", init: { method: "DELETE" } };
			},
			mapResponse: result,
		},
	};
	const client = createKitClient({
		request: request(async (url) =>
			String(url).endsWith("/plan")
				? payload({
						plan_id: `p${++plans}`,
						confirm_token: `t${plans}`,
						destructive: true,
						expires_at: Date.now() + 1000,
						diff: [],
					})
				: ++executes === 1
					? new Response("expired", { status: 409 })
					: payload({ deleted: true }),
		),
		operations,
	});
	const done = vi.fn();
	const actions = own(createSessionActions(client, done));
	await actions.confirm();
	expect(executes).toBe(0);
	await actions.request("session", "delete");
	expect(executes).toBe(0);
	await actions.confirm();
	expect(actions.getSnapshot().pending?.plan).toBeUndefined();
	await actions.confirm();
	expect(executes).toBe(1);
	expect(plans).toBe(2);
	await actions.confirm();
	expect(tokens).toEqual([
		expect.objectContaining({ confirm_token: "t1" }),
		expect.objectContaining({ confirm_token: "t2" }),
	]);
	expect(done).toHaveBeenCalledWith("session", "delete");
});

it("artifact preview rejects active types and falls back when a host cannot save", async () => {
	const client = createKitClient({
		request: request(
			async () =>
				new Response("<svg/>", {
					headers: { "Content-Type": "image/svg+xml", "Content-Disposition": 'attachment; filename="a.svg"' },
				}),
		),
		operations: { downloadFile: { buildRequest: () => ({ path: "/bytes" }), mapResponse: (response) => response } },
	});
	const show = vi.fn();
	const close = vi.fn();
	const fallbackSave = vi.fn(async () => true);
	const actions = own(
		createArtifactActions(client, { reservePreview: () => ({ show, close }), save: async () => false, fallbackSave }),
	);
	await actions.open("file");
	expect(show).not.toHaveBeenCalled();
	expect(close).toHaveBeenCalled();
	expect(fallbackSave).toHaveBeenCalledWith(expect.objectContaining({ filename: "a.svg" }));
});

it("quota recovery never unlocks on a failed or unknown fresh result", async () => {
	let fail = true;
	const client = createKitClient({
		request: request(async () => {
			if (fail) {
				fail = false;
				throw new KitError("provider_error", "unavailable");
			}
			return payload(null);
		}),
		operations: { usageLimits: { buildRequest: () => ({ path: "/limits" }), mapResponse: result } },
	});
	const recovery = own(createQuotaRecovery(client));
	expect(await recovery.recheck()).toBe(false);
	expect(recovery.getSnapshot().error).toBe("unavailable");
	expect(await recovery.recheck()).toBe(false);
});
