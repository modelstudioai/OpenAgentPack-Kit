import { describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION } from "../../protocol/index.ts";
import { createKitClient } from "./client.ts";

describe("KitClient v2 contract", () => {
	it("不透明历史分页游标透传，发送和审批请求携带协议版本", async () => {
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			Response.json({ data: [], next_page_token: null }),
		);
		const client = createKitClient({ baseUrl: "https://kit.example", fetchImpl });
		await client.events("s1", { pageToken: "opaque/+ token", limit: 100 });
		expect(fetchImpl.mock.calls[0]?.[0]).toBe(
			"https://kit.example/api/kit/sessions/s1/events?limit=100&page_token=opaque%2F%2B%20token",
		);
		await client.sendMessage("s1", { text: "hello" });
		await client.submitToolApproval("s1", { batch_id: "b", call_id: "c", result: "deny" });
		for (const call of fetchImpl.mock.calls)
			expect(new Headers(call[1]?.headers).get("x-kit-protocol-version")).toBe(PROTOCOL_VERSION);
	});
	it("配置协议混版明确拒绝", async () => {
		const client = createKitClient({
			baseUrl: "http://x.test",
			fetchImpl: async () => Response.json({ data: { protocolVersion: "1.0.0" } }),
		});
		await expect(client.config()).rejects.toMatchObject({ code: "conflict" });
	});
});
