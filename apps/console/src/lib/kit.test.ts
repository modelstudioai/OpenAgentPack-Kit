import { PROTOCOL_VERSION } from "@openagentpack/kit-sdk/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminApi, adminToken, setAdminToken } from "./api.ts";
import { adminBaseUrl, bindAdminBackend } from "./auth.ts";
import { adminRequest, bootstrapAdmin } from "./kit.ts";
import { streamOperation } from "./sse.ts";

function setLocation(options: { injected?: string; query?: string } = {}) {
	vi.stubGlobal("window", {
		location: { origin: "https://console.example.test", search: options.query ? `?api=${options.query}` : "" },
		__OPENAGENTPACK_KIT__: options.injected ? { apiBaseUrl: options.injected } : undefined,
	});
}

function configResponse(apiBaseUrl = "", protocolVersion = PROTOCOL_VERSION) {
	return Response.json({ data: { apiBaseUrl, protocolVersion } });
}

describe("管理端启动与共享 Request", () => {
	beforeEach(() => {
		const values = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key),
		});
		setLocation();
		bindAdminBackend(undefined);
	});
	afterEach(() => vi.unstubAllGlobals());

	// 保护部署合同：同源代理、远端配置、自定义入口和宿主注入均能启动，令牌不进入公开探针。
	it.each([
		{
			name: "宿主优先",
			injected: "https://host.example.test/kit/",
			query: "https://query.example.test",
			remote: "https://remote.example.test",
			probe: "https://host.example.test/kit",
			target: "https://host.example.test/kit",
		},
		{
			name: "查询参数优先",
			query: "https://QUERY.example.test:443/kit/",
			remote: "https://remote.example.test",
			probe: "https://query.example.test/kit",
			target: "https://query.example.test/kit",
		},
		{
			name: "远端配置回填",
			remote: "https://remote.example.test/kit/",
			probe: "https://console.example.test",
			target: "https://remote.example.test/kit",
		},
		{
			name: "同源代理降级",
			remote: "",
			probe: "https://console.example.test",
			target: "https://console.example.test",
		},
	])("$name", async ({ injected, query, remote, probe, target }) => {
		setLocation({ injected, query });
		localStorage.setItem("kit_admin_token", "legacy-same-origin-token");
		expect(adminToken()).toBe("");
		expect(() => setAdminToken("before-config")).toThrow("初始化");
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(configResponse(remote));
		const result = await bootstrapAdmin(fetchImpl);
		expect(result.baseUrl).toBe(target);
		expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${probe}/api/config`);
		expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has("authorization")).toBe(false);

		fetchImpl.mockResolvedValueOnce(Response.json({ data: [] }));
		await expect(adminApi.remoteAgents()).resolves.toEqual([]);
		expect(fetchImpl.mock.calls[1]?.[0]).toBe(`${target}/api/admin/remote/agents`);
		const sameOriginRoot = target === window.location.origin;
		expect(adminToken()).toBe(sameOriginRoot ? "legacy-same-origin-token" : "");
		expect(new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get("authorization")).toBe(
			sameOriginRoot ? "Bearer legacy-same-origin-token" : null,
		);
		expect(adminBaseUrl()).toBe(target);
		// 新目标显式登录后才带凭据，初始化时没有冻结空令牌。
		setAdminToken("target-token");
		fetchImpl.mockResolvedValueOnce(Response.json({ data: [] }));
		await adminApi.remoteAgents();
		expect(new Headers(fetchImpl.mock.calls[2]?.[1]?.headers).get("authorization")).toBe("Bearer target-token");
	});

	// 回归任意 ?api= 外发漏洞：相同 origin 的不同服务前缀也不能共享令牌。
	it("令牌按完整目标隔离，切换后恢复原凭据且旧 Request 不读取新目标凭据", async () => {
		localStorage.setItem("kit_admin_token", "legacy-root-token");
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockImplementation(async (url) =>
				String(url).endsWith("/api/config") ? configResponse() : Response.json({ data: [] }),
			);
		setLocation({ query: "https://console.example.test/team-a/" });
		await bootstrapAdmin(fetchImpl);
		expect(adminToken()).toBe("");
		setAdminToken("team-a-token");
		const previousRequest = adminRequest();

		for (const target of ["https://console.example.test/team-b", "https://other.example.test/team-a"]) {
			setLocation({ query: target });
			await bootstrapAdmin(fetchImpl);
			expect(adminToken()).toBe("");
			await adminApi.remoteAgents();
			expect(new Headers(fetchImpl.mock.lastCall?.[1]?.headers).has("authorization")).toBe(false);
			setAdminToken("other-target-token");
			await previousRequest.json("/api/admin/remote/agents");
			expect(fetchImpl.mock.lastCall?.[0]).toBe("https://console.example.test/team-a/api/admin/remote/agents");
			expect(new Headers(fetchImpl.mock.lastCall?.[1]?.headers).get("authorization")).toBe("Bearer team-a-token");
		}

		setLocation({ query: "https://CONSOLE.example.test:443/team-a///" });
		await bootstrapAdmin(fetchImpl);
		expect(adminToken()).toBe("team-a-token");
		await adminApi.remoteAgents();
		expect(new Headers(fetchImpl.mock.lastCall?.[1]?.headers).get("authorization")).toBe("Bearer team-a-token");

		setLocation();
		await bootstrapAdmin(fetchImpl);
		expect(adminToken()).toBe("legacy-root-token");
		expect(localStorage.getItem("kit_admin_token")).toBeNull();
		setAdminToken("new-root-token");
		await bootstrapAdmin(fetchImpl);
		expect(adminToken()).toBe("new-root-token");
	});

	// 保护登录后/换令牌后的真实请求：共享客户端不能冻结初始化时的空令牌。
	it("配额 HTTP 与 Operation 流共用配置地址并在每次请求读取最新令牌", async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(configResponse("https://api.example.test/prefix"));
		await bootstrapAdmin(fetchImpl);
		setAdminToken("first");
		fetchImpl.mockResolvedValueOnce(Response.json({ data: { monthly_credits: 100 } }));
		await expect(adminApi.quota.policy()).resolves.toMatchObject({ monthly_credits: 100 });
		setAdminToken("second");
		fetchImpl.mockResolvedValueOnce(new Response(null, { status: 204 }));
		await streamOperation("op/slash", vi.fn());

		const [http, stream] = fetchImpl.mock.calls.slice(1);
		expect(http?.[0]).toBe("https://api.example.test/prefix/api/admin/quota/policy");
		expect(new Headers(http?.[1]?.headers).get("authorization")).toBe("Bearer first");
		expect(new Headers(http?.[1]?.headers).get("content-type")).toBe("application/json");
		expect(stream?.[0]).toBe("https://api.example.test/prefix/api/admin/operations/op%2Fslash/events");
		expect(new Headers(stream?.[1]?.headers).get("authorization")).toBe("Bearer second");
		expect(new Headers(stream?.[1]?.headers).has("content-type")).toBe(false);
	});

	// 保护带路径前缀的后端部署：Logo 资源与读写请求必须使用同一个 API base。
	it("品牌读取、保存与上传返回的 Logo 地址保留后端路径前缀", async () => {
		const base = "https://api.example.test/prefix";
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(configResponse(`${base}/`));
		await bootstrapAdmin(fetchImpl);
		const view = { productName: "品牌", logoUrl: "/api/branding/logo?v=abc", updatedAt: "2026-11-13T00:00:00.000Z" };
		fetchImpl.mockImplementation(async () => Response.json({ data: view }));
		const expected = { ...view, logoUrl: `${base}${view.logoUrl}` };
		await expect(adminApi.branding.get()).resolves.toEqual(expected);
		await expect(adminApi.branding.update({ productName: "品牌" })).resolves.toEqual(expected);
		await expect(adminApi.branding.uploadLogo(new File(["logo"], "logo.png", { type: "image/png" }))).resolves.toEqual(
			expected,
		);
		expect(fetchImpl.mock.calls.slice(1).map(([url]) => url)).toEqual([
			`${base}/api/admin/branding`,
			`${base}/api/admin/branding`,
			`${base}/api/admin/branding/logo`,
		]);
		// 用户填写的员工端路径和完整在线地址不是 API 资产，保持原值。
		for (const logoUrl of ["/brand/logo.svg", "https://cdn.example.test/logo.svg"]) {
			fetchImpl.mockResolvedValueOnce(Response.json({ data: { ...view, logoUrl } }));
			await expect(adminApi.branding.get()).resolves.toMatchObject({ logoUrl });
		}
	});

	it.each(["http", "protocol"] as const)("初始化 %s 失败时禁止管理请求，重试成功后才恢复", async (failure) => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(configResponse());
		await bootstrapAdmin(fetchImpl);
		fetchImpl.mockResolvedValueOnce(
			failure === "http"
				? Response.json({ error: { code: "provider_error", message: "配置不可用" } }, { status: 503 })
				: configResponse("", "1.0.0"),
		);
		await expect(bootstrapAdmin(fetchImpl)).rejects.toThrow();
		expect(adminToken()).toBe("");
		expect(() => setAdminToken("while-config-failed")).toThrow("初始化");
		expect(() => adminRequest()).toThrow("初始化");
		await expect(adminApi.remoteAgents()).rejects.toThrow("初始化");
		await expect(streamOperation("op", vi.fn())).rejects.toThrow("初始化");
		expect(fetchImpl).toHaveBeenCalledTimes(2);

		fetchImpl.mockResolvedValueOnce(configResponse());
		await bootstrapAdmin(fetchImpl);
		fetchImpl.mockResolvedValueOnce(Response.json({ data: [] }));
		await expect(adminApi.remoteAgents()).resolves.toEqual([]);
	});

	it("管理请求保留服务端 Kit 错误信息", async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(configResponse());
		await bootstrapAdmin(fetchImpl);
		fetchImpl.mockResolvedValueOnce(
			Response.json({ error: { code: "forbidden", message: "只读账号" } }, { status: 403 }),
		);
		await expect(adminApi.remoteAgents()).rejects.toMatchObject({ code: "forbidden", message: "只读账号" });
	});
});
