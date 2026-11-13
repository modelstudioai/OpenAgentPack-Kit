import { describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../protocol/index.ts";
import { createKitClient } from "../providers/kit/client.ts";

const session = (id: string, slug: string, date = "2026-11-05T00:00:00.000Z"): SessionSummary => ({
	session_id: id,
	agent_slug: slug,
	created_at: date,
	status: "idle",
});
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });

describe("KitClient 两级会话目录", () => {
	it("大量分组遇到可重试限流时退避后继续读取", async () => {
		vi.useFakeTimers();
		try {
			let pages = 0;
			const client = createKitClient({
				baseUrl: "https://kit.example",
				fetchImpl: async (input) => {
					if (new URL(String(input)).pathname === "/api/kit/session-agents") return json({ data: ["assistant"] });
					if (++pages === 1)
						return new Response(
							JSON.stringify({ error: { code: "rate_limited", message: "稍后重试", retryable: true } }),
							{ status: 429 },
						);
					return json({ data: [session("a", "assistant")], next_page_token: null });
				},
			});
			const result = client.sessionDirectory();
			await vi.advanceTimersByTimeAsync(0);
			expect(pages).toBe(1);
			await vi.advanceTimersByTimeAsync(1000);
			expect(await result).toHaveLength(1);
			expect(pages).toBe(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("先枚举智能体，再完整读取各组分页，保留超过 200 条后的其他组并按活动排序", async () => {
		const requests: URL[] = [];
		const client = createKitClient({
			baseUrl: "https://kit.example",
			fetchImpl: async (input) => {
				const url = new URL(String(input));
				requests.push(url);
				if (url.pathname === "/api/kit/session-agents") return json({ data: ["assistant", "writer"] });
				expect(url.searchParams.get("include_archived")).toBe("false");
				const slug = url.searchParams.get("agent_slug");
				if (slug === "writer")
					return json({ data: [session("writer-old", "writer", "2025-01-01T00:00:00.000Z")], next_page_token: null });
				expect(slug).toBe("assistant");
				if (!url.searchParams.has("page_token"))
					return json({
						data: Array.from({ length: 200 }, (_, i) => session(`a-${i}`, "assistant")),
						next_page_token: "next",
					});
				expect(url.searchParams.get("page_token")).toBe("next");
				return json({ data: [session("a-last", "assistant")], next_page_token: null });
			},
		});
		const result = await client.sessionDirectory();
		expect(requests[0]?.pathname).toBe("/api/kit/session-agents");
		expect(result).toHaveLength(202);
		expect(result.at(-1)?.session_id).toBe("writer-old");
		expect(result.some((row) => row.session_id === "a-last")).toBe(true);
	});

	it.each(["failure", "cursor-loop"])("后续分页 %s 时拒绝部分目录", async (mode) => {
		const client = createKitClient({
			baseUrl: "https://kit.example",
			fetchImpl: async (input) => {
				const url = new URL(String(input));
				if (url.pathname === "/api/kit/session-agents") return json({ data: ["assistant"] });
				if (mode === "failure" && url.searchParams.has("page_token"))
					return new Response("unavailable", { status: 503 });
				return json({ data: [session("a", "assistant")], next_page_token: "repeat" });
			},
		});
		await expect(client.sessionDirectory()).rejects.toBeInstanceOf(Error);
	});

	it("取消忽略 signal 的枚举请求后立即退出，迟到结果不再发起组查询", async () => {
		let resolve!: (response: Response) => void;
		let start!: () => void;
		const started = new Promise<void>((done) => {
			start = done;
		});
		const pending = new Promise<Response>((done) => {
			resolve = done;
		});
		let requests = 0;
		const client = createKitClient({
			baseUrl: "https://kit.example",
			fetchImpl: async () => {
				requests++;
				start();
				return pending;
			},
		});
		const controller = new AbortController();
		const result = client.sessionDirectory(controller.signal);
		await started;
		expect(requests).toBe(1);
		controller.abort();
		await expect(result).rejects.toMatchObject({ name: "AbortError" });
		resolve(json({ data: ["assistant"] }));
		await Promise.resolve();
		expect(requests).toBe(1);
	});
});
