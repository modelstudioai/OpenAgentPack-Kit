import { describe, expect, it, vi } from "vitest";
import { createMockGateway } from "../src/gateway/mock.ts";
import type { ProviderGateway } from "../src/gateway/types.ts";
import { readApprovalState } from "../src/services/approval-history.ts";
import { createEventBufferRegistry } from "../src/services/event-buffer.ts";

describe("审批查询取消释放", () => {
	it("历史请求忽略signal时，取消立即释放已注册监听；迟到分页响应不继续查询", async () => {
		const gateway = createMockGateway();
		const buffers = createEventBufferRegistry();
		const controller = new AbortController();
		let resolvePage!: (page: Awaited<ReturnType<ProviderGateway["listEvents"]>>) => void;
		const list = vi.spyOn(gateway, "listEvents").mockImplementation(
			() =>
				new Promise((resolve) => {
					resolvePage = resolve;
				}),
		);
		const reading = readApprovalState(gateway, buffers, "session", controller.signal);
		// 先证明取消路径确实已注册监听并发起历史查询。
		expect(buffers.get("session")?.listeners.size).toBe(1);
		expect(list).toHaveBeenCalledWith("session", { limit: 100, signal: controller.signal });
		const rejected = expect(reading).rejects.toMatchObject({ name: "AbortError" });
		controller.abort();
		expect(buffers.get("session")?.listeners.size).toBe(0);
		await rejected;
		resolvePage({
			events: [
				{ event_id: "status", type: "session_status", content: [{ type: "data", data: { session_status: "idle" } }] },
			],
			next_page_token: "next",
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(list).toHaveBeenCalledTimes(1);
		expect(buffers.get("session")?.listeners.size).toBe(0);
	});

	it("已取消的查询不访问Provider；正常完成仍释放监听", async () => {
		const gateway = createMockGateway();
		const buffers = createEventBufferRegistry();
		const controller = new AbortController();
		const list = vi.spyOn(gateway, "listEvents").mockResolvedValue({ events: [], next_page_token: null });
		controller.abort();
		await expect(readApprovalState(gateway, buffers, "session", controller.signal)).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(list).not.toHaveBeenCalled();
		const result = await readApprovalState(gateway, buffers, "session");
		expect(result.requires_action).toBe(false);
		expect(buffers.get("session")?.listeners.size).toBe(0);
	});
});
