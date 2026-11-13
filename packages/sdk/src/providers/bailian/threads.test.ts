import { describe, expect, it, vi } from "vitest";
import { createBailianChatProvider, createBailianThreadOperations } from "./index.ts";
import { backendOptions, deferred, wire } from "./test-fixtures.ts";

const raw = (id: string, value: string) => ({
	object: "message",
	id,
	type: "message",
	thread_id: "sthr_child",
	status: "completed",
	role: "assistant",
	created_at: "2026-10-28T00:00:00Z",
	content: [{ type: "text", text: value }],
});

describe("Bailian standard thread operations", () => {
	it("标准路径、page 游标和逆序页转换；独立线程快照无需 session_status", async () => {
		const seen: string[] = [];
		const options = backendOptions(wire(), {
			fetchImpl: async (input) => {
				seen.push(String(input));
				return Response.json({
					data: [raw("new", "new text"), raw("old", "old text")],
					next_page: "older",
					has_more: true,
				});
			},
			options: createBailianThreadOperations(),
		});
		const provider = createBailianChatProvider(options);
		const page = await provider.listThreadEvents!("session/id", "sthr_child", { limit: 2, pageToken: "page/token" });
		expect(seen).toEqual([
			"https://own.test/api/v1/agentstudio/sessions/session%2Fid/threads/sthr_child/events?limit=2&page=page%2Ftoken&order=desc",
		]);
		expect(page.next_page_token).toBe("older");
		expect(page.data.map((item) => item.event_id)).toEqual(["old", "new"]);
		expect(page.data[0]).toMatchObject({
			metadata: { thread_id: "sthr_child" },
			content: [{ type: "text", text: "old text" }],
		});
		// 重查使用新 normalizer，不积累上一页的文本。
		expect((await provider.listThreadEvents!("session/id", "sthr_child")).data[0]?.content).toEqual(
			page.data[0]?.content,
		);
	});
	it("自定义代理路径和包装保留，取消贯穿构造和迟到响应映射", async () => {
		const mapped = deferred<{ events: Record<string, unknown>[] }>();
		const started = deferred<void>();
		const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ payload: "wrapped" }));
		const options = backendOptions(wire(), {
			fetchImpl,
			options: {
				listThreadEvents: {
					buildRequest: ({ threadId }) => ({ path: `/custom/${threadId}` }),
					mapResponse: async (response, { signal }) => {
						expect(await response.json()).toEqual({ payload: "wrapped" });
						expect(signal).toBeInstanceOf(AbortSignal);
						started.resolve();
						return mapped.promise;
					},
				},
			},
		});
		const provider = createBailianChatProvider(options);
		const abort = new AbortController();
		const query = provider.listThreadEvents!("s1", "sthr_child", { signal: abort.signal });
		const failed = query.catch((error) => error);
		await started.promise;
		abort.abort();
		expect(await failed).toMatchObject({ name: "AbortError" });
		mapped.resolve({ events: [raw("late", "late")] });
		expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://own.test/custom/sthr_child");
	});
});
