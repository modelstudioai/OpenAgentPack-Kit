import { setDefaultFetch } from "@openagentpack/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSdkGateway } from "../src/gateway/sdk.ts";

const gateway = () =>
	createSdkGateway({ apiKey: "sk-unit-test-credential", baseUrl: "https://provider.example.test/api/v1/agentstudio" });

afterEach(() => {
	vi.unstubAllGlobals();
	setDefaultFetch(fetch);
});

describe("上架记忆库的 SDK HTTP 合同", () => {
	it("读取超过一页的记忆库并去重，按 archived_at 和 status 排除已归档项", async () => {
		const stores = Array.from({ length: 101 }, (_, index) => ({
			id: `memory-${index}`,
			...(index < 100 ? { name: `记忆 ${index}` } : {}),
			archived_at: null,
			metadata: { upstream_only: "不下发的 Provider 元数据" },
		}));
		const nextPage = "opaque+memory/page=";
		const calls: URL[] = [];
		setDefaultFetch(async (input) => {
			const url = new URL(String(input));
			calls.push(url);
			return Response.json(
				url.searchParams.has("page")
					? {
							data: [
								...stores.slice(99),
								{ id: "memory-old", name: "按时间归档", status: "active", archived_at: "2026-10-26T00:00:00Z" },
								{ id: "memory-archived", name: "按状态归档", status: "archived", archived_at: null },
							],
							next_page: null,
						}
					: { data: stores.slice(0, 100), next_page: nextPage },
			);
		});
		expect(await gateway().listRemoteMemoryStores()).toEqual(
			stores.map(({ id, name }) => ({ memory_store_id: id, name: name ?? id })),
		);
		expect(calls.map((url) => url.searchParams.get("page"))).toEqual([null, nextPage]);
		for (const url of calls) {
			expect(url.pathname).toBe("/api/v1/agentstudio/memory_stores");
			expect(url.searchParams.get("limit")).toBe("100");
			expect(url.searchParams.get("include_archived")).toBe("false");
		}
	});

	it.each([
		{ next_page: undefined, message: "记忆库列表缺少下一页游标，请重试" },
		{ next_page: "repeated-cursor", message: "记忆库列表分页游标重复，请重试" },
	])("异常分页拒绝静默截断：$message", async ({ next_page, message }) => {
		setDefaultFetch(async () =>
			Response.json({ data: [{ id: "memory-valid", name: "可用记忆" }], has_more: true, next_page }),
		);
		await expect(gateway().listRemoteMemoryStores()).rejects.toMatchObject({ code: "provider_error", message });
	});

	it("列表载荷无有效 ID 时拒绝返回不完整结果，Provider 故障不泄露原始错误", async () => {
		setDefaultFetch(async () => Response.json({ data: [{ name: "缺少 ID" }], next_page: null }));
		await expect(gateway().listRemoteMemoryStores()).rejects.toMatchObject({ code: "provider_error" });
		setDefaultFetch(async () => Response.json({ message: "sk-unit-test-credential" }, { status: 500 }));
		await expect(gateway().listRemoteMemoryStores()).rejects.toMatchObject({
			code: "provider_error",
			message: "记忆库列表查询失败，请稍后重试",
		});
	});

	it("详情只返回可用库；不存在及已归档返回 null，无效响应和故障不能放行", async () => {
		const paths: string[] = [];
		const responses: Record<string, { body: unknown; status?: number }> = {
			active: { body: { id: "active", name: "活动记忆", metadata: { internal: "忽略此字段" } } },
			unnamed: { body: { id: "unnamed" } },
			"archived-date": { body: { id: "archived-date", name: "旧记忆", archived_at: "2026-10-26T00:00:00Z" } },
			"archived-status": { body: { id: "archived-status", name: "旧记忆", status: "archived", archived_at: null } },
			missing: { body: { code: "NotFound", message: "not found" }, status: 404 },
			failed: { body: { message: "sk-unit-test-credential" }, status: 500 },
			malformed: { body: { name: "缺少 ID" } },
		};
		setDefaultFetch(async (input) => {
			const path = new URL(String(input)).pathname;
			paths.push(path);
			const response = responses[path.split("/").pop() ?? ""];
			if (!response) throw new Error(`缺少 HTTP fixture：${path}`);
			return Response.json(response.body, { status: response.status ?? 200 });
		});
		const sdk = gateway();
		expect(await sdk.getRemoteMemoryStore("active")).toEqual({ memory_store_id: "active", name: "活动记忆" });
		expect(await sdk.getRemoteMemoryStore("unnamed")).toEqual({ memory_store_id: "unnamed", name: "unnamed" });
		expect(await sdk.getRemoteMemoryStore("archived-date")).toBeNull();
		expect(await sdk.getRemoteMemoryStore("archived-status")).toBeNull();
		expect(await sdk.getRemoteMemoryStore("missing")).toBeNull();
		for (const id of ["malformed", "failed"]) {
			await expect(sdk.getRemoteMemoryStore(id)).rejects.toMatchObject({
				code: "provider_error",
				message: "记忆库信息查询失败，请稍后重试",
			});
		}
		expect(paths.every((path) => path.startsWith("/api/v1/agentstudio/memory_stores/"))).toBe(true);
	});

	it("建会话同时保留环境与两种记忆权限和说明，空配置不覆盖 Provider 默认资源；文件不进创建载荷", async () => {
		const requests: { url: string; method: string | undefined; body: unknown }[] = [];
		// Session 创建走既有 REST 窄口子；替换 global fetch 才能验证实际发往 Provider 的载荷。
		vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
			requests.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
			return Response.json({ id: `session-${requests.length}`, status: "idle" });
		});
		const sdk = gateway();
		await sdk.createSession({
			agentId: "agent-1",
			environmentId: "env-selected",
			memoryStores: [
				{ memory_store_id: "memory-reference", access: "read_only", instructions: "只查阅参考记录。" },
				{ memory_store_id: "memory-updates", access: "read_write", instructions: "保存用户确认的信息。" },
			],
		});
		await sdk.createSession({ agentId: "agent-1" });
		await sdk.createSession({ agentId: "agent-1", memoryStores: [] });
		expect(requests).toEqual([
			{
				url: "https://provider.example.test/api/v1/agentstudio/sessions",
				method: "POST",
				body: {
					agent: "agent-1",
					environment_id: "env-selected",
					resources: [
						{
							type: "memory_store",
							memory_store_id: "memory-reference",
							access: "read_only",
							instructions: "只查阅参考记录。",
						},
						{
							type: "memory_store",
							memory_store_id: "memory-updates",
							access: "read_write",
							instructions: "保存用户确认的信息。",
						},
					],
				},
			},
			{ url: "https://provider.example.test/api/v1/agentstudio/sessions", method: "POST", body: { agent: "agent-1" } },
			{ url: "https://provider.example.test/api/v1/agentstudio/sessions", method: "POST", body: { agent: "agent-1" } },
		]);
	});
});
