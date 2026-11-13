import { encodeFrame, PROTOCOL_VERSION } from "@openagentpack/kit-sdk/protocol";
import { createKitChatProvider } from "@openagentpack/kit-sdk/providers/kit";
import { createRequest } from "@openagentpack/kit-sdk/request";
import { describe, expect, it, vi } from "vitest";
import { createAdminClient } from "./client.ts";

describe("AdminClient 合同", () => {
	it("资源批次使用独立前缀，发布只发送已审阅令牌且不暴露目录操作", async () => {
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ data: {} }));
		const client = createAdminClient({ baseUrl: "https://backend.example/kit", fetchImpl });
		await client.draftResources.plan("draft/a");
		await client.draftResources.execute("draft/a", { plan_id: "reviewed", confirm_token: "explicit" });
		expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
			"https://backend.example/kit/api/admin/resource-drafts/draft%2Fa/resources/plan",
			"https://backend.example/kit/api/admin/resource-drafts/draft%2Fa/resources/publish",
		]);
		expect(fetchImpl.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ plan_id: "reviewed", confirm_token: "explicit" }));
		expect(client.draftResources).not.toHaveProperty("build");
		expect(client.draftResources).not.toHaveProperty("versions");
	});
	it("批次清理凭证只通过请求头发送，保留keepalive与管理身份且不重试", async () => {
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			Response.json({ data: { discarded: true } }),
		);
		const client = createAdminClient({
			baseUrl: "https://backend.example/kit",
			headers: () => ({ authorization: "Bearer admin-a" }),
			fetchImpl,
		});
		const cleanupKey = "9b218760-4a96-425b-9dcf-e90f985828b9";
		const signal = new AbortController().signal;
		await client.resourceDrafts.active(signal, cleanupKey);
		await client.resourceDrafts.create(cleanupKey);
		expect(await client.resourceDrafts.discard("draft/a", { keepalive: true, cleanupKey })).toEqual({
			discarded: true,
		});
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://backend.example/kit/api/admin/resource-drafts/active");
		expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBe(signal);
		expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://backend.example/kit/api/admin/resource-drafts");
		expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe("POST");
		expect(fetchImpl).toHaveBeenLastCalledWith(
			"https://backend.example/kit/api/admin/resource-drafts/draft%2Fa/discard",
			expect.objectContaining({ method: "POST", keepalive: true }),
		);
		for (const [url, init] of fetchImpl.mock.calls) {
			const headers = new Headers(init?.headers);
			expect(headers.get("authorization")).toBe("Bearer admin-a");
			expect(headers.get("x-kit-protocol-version")).toBe(PROTOCOL_VERSION);
			expect(headers.get("x-kit-draft-key")).toBe(cleanupKey);
			expect(String(url)).not.toContain(cleanupKey);
			expect(init?.body).toBeUndefined();
		}
	});
	it("批次发布和模版调试使用明确的API前缀与动态管理身份，确认令牌不自动补齐", async () => {
		let token = "admin-a";
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ data: {} }));
		const client = createAdminClient({
			request: createRequest({
				baseUrl: "https://backend.example/kit",
				headers: () => ({ Authorization: `Bearer ${token}` }),
				fetchImpl,
			}),
		});
		await client.draftResources.execute("项目 one", { plan_id: "reviewed-plan", confirm_token: "reviewed-token" });
		token = "admin-b";
		await client.debug.createTemplateSession({
			remote_agent_id: "agent/key",
			title: "调试",
			files: [{ file_id: "file-1", filename: "input.txt" }],
		});
		expect(fetchImpl.mock.calls[0]?.[0]).toBe(
			"https://backend.example/kit/api/admin/resource-drafts/%E9%A1%B9%E7%9B%AE%20one/resources/publish",
		);
		expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(
			JSON.stringify({ plan_id: "reviewed-plan", confirm_token: "reviewed-token" }),
		);
		expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://backend.example/kit/api/admin/debug/sessions");
		expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer admin-a");
		expect(new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get("authorization")).toBe("Bearer admin-b");
		for (const call of fetchImpl.mock.calls)
			expect(new Headers(call[1]?.headers).get("x-kit-protocol-version")).toBe(PROTOCOL_VERSION);
	});
	it("调试复用ChatProvider，保留reset/ready/事件游标与after续传", async () => {
		const cursor = "epoch:12";
		const data = [
			encodeFrame({ type: "reset", data: { session_id: "s1" } }),
			encodeFrame({
				type: "event",
				cursor,
				data: { event_id: "event-1", type: "message", content: [{ type: "text", text: "hello" }] },
			}),
			encodeFrame({ type: "ready", data: { session_id: "s1", after: cursor, replayed: 1, cursor } }),
			encodeFrame({ type: "done", data: { session_id: "s1", status: "idle", last_event_id: "event-1", reason: null } }),
		].join("");
		const fetchImpl = vi.fn(async () => new Response(data, { headers: { "Content-Type": "text/event-stream" } }));
		const client = createAdminClient({ baseUrl: "https://debug.example", fetchImpl });
		const provider = createKitChatProvider(client.debug);
		const onReset = vi.fn();
		const onEvent = vi.fn();
		const onReady = vi.fn();
		await provider.stream("s1", { after: "epoch:11", onReset, onEvent, onReady });
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://debug.example/api/admin/debug/sessions/s1/stream?after=epoch%3A11",
			expect.anything(),
		);
		expect(onReset).toHaveBeenCalledOnce();
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event_id: "event-1" }), cursor);
		expect(onReady).toHaveBeenCalledWith({ sessionId: "s1", replayed: 1, cursor });
	});
});

it("模版会话通过管理端前缀创建，子线程事件转为ChatProvider要求的正序", async () => {
	const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
		if (String(input).includes("/events"))
			return Response.json({ data: [{ event_id: "newer" }, { event_id: "older" }], next_page_token: "next" });
		return Response.json({ data: [], next_page_token: null });
	});
	const client = createAdminClient({
		baseUrl: "https://debug.example",
		headers: () => ({ authorization: "Bearer admin" }),
		fetchImpl,
	});
	const input = { remote_agent_id: "agent_remote", remote_environment_id: "env_remote", vault_ids: ["vault_1"] };
	await client.debug.createTemplateSession(input);
	expect(fetchImpl).toHaveBeenCalledWith(
		"https://debug.example/api/admin/debug/sessions",
		expect.objectContaining({ method: "POST", body: JSON.stringify(input) }),
	);
	const provider = createKitChatProvider(client.debug);
	await provider.listThreads!("session/id", { pageToken: "page/1", limit: 1 });
	expect(fetchImpl).toHaveBeenLastCalledWith(
		"https://debug.example/api/admin/debug/sessions/session%2Fid/threads?limit=1&page_token=page%2F1",
		expect.anything(),
	);
	const events = await provider.listThreadEvents!("session/id", "sthr_child", { limit: 2 });
	expect(fetchImpl).toHaveBeenLastCalledWith(
		"https://debug.example/api/admin/debug/sessions/session%2Fid/threads/sthr_child/events?limit=2",
		expect.anything(),
	);
	expect(events).toEqual({ data: [{ event_id: "older" }, { event_id: "newer" }], next_page_token: "next" });
});
