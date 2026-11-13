import { setDefaultFetch } from "@openagentpack/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { createSdkGateway } from "../src/gateway/sdk.ts";

const secret = "sk-thread-unit-test";
const gateway = () => createSdkGateway({ apiKey: secret, baseUrl: "https://provider.example.test/api/v1/agentstudio" });
afterEach(() => setDefaultFetch(fetch));
const thread = {
	id: "sthr_one",
	session_id: "session",
	parent_thread_id: "thrd_main",
	agent: { id: "agent_worker", version: 3 },
	status: "idle",
	created_at: "2026-10-28T00:00:00Z",
	updated_at: "2026-10-28T00:00:00Z",
};

it("SDK 线程摘要只暴露白名单；按绑定版本补 Agent 名称，分页与取消信号贯穿请求", async () => {
	const calls: URL[] = [];
	const abort = new AbortController();
	setDefaultFetch(async (input, init) => {
		const url = new URL(String(input));
		calls.push(url);
		if (url.pathname.endsWith("/threads")) {
			expect(init?.signal).toBe(abort.signal);
			return Response.json({ data: [{ ...thread, raw: secret }], next_page: "next" });
		}
		return Response.json({ id: "agent_worker", name: `研究员 ${secret}`, system: "private instructions" });
	});
	const result = await gateway().listThreads("session", { pageToken: "before", limit: 10, signal: abort.signal });
	expect(calls[0]?.searchParams.get("page")).toBe("before");
	expect(calls[1]?.searchParams.get("version")).toBe("3");
	expect(result).toEqual({
		data: [{ ...thread, agent: { ...thread.agent, name: "研究员 [REDACTED]" } }],
		next_page_token: "next",
	});
});

it("子线程事件保留完整快照、事件归属和分页；不泄露凭据", async () => {
	let requested: URL | undefined;
	const text = `正文${"长".repeat(7000)}${secret}`;
	setDefaultFetch(async (input) => {
		requested = new URL(String(input));
		return Response.json({
			data: [
				{
					id: "event",
					object: "message",
					type: "message",
					role: "assistant",
					thread_id: "sthr_one",
					status: "completed",
					content: [{ type: "text", text }],
				},
			],
			next_page: "older",
		});
	});
	const result = await gateway().listThreadEvents("session", "sthr_one", { limit: 2, pageToken: "cursor" });
	expect(requested?.pathname).toBe("/api/v1/agentstudio/sessions/session/threads/sthr_one/events");
	expect(requested?.searchParams.get("order")).toBe("desc");
	expect(requested?.searchParams.get("page")).toBe("cursor");
	expect(result.next_page_token).toBe("older");
	expect(result.events[0]).toMatchObject({
		metadata: { thread_id: "sthr_one", event_status: "completed" },
		content: [{ type: "text", text: text.replace(secret, "[REDACTED]") }],
	});
});

it("SDK 拒绝错误 Session 的线程摘要，并将不存在的线程映射成 404", async () => {
	setDefaultFetch(async () => Response.json({ data: [{ ...thread, session_id: "another" }] }));
	await expect(gateway().listThreads("session")).rejects.toMatchObject({ code: "provider_error" });
	setDefaultFetch(async () => Response.json({ message: "not found" }, { status: 404 }));
	await expect(gateway().listThreadEvents("session", "sthr_one")).rejects.toMatchObject({ code: "not_found" });
});

it("名称补全等待期间取消会终止查询；上游错误正文不进入对外错误或日志", async () => {
	const abort = new AbortController();
	let started = false;
	setDefaultFetch(async (input, init) => {
		if (String(input).includes("/threads")) return Response.json({ data: [thread] });
		started = true;
		return new Promise((_resolve, reject) => {
			init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
		});
	});
	const result = gateway().listThreads("session", { signal: abort.signal });
	await vi.waitFor(() => expect(started).toBe(true));
	const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
	abort.abort();
	await rejected;
	setDefaultFetch(async () => Response.json({ message: `provider echoed ${secret}` }, { status: 400 }));
	for (const request of [gateway().listThreads("session"), gateway().listThreadEvents("session", "sthr_one")]) {
		await expect(request).rejects.toMatchObject({ code: "provider_error", message: "查询子 Agent 失败，请稍后重试" });
	}
});
