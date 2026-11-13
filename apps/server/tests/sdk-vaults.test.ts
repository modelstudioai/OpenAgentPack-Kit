import { setDefaultFetch } from "@openagentpack/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSdkGateway } from "../src/gateway/sdk.ts";

const gateway = () =>
	createSdkGateway({ apiKey: "sk-unit-test-credential", baseUrl: "https://provider.example.test/api/v1/agentstudio" });

afterEach(() => {
	vi.unstubAllGlobals();
	setDefaultFetch(fetch);
});

describe("上架密钥库的 SDK HTTP 合同", () => {
	it("只读取 Vault 元数据，遍历完整分页并去重、排除归档，响应不包含凭据", async () => {
		const vaults = Array.from({ length: 101 }, (_, index) => ({
			id: `vault-${index}`,
			...(index < 100 ? { display_name: `密钥库 ${index}` } : {}),
			archived_at: null,
			metadata: { internal_only: "内部字段" },
			credentials: [{ id: "credential-fixture", secret: "fixture-secret-must-not-leak" }],
		}));
		const nextPage = "opaque+vault/page=";
		const calls: URL[] = [];
		setDefaultFetch(async (input) => {
			const url = new URL(String(input));
			calls.push(url);
			return Response.json(
				url.searchParams.has("page")
					? {
							data: [
								...vaults.slice(99),
								{ id: "vault-old", display_name: "已归档", archived_at: "2026-10-27T00:00:00Z" },
								{ id: "vault-status", display_name: "已归档", status: "archived" },
							],
							has_more: false,
						}
					: { data: vaults.slice(0, 100), has_more: true, next_page: nextPage },
			);
		});
		expect(await gateway().listRemoteVaults()).toEqual(
			vaults.map(({ id, display_name }) => ({ vault_id: id, name: display_name ?? id })),
		);
		expect(calls.map((url) => url.searchParams.get("page"))).toEqual([null, nextPage]);
		for (const url of calls) {
			expect(url.pathname).toBe("/api/v1/agentstudio/vaults");
			expect(url.searchParams.get("limit")).toBe("100");
			expect(url.searchParams.get("include_archived")).toBe("false");
		}
	});

	it.each([
		{ next_page: undefined, message: "密钥库列表缺少下一页游标，请重试" },
		{ next_page: "repeated-cursor", message: "密钥库列表分页游标重复，请重试" },
	])("异常分页拒绝静默截断：$message", async ({ next_page, message }) => {
		setDefaultFetch(async () => Response.json({ data: [{ id: "vault-valid" }], has_more: true, next_page }));
		await expect(gateway().listRemoteVaults()).rejects.toMatchObject({ code: "provider_error", message });
	});

	it("列表无效数据和 Provider 故障不能作为可用密钥库返回", async () => {
		setDefaultFetch(async () => Response.json({ data: [{ display_name: "缺少 ID" }], has_more: false }));
		await expect(gateway().listRemoteVaults()).rejects.toMatchObject({ code: "provider_error" });
		setDefaultFetch(async () =>
			Response.json({ message: "sk-unit-test-credential fixture-secret-must-not-leak" }, { status: 500 }),
		);
		await expect(gateway().listRemoteVaults()).rejects.toMatchObject({
			code: "provider_error",
			message: "密钥库列表查询失败，请稍后重试",
		});
	});

	it("详情仅投影 ID 和名称，归档及缺失返回 null，异常脱敏且不查询凭据", async () => {
		const paths: string[] = [];
		const responses: Record<string, { body: unknown; status?: number }> = {
			active: {
				body: {
					id: "active",
					display_name: "活动密钥库",
					credentials: [{ id: "credential-fixture", secret: "fixture-secret-must-not-leak" }],
				},
			},
			unnamed: { body: { id: "unnamed" } },
			"archived-date": { body: { id: "archived-date", archived_at: "2026-10-27T00:00:00Z" } },
			"archived-status": { body: { id: "archived-status", status: "archived" } },
			missing: { body: { code: "NotFound", message: "not found" }, status: 404 },
			failed: { body: { message: "sk-unit-test-credential fixture-secret-must-not-leak" }, status: 500 },
			malformed: { body: { display_name: "缺少 ID" } },
		};
		setDefaultFetch(async (input) => {
			const path = new URL(String(input)).pathname;
			paths.push(path);
			const response = responses[path.split("/").pop() ?? ""];
			if (!response) throw new Error(`缺少 HTTP fixture：${path}`);
			return Response.json(response.body, { status: response.status ?? 200 });
		});
		const sdk = gateway();
		expect(await sdk.getRemoteVault("active")).toEqual({ vault_id: "active", name: "活动密钥库" });
		expect(await sdk.getRemoteVault("unnamed")).toEqual({ vault_id: "unnamed", name: "unnamed" });
		for (const id of ["archived-date", "archived-status", "missing"]) {
			expect(await sdk.getRemoteVault(id)).toBeNull();
		}
		for (const id of ["failed", "malformed"]) {
			await expect(sdk.getRemoteVault(id)).rejects.toMatchObject({
				code: "provider_error",
				message: "密钥库信息查询失败，请稍后重试",
			});
		}
		expect(paths).toEqual(Object.keys(responses).map((id) => `/api/v1/agentstudio/vaults/${id}`));
	});

	it("包含路径或查询字符的 ID 在 HTTP 请求前被拒，不可转向 credentials 接口", async () => {
		const fetchFixture = vi.fn(async () => Response.json({ id: "vault-valid", display_name: "有效密钥库" }));
		setDefaultFetch(fetchFixture);
		const sdk = gateway();
		expect(await sdk.getRemoteVault("vault-valid")).toEqual({ vault_id: "vault-valid", name: "有效密钥库" });
		fetchFixture.mockClear();
		for (const id of ["vault-valid/credentials", "vault-valid?expand=credentials", "vault-valid%2Fcredentials"]) {
			await expect(sdk.getRemoteVault(id)).rejects.toMatchObject({ code: "invalid_request" });
		}
		expect(fetchFixture).not.toHaveBeenCalled();
	});

	it("建会话把 vault_ids 放在顶层并与环境文件记忆共存，未配置时不发空数组；文件不进创建载荷", async () => {
		const requests: { url: string; method: string | undefined; body: unknown }[] = [];
		vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
			requests.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
			return Response.json({ id: `session-${requests.length}`, status: "idle" });
		});
		const sdk = gateway();
		await sdk.createSession({
			agentId: "agent-1",
			environmentId: "env-1",
			vaultIds: ["vault-a", "vault-b"],
			memoryStores: [{ memory_store_id: "memory-guide", access: "read_only", instructions: "仅检索参考资料。" }],
		});
		await sdk.createSession({ agentId: "agent-1" });
		await sdk.createSession({ agentId: "agent-1", vaultIds: [] });
		expect(requests).toEqual([
			{
				url: "https://provider.example.test/api/v1/agentstudio/sessions",
				method: "POST",
				body: {
					agent: "agent-1",
					environment_id: "env-1",
					vault_ids: ["vault-a", "vault-b"],
					resources: [
						{
							type: "memory_store",
							memory_store_id: "memory-guide",
							access: "read_only",
							instructions: "仅检索参考资料。",
						},
					],
				},
			},
			{ url: "https://provider.example.test/api/v1/agentstudio/sessions", method: "POST", body: { agent: "agent-1" } },
			{ url: "https://provider.example.test/api/v1/agentstudio/sessions", method: "POST", body: { agent: "agent-1" } },
		]);
	});
});
