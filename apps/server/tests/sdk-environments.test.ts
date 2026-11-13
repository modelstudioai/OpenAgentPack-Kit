import { RemoteEnvironmentDetailSchema } from "@openagentpack/kit-sdk/protocol";
import { setDefaultFetch } from "@openagentpack/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSdkGateway } from "../src/gateway/sdk.ts";

const gateway = () =>
	createSdkGateway({ apiKey: "sk-unit-test-credential", baseUrl: "https://provider.example.test/api/v1/agentstudio" });
afterEach(() => {
	vi.unstubAllGlobals();
	setDefaultFetch(fetch);
});

describe("上架环境的 SDK HTTP 合同", () => {
	// 详情是浏览器可见的白名单：六类包与普通元数据可读，敏感值、脚本及未知字段不能泄漏凭据。
	it("通过公开 SDK 读取环境详情，逐层投影配置并隐藏变量值、脚本和 URL 凭据", async () => {
		const calls: { url: string; method?: string }[] = [];
		setDefaultFetch(async (input, init) => {
			calls.push({ url: String(input), method: init?.method });
			return Response.json({
				id: "env-1",
				name: "分析环境",
				description:
					"帮助文档 https://user:do-not-expose-password@docs.example.test/env?key=do-not-expose-query#secret",
				scope: "organization",
				version: 2,
				type: "environment",
				created_at: "2026-10-27T00:00:00Z",
				updated_at: "2026-11-01T00:00:00Z",
				metadata: {
					owner: "analytics-team",
					author: "环境维护者",
					"https://user:do-not-expose-label@labels.example.test/key": "可见标签",
					docs: "https://user:do-not-expose-metadata@docs.example.test/env?key=hidden",
					note: "Bearer do-not-expose-inline-token; Basic Zml4dHVyZTpwYXNzd29yZA==; Bearer abc+/token==; api_key=do-not-expose-inline-key",
					token: "do-not-expose-token",
					secret: "do-not-expose-secret",
					password: "do-not-expose-password",
					credential: "do-not-expose-credential",
					api_key: "do-not-expose-api-key",
					access_key: "do-not-expose-access-key",
					privateKey: "do-not-expose-private-key",
					cookie: "do-not-expose-cookie",
					authorization: "do-not-expose-auth",
					count: 3,
					nested: { value: "do-not-expose-nested" },
				},
				package_status: "building",
				credential: "do-not-expose-credential",
				config: {
					type: "cloud",
					networking: {
						type: "limited",
						allow_mcp_servers: true,
						allow_package_managers: false,
						allowed_hosts: ["example.test", "https://user:do-not-expose-host@packages.example.test/path?token=hidden"],
						headers: { Authorization: "do-not-expose-header" },
					},
					packages: {
						apt: ["git"],
						pip: ["pandas", "https://user:do-not-expose-package@packages.example.test/pkg?signature=hidden"],
						npm: ["typescript", "git+ssh://user:do-not-expose-git@packages.example.test/repo?token=hidden"],
						go: ["example.test/tool@v1.2.3"],
						cargo: ["ripgrep"],
						gem: ["rake"],
						credentials: "do-not-expose-registry",
					},
					environment_variables: { API_KEY: "do-not-expose-variable", WORKSPACE: "do-not-expose-ordinary-value" },
					setup_script: "export PASSWORD=do-not-expose-script",
					api_key: "do-not-expose-key",
				},
			});
		});
		const detail = await gateway().getRemoteEnvironment("env-1");
		expect(detail).toEqual({
			environment_id: "env-1",
			name: "分析环境",
			copy_restricted_fields: [
				"description",
				"metadata",
				"configuration.environment_variables",
				"configuration.setup_script",
				"configuration",
				"configuration.packages",
				"configuration.networking",
			],
			description: "帮助文档 https://docs.example.test/env",
			metadata: {
				owner: "analytics-team",
				author: "环境维护者",
				"https://labels.example.test/key": "可见标签",
				docs: "https://docs.example.test/env",
				note: "[redacted]; [redacted]; [redacted]; api_key=[redacted]",
				token: "[redacted]",
				secret: "[redacted]",
				password: "[redacted]",
				credential: "[redacted]",
				api_key: "[redacted]",
				access_key: "[redacted]",
				privateKey: "[redacted]",
				cookie: "[redacted]",
				authorization: "[redacted]",
			},
			package_status: "building",
			scope: "organization",
			version: 2,
			type: "environment",
			created_at: "2026-10-27T00:00:00Z",
			updated_at: "2026-11-01T00:00:00Z",
			configuration: {
				type: "cloud",
				networking: {
					type: "limited",
					allow_mcp_servers: true,
					allow_package_managers: false,
					allowed_hosts: ["example.test", "https://packages.example.test/path"],
				},
				packages: {
					apt: ["git"],
					pip: ["pandas", "https://packages.example.test/pkg"],
					npm: ["typescript", "git+ssh://packages.example.test/repo"],
					go: ["example.test/tool@v1.2.3"],
					cargo: ["ripgrep"],
					gem: ["rake"],
				},
				environment_variables: { API_KEY: "[redacted]", WORKSPACE: "[redacted]" },
				setup_script: "[redacted]",
			},
		});
		expect(RemoteEnvironmentDetailSchema.safeParse(detail).success).toBe(true);
		expect(JSON.stringify(detail)).not.toContain("do-not-expose");
		expect(JSON.stringify(detail)).not.toMatch(/Zml4dHVyZTpwYXNzd29yZA|abc\+\/token/);
		expect(calls).toEqual([
			{ url: "https://provider.example.test/api/v1/agentstudio/environments/env-1", method: "GET" },
		]);
	});

	// 构建状态必须来自 Provider 的已知枚举；未知或缺失不能推断成 ready。
	it("仅接收明确的环境包状态，未知值和配置内同名字段不作为可用证明", async () => {
		for (const status of ["ready", "unknown", undefined]) {
			setDefaultFetch(async () =>
				Response.json({ id: "env-1", package_status: status, config: { package_status: "ready" } }),
			);
			const detail = await gateway().getRemoteEnvironment("env-1");
			expect(detail?.package_status).toBe(status === "ready" ? "ready" : undefined);
		}
	});

	it("环境名称缺失回退 ID，缺失/归档返回 null，错 ID 不得显示其他环境", async () => {
		const replies = [
			{ id: "env-1" },
			{ id: "env-1", archived_at: "2026-11-01T00:00:00Z" },
			{ id: "env-1", status: "archived" },
			{ id: "env-other", name: "其他环境" },
		];
		setDefaultFetch(async () => {
			const reply = replies.shift();
			return reply ? Response.json(reply) : Response.json({ code: "NotFound" }, { status: 404 });
		});
		const sdk = gateway();
		expect(await sdk.getRemoteEnvironment("env-1")).toMatchObject({
			environment_id: "env-1",
			name: "env-1",
			configuration: {},
		});
		expect(await sdk.getRemoteEnvironment("env-1")).toBeNull();
		expect(await sdk.getRemoteEnvironment("env-1")).toBeNull();
		await expect(sdk.getRemoteEnvironment("env-1")).rejects.toMatchObject({
			code: "provider_error",
			message: "环境信息不一致，请稍后重试",
		});
		expect(await sdk.getRemoteEnvironment("env-1")).toBeNull();
	});

	it("环境 ID 不能改变 SDK 请求路径，Provider 错误不回传敏感正文", async () => {
		const fetcher = vi.fn(async () => Response.json({ message: "do-not-expose-provider-error" }, { status: 403 }));
		setDefaultFetch(fetcher);
		const sdk = gateway();
		for (const id of ["../agents", "env-1?key=private", "env-1#private", "env%2Fother"])
			await expect(sdk.getRemoteEnvironment(id)).rejects.toMatchObject({ code: "invalid_request" });
		expect(fetcher).not.toHaveBeenCalled();
		await expect(sdk.getRemoteEnvironment("env-1")).rejects.toMatchObject({
			code: "provider_error",
			message: "环境详情查询失败，请稍后重试",
			retryable: true,
		});
	});

	it.each([
		{ type: "unrestricted", allowed_hosts: null },
		{
			type: "limited",
			allow_mcp_servers: false,
			allow_package_managers: true,
			allowed_hosts: ["packages.example.test"],
		},
	])("空描述、组织作用域和正常网络策略可复制：$type", async (networking) => {
		setDefaultFetch(async () =>
			Response.json({
				id: "env-1",
				name: "dd",
				description: null,
				scope: "organization",
				config: { type: "cloud", networking },
			}),
		);
		const detail = await gateway().getRemoteEnvironment("env-1");
		expect(detail?.copy_restricted_fields).toEqual([]);
		expect(detail?.description).toBeUndefined();
		expect(detail?.scope).toBe("organization");
		expect(detail?.configuration.networking).toMatchObject({ type: networking.type });
		if (networking.type === "limited") expect(detail?.configuration.networking).toMatchObject(networking);
	});

	it("读取全部环境页、合并重复 ID，并为无名称环境提供 ID 回退", async () => {
		const calls: URL[] = [];
		const environments = Array.from({ length: 101 }, (_, index) => ({
			id: `env-${index + 1}`,
			...(index < 100 ? { name: `环境 ${index + 1}` } : {}),
		}));
		const nextPage = "opaque+environment/page=";
		setDefaultFetch(async (input) => {
			const url = new URL(String(input));
			calls.push(url);
			return Response.json(
				url.searchParams.has("page")
					? { data: environments.slice(99), has_more: false }
					: { data: environments.slice(0, 100), has_more: true, next_page: nextPage },
			);
		});
		expect(await gateway().listRemoteEnvironments()).toEqual(
			environments.map(({ id, name }) => ({ environment_id: id, name: name ?? id })),
		);
		expect(calls.map((url) => url.searchParams.get("page"))).toEqual([null, nextPage]);
		for (const url of calls) {
			expect(url.pathname).toBe("/api/v1/agentstudio/environments");
			expect(url.searchParams.get("limit")).toBe("100");
		}
	});

	it.each([
		{ next_page: undefined, message: "远端环境列表缺少下一页游标，请重试" },
		{ next_page: "repeated-cursor", message: "远端环境列表分页游标重复，请重试" },
	])("异常环境分页拒绝静默截断：$message", async ({ next_page, message }) => {
		setDefaultFetch(async () => Response.json({ data: [{ id: "env-1" }], has_more: true, next_page }));
		await expect(gateway().listRemoteEnvironments()).rejects.toMatchObject({ code: "provider_error", message });
	});

	it("建会话传递指定环境，未指定时保留 Provider 默认环境语义", async () => {
		const requests: { url: string; body: unknown }[] = [];
		vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
			requests.push({ url, body: JSON.parse(String(init.body)) });
			return Response.json({ id: `session-${requests.length}`, status: "idle" });
		});
		const sdk = gateway();
		await sdk.createSession({ agentId: "agent-1", environmentId: "env-selected" });
		await sdk.createSession({ agentId: "agent-1" });
		expect(requests).toEqual([
			{
				url: "https://provider.example.test/api/v1/agentstudio/sessions",
				body: { agent: "agent-1", environment_id: "env-selected" },
			},
			{ url: "https://provider.example.test/api/v1/agentstudio/sessions", body: { agent: "agent-1" } },
		]);
	});
});
